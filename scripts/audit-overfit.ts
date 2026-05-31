/**
 * audit-overfit — one-shot diagnostic that answers "are our current
 * paper_agents real edge or overfit?". Pulls each alive agent with >= N
 * closed trades, buckets their paper_trades by day, and runs the
 * hardenVerdict gate (PBO + Deflated Sharpe + multi-fold walk-forward).
 *
 *   npm run audit:overfit
 *   npm run audit:overfit -- --min-trades 30 --top 20 --json
 *
 * The cohort is treated as a multi-variant universe — each agent is a
 * "variant" and the per-day return series is what we feed PBO. This is
 * the same gate HFT's scripts/harden-priors.ts applies: HARDENED only
 * when PBO < 0.3 AND DSR > 0.95 AND median(OOS Sharpe) > 0.
 *
 * Output: stdout table + a row written to evolution_log as
 * `overfit-audit` so the dashboard can surface it. If the cohort doesn't
 * pass the gate, the operator knows the apparent edge is statistically
 * indistinguishable from a multiple-testing artifact and live promotion
 * should wait for more data (or different strategies).
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import {
  sharpe, median, deflatedSharpe, pbo, multiFoldWalkForward, hardenVerdict,
  type Variant,
} from "../src/lib/quant/overfit-battery.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`); }

const MIN_TRADES = Number(arg("min-trades", "30"));
const TOP_N = Number(arg("top", "30"));
const WINDOW_DAYS = Number(arg("window-days", "30"));
const JSON_MODE = flag("json");

type AgentRow = {
  id: number;
  name: string;
  kind: string;
  trades_count: number;
  wins_count: number;
  realized_pnl_usd: number;
};

type TradeRow = {
  paper_agent_id: number;
  realized_pnl_usd: number | null;
  tick_at: string;
};

function fetchCohort(): AgentRow[] {
  return db().prepare(`
    SELECT id, name,
           COALESCE(json_extract(genome_json, '$.kind'), 'unknown') AS kind,
           trades_count, wins_count, realized_pnl_usd
      FROM paper_agents
     WHERE alive = 1 AND trades_count >= ?
     ORDER BY trades_count DESC
     LIMIT ?
  `).all(MIN_TRADES, TOP_N) as AgentRow[];
}

function fetchTrades(agentIds: number[], windowDays: number): Map<number, TradeRow[]> {
  if (agentIds.length === 0) return new Map();
  const cutoffIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const placeholders = agentIds.map(() => "?").join(",");
  const rows = db().prepare(`
    SELECT paper_agent_id, realized_pnl_usd, tick_at
      FROM paper_trades
     WHERE paper_agent_id IN (${placeholders})
       AND tick_at >= ?
     ORDER BY tick_at ASC
  `).all(...agentIds, cutoffIso) as TradeRow[];
  const byAgent = new Map<number, TradeRow[]>();
  for (const r of rows) {
    if (r.realized_pnl_usd == null) continue;  // skip opening fills (no pnl yet)
    const list = byAgent.get(r.paper_agent_id) ?? [];
    list.push(r);
    byAgent.set(r.paper_agent_id, list);
  }
  return byAgent;
}

/**
 * Bucket trades by UTC day → per-day return series. The per-day return
 * is the SUM of realized PnL for trades that closed that day. Days with
 * no trades get a 0 return (zero PnL is still a sample point).
 */
function dailyReturnsForAgent(trades: TradeRow[], windowDays: number): number[] {
  const buckets = new Array<number>(windowDays).fill(0);
  const now = Date.now();
  const oldestMs = now - windowDays * 86_400_000;
  for (const t of trades) {
    const ts = Date.parse(t.tick_at);
    if (!Number.isFinite(ts) || ts < oldestMs) continue;
    const dayIndex = Math.min(windowDays - 1, Math.floor((ts - oldestMs) / 86_400_000));
    buckets[dayIndex] += Number.isFinite(t.realized_pnl_usd) ? Number(t.realized_pnl_usd) : 0;
  }
  return buckets;
}

