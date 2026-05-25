/**
 * The research loop, second iteration.
 *
 * For each active strategy:
 *  1. Builds a candidate universe (sampling markets, sliced to N).
 *  2. Fetches prices-history at 1m fidelity for each candidate token.
 *  3. Computes per-token signals (1d return, 1w return, realized vol, z-score
 *     vs rolling mean) — see src/lib/polymarket/signals.ts.
 *  4. Runs a strategy-specific evaluator that proposes a new strategy_version
 *     when the observed cross-sectional signal distribution argues for one.
 *  5. Writes a backtest_summary JSON on each proposed version capturing the
 *     observation set the proposal was grounded in.
 *  6. Appends a synthesis research_note per pass.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { poly } from "../src/lib/polymarket/client.ts";
import { realizedVol, returnOver, summarize, zScoreVsRollingMean, type PricePoint, type Signal } from "../src/lib/polymarket/signals.ts";
import { insertEvolutionEvent, insertResearchNote, recordMarketSnapshot } from "../src/lib/db/queries.ts";

type Strategy = {
  id: number;
  agent_id: number;
  slug: string;
  name: string;
  thesis: string;
  market_filter: string;
};
type StrategyVersion = { id: number; strategy_id: number; version: number; spec_json: string; is_current: number };

async function buildSignals(limit = 12): Promise<Signal[]> {
  const sampling = await poly.samplingMarkets(limit);
  const signals: Signal[] = [];
  for (const m of sampling.data) {
    const yes = m.tokens?.find((t: any) => t.outcome === "Yes");
    const tokenId = yes?.token_id ?? m.tokens?.[0]?.token_id;
    if (!tokenId || !m.condition_id) continue;
    const [mid, spread, history] = await Promise.all([
      poly.midpoint(tokenId).catch(() => null),
      poly.spread(tokenId).catch(() => null),
      poly.pricesHistory(tokenId, "1w", 60).catch(() => null),
    ]);
    const series: PricePoint[] = (history?.history ?? []) as PricePoint[];
    const midpoint = mid ? Number((mid as any).mid) : 0;
    const spreadVal = spread ? Number((spread as any).spread) : 0;
    signals.push({
      tokenId,
      conditionId: m.condition_id,
      question: m.question ?? "(no question)",
      midpoint,
      spread: spreadVal,
      ret1d: returnOver(series, 86400),
      ret1w: returnOver(series, 7 * 86400),
      realizedVol: realizedVol(series),
      zScore: zScoreVsRollingMean(series),
      samples: series.length,
    });
    recordMarketSnapshot({
      condition_id: m.condition_id,
      token_id: tokenId,
      question: m.question ?? "(no question)",
      yes_price: yes?.price ?? null,
      no_price: m.tokens?.find((t: any) => t.outcome === "No")?.price ?? null,
      midpoint,
      spread: spreadVal,
      volume_24h: null,
      open_interest: null,
      liquidity_usd: null,
    });
  }
  return signals;
}

type Verdict = null | { rationale: string; specPatch: Record<string, unknown>; backtestSummary: Record<string, unknown> };

const evaluators: Record<string, (strategy: Strategy, current: StrategyVersion, signals: Signal[]) => Verdict> = {
  // Atlas Macro — fade-headline-spikes: look at the distribution of |1d returns|.
  // If the observed p90 |ret1d| is materially above the current threshold_pts,
  // we're too tight; if it's below, we're too loose. Propose a recalibration.
  "fade-headline-spikes": (_s, current, signals) => {
    const moves = signals
      .map((s) => Math.abs(s.ret1d ?? 0) * 100) // percentage points
      .filter((m) => Number.isFinite(m) && m > 0);
    if (moves.length < 6) return null;
    const stats = summarize("|ret1d|%", moves);
    const spec = JSON.parse(current.spec_json) as any;
    const currentThreshold = Number(spec.entry?.threshold_pts ?? 8);
    const targetThreshold = Math.max(2, Math.round(stats.p90));
    if (Math.abs(currentThreshold - targetThreshold) < 1) return null;
    return {
      rationale: `Across ${moves.length} sampled markets, p90 |1d return| is ${stats.p90.toFixed(2)} pts (mean ${stats.mean.toFixed(2)}). Current entry threshold is ${currentThreshold} pts — recalibrating to ${targetThreshold} so we fire on top-decile moves, not on noise.`,
      specPatch: { entry: { ...(spec.entry ?? {}), threshold_pts: targetThreshold } },
      backtestSummary: { observed: stats, prior_threshold: currentThreshold, proposed_threshold: targetThreshold },
    };
  },

  // Ember Momentum — breakout-rider: use 1w returns + realized vol to recalibrate
  // the volume-multiple gating. If realized vol is high, breakouts are likely noise;
  // raise the gate. If low, lower it.
  "breakout-rider": (_s, current, signals) => {
    const vols = signals.map((s) => s.realizedVol).filter((v) => Number.isFinite(v) && v > 0);
    if (vols.length < 6) return null;
    const stats = summarize("realizedVol", vols);
    const spec = JSON.parse(current.spec_json) as any;
    const currentGate = Number(spec.entry?.vol_multiple_min ?? 2);
    // Heuristic: target gate = clamp(1.5, 2 + 4 * mean_vol, 4)
    const targetGate = Math.max(1.5, Math.min(4, +((2 + 4 * stats.mean).toFixed(2))));
    if (Math.abs(currentGate - targetGate) < 0.2) return null;
    return {
      rationale: `Mean realized vol across ${vols.length} candidate markets is ${stats.mean.toFixed(4)} (p90 ${stats.p90.toFixed(4)}). Current vol_multiple_min is ${currentGate} — recalibrating to ${targetGate} so the breakout gate scales with current vol regime.`,
      specPatch: { entry: { ...(spec.entry ?? {}), vol_multiple_min: targetGate } },
      backtestSummary: { observed: stats, prior_gate: currentGate, proposed_gate: targetGate },
    };
  },

  // Scribe Sports — stale-quote-arb: this strategy requires the websocket feed
  // to evaluate properly. The research loop's REST cadence can't see <3s
  // windows. Propose adding a 'websocket_required: true' flag so the runner
  // refuses to execute under REST-only conditions — and log a note explaining.
  "stale-quote-arb": (_s, current) => {
    const spec = JSON.parse(current.spec_json) as any;
    if (spec.requires_websocket === true) return null;
    return {
      rationale: `Empirical NBA-arb research shows median arbitrage window is 3.6 seconds — REST polling cannot see them. Marking the strategy as requires_websocket=true so the runner won't fire under REST-only conditions, eliminating false confidence.`,
      specPatch: { requires_websocket: true, exit: { ...(spec.exit ?? {}), max_age_ms: 1500 } },
      backtestSummary: { rationale_source: "arxiv:2605.00864", median_window_seconds: 3.6 },
    };
  },

  // Oracle Research — weekly-deep-dives: never auto-mutates the spec; instead
  // emits a research_note enumerating this pass's high-z-score candidates so
  // a human/agent can use them as starting points for deep-dive theses.
  "weekly-deep-dives": (s, _current, signals) => {
    const ranked = [...signals]
      .filter((sig) => Number.isFinite(sig.zScore))
      .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore))
      .slice(0, 5);
    if (ranked.length === 0) return null;
    insertResearchNote({
      agent_id: s.agent_id,
      strategy_id: s.id,
      topic: `Deep-dive candidates ${new Date().toISOString().slice(0, 16)}`,
      body:
        `Top 5 markets by |z-score vs 7d mean| from this research-loop pass:\n\n` +
        ranked
          .map((r, i) => `${i + 1}. **${r.question}** — z=${r.zScore.toFixed(2)}, mid=${r.midpoint.toFixed(3)}, spread=${r.spread.toFixed(3)}, 1d=${(r.ret1d ?? 0 * 100).toFixed(2)}%, 1w=${((r.ret1w ?? 0) * 100).toFixed(2)}%\n   token=\`${r.tokenId}\`\n   condition=\`${r.conditionId}\``)
          .join("\n\n") +
        `\n\nProcess: for each, write a fresh thesis covering priced_yes, model_yes, edge_bps, horizon_days, invalidation.`,
      source_urls_json: JSON.stringify(["https://docs.polymarket.com/api-reference/markets/get-prices-history"]),
      confidence: 0.5,
      tags_json: JSON.stringify(["deep-dive", "candidates", "auto"]),
    });
    return null;
  },
};

function proposeVersion(strategyId: number, parent: StrategyVersion, patch: Record<string, unknown>, rationale: string, backtestSummary: Record<string, unknown>): number {
  const handle = db();
  const nextVersion = (handle.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM strategy_versions WHERE strategy_id = ?").get(strategyId) as any).v as number;
  const merged = { ...JSON.parse(parent.spec_json), ...patch };
  const result = handle.prepare(
    `INSERT INTO strategy_versions
       (strategy_id, parent_version_id, version, spec_json, rationale, backtest_summary, introduced_by, is_current)
     VALUES (?, ?, ?, ?, ?, ?, 'research-loop', 0)`,
  ).run(
    strategyId,
    parent.id,
    nextVersion,
    JSON.stringify(merged),
    rationale,
    JSON.stringify(backtestSummary),
  );
  return result.lastInsertRowid as number;
}

(async () => {
  console.log(`[research-loop] starting at ${new Date().toISOString()}`);
  const signals = await buildSignals(12);
  console.log(`[research-loop] computed signals for ${signals.length} markets`);

  // Persist a synthesis note describing the data captured.
  if (signals.length > 0) {
    const vols = summarize("vol", signals.map((s) => s.realizedVol).filter((x) => x > 0));
    const spreads = summarize("spread", signals.map((s) => s.spread).filter((x) => x > 0));
    insertResearchNote({
      topic: `Cross-sectional sweep ${new Date().toISOString().slice(0, 16)}`,
      body: `Captured ${signals.length} sampling-markets. Spread (mean=${spreads.mean.toFixed(3)}, p90=${spreads.p90.toFixed(3)}). Realized vol (mean=${vols.mean.toFixed(4)}, p90=${vols.p90.toFixed(4)}). Strongest |z|=${Math.max(...signals.map((s) => Math.abs(s.zScore))).toFixed(2)}.`,
      source_urls_json: JSON.stringify(["https://clob.polymarket.com/sampling-markets", "https://clob.polymarket.com/prices-history"]),
      confidence: 0.6,
      tags_json: JSON.stringify(["sweep", "auto"]),
    });
  }

  const handle = db();
  const strategies = handle.prepare("SELECT * FROM strategies WHERE status = 'active'").all() as Strategy[];
  let proposed = 0;
  for (const s of strategies) {
    const cur = handle.prepare("SELECT * FROM strategy_versions WHERE strategy_id = ? AND is_current = 1").get(s.id) as StrategyVersion | undefined;
    if (!cur) continue;
    const evaluator = evaluators[s.slug];
    if (!evaluator) continue;
    const verdict = evaluator(s, cur, signals);
    if (!verdict) continue;
    const newId = proposeVersion(s.id, cur, verdict.specPatch, verdict.rationale, verdict.backtestSummary);
    insertEvolutionEvent({
      agent_id: s.agent_id,
      strategy_id: s.id,
      from_version_id: cur.id,
      to_version_id: newId,
      event_type: "proposal",
      summary: `Proposed v${cur.version + 1} of "${s.name}"`,
      payload_json: JSON.stringify({ rationale: verdict.rationale, patch: verdict.specPatch, backtest: verdict.backtestSummary }),
    });
    proposed++;
    console.log(`[research-loop] proposed v${cur.version + 1} for ${s.name} (id=${s.id})`);
  }
  console.log(`[research-loop] done — ${proposed} proposals across ${strategies.length} active strategies`);
})().catch((err) => {
  console.error("[research-loop] failed:", err);
  process.exit(1);
});