function main(): void {
  const cohort = fetchCohort();
  if (cohort.length === 0) {
    console.log(`[audit-overfit] no alive agents with >= ${MIN_TRADES} trades — nothing to audit`);
    return;
  }
  const tradesByAgent = fetchTrades(cohort.map((a) => a.id), WINDOW_DAYS);
  const variants: Variant[] = [];
  for (const a of cohort) {
    const trades = tradesByAgent.get(a.id) ?? [];
    if (trades.length === 0) continue;
    const returns = dailyReturnsForAgent(trades, WINDOW_DAYS);
    variants.push({ label: `${a.id}:${a.name.slice(0, 24)}`, returns });
  }
  if (variants.length < 2) {
    console.log(`[audit-overfit] cohort size ${variants.length} — need >=2 to compute PBO; aborting`);
    return;
  }

  // Per-variant Sharpe (for DSR's trial dispersion).
  const trialSharpes = variants.map((v) => sharpe(v.returns));

  // The "best" agent = highest Sharpe over the full window.
  let bestIdx = 0;
  for (let i = 1; i < trialSharpes.length; i++) {
    if (trialSharpes[i] > trialSharpes[bestIdx]) bestIdx = i;
  }
  const bestReturns = variants[bestIdx].returns;

  // Returns matrix M[t][c] for PBO.
  const T = WINDOW_DAYS;
  const M: number[][] = [];
  for (let t = 0; t < T; t++) {
    M.push(variants.map((v) => v.returns[t] ?? 0));
  }

  const verdict = hardenVerdict({
    returnsMatrix: M,
    variants,
    trialSharpes,
    bestReturns,
  });

  // ── Render output ────────────────────────────────────────────────────
  const summary = {
    cohort_size: variants.length,
    window_days: WINDOW_DAYS,
    min_trades: MIN_TRADES,
    best_label: variants[bestIdx].label,
    best_sharpe: trialSharpes[bestIdx],
    pbo: verdict.pbo,
    dsr: verdict.dsr,
    median_oos_sharpe: verdict.medianOos,
    hardened: verdict.hardened,
    pass: verdict.pass,
    folds: verdict.folds,
  };

  if (JSON_MODE) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("");
    console.log("══ OVERFIT AUDIT ══════════════════════════════════════════════════");
    console.log(`  cohort:    ${variants.length} agents (min trades=${MIN_TRADES}, window=${WINDOW_DAYS}d)`);
    console.log(`  best:      ${variants[bestIdx].label}  Sharpe=${trialSharpes[bestIdx].toFixed(3)}`);
    console.log("");
    console.log(`  PBO         ${verdict.pbo.toFixed(3)}    ${verdict.pass.pbo ? "PASS (< 0.30)" : "FAIL (>= 0.30 — overfit)"}`);
    console.log(`  DSR         ${verdict.dsr.toFixed(3)}    ${verdict.pass.dsr ? "PASS (> 0.95)" : "FAIL (<= 0.95 — not statistically significant)"}`);
    console.log(`  median OOS  ${verdict.medianOos.toFixed(3)}    ${verdict.pass.medianOos ? "PASS (> 0)" : "FAIL (<= 0 — no real edge)"}`);
    console.log("");
    console.log(`  VERDICT:    ${verdict.hardened ? "HARDENED ✓" : "NOT HARDENED ✗ — apparent edge may be overfit"}`);
    console.log("");
    console.log(`  Walk-forward folds (variant winning each fold + its OOS Sharpe):`);
    for (const f of verdict.folds) {
      console.log(`    fold ${f.fold}  bars=${f.bars}  IS-winner=${f.label.padEnd(28)}  OOS Sharpe=${f.oosSharpe.toFixed(3)}`);
    }
    console.log("");
  }

  try {
    insertEvolutionEvent({
      event_type: "overfit-audit",
      summary: `cohort=${variants.length} PBO=${verdict.pbo.toFixed(2)} DSR=${verdict.dsr.toFixed(2)} medOOS=${verdict.medianOos.toFixed(2)} ⇒ ${verdict.hardened ? "HARDENED" : "NOT HARDENED"}`,
      payload_json: JSON.stringify(summary),
    });
  } catch (err) {
    console.error(`[audit-overfit] failed to log: ${(err as Error).message}`);
  }
}

main();
