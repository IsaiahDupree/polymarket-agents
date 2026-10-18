/**
 * Claude probability scanner — Lunar article #3 ("20-line Claude brain").
 *
 *   npm run scan:claude-probability                  # default: 10 markets, dry-run
 *   CLAUDE_PROB_LIVE_LLM=1 npm run scan:claude-probability -- --limit 25
 *
 * Pulls N sampling markets, asks Claude for a probability per question,
 * runs the pure evaluator, persists ENTER verdicts as
 * `claude-probability-opportunity` events.
 *
 * Cost guard: by default the script ONLY enumerates the markets it would
 * scan and emits an `claude-prob-scan-empty` row with the plan. To actually
 * burn LLM tokens set CLAUDE_PROB_LIVE_LLM=1.
 *
 * Idempotency: dedup key is (tokenId, side, hour-bucket). Re-running the
 * same hour on the same market is a no-op.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { poly } from "@adapters/polymarket/client";
import { claudeProbability, probabilityBrainAvailable } from "../src/lib/agents/probability-brain.ts";
import {
  evaluateMarketWithClaude,
  type ClaudeProbMarket,
  type ClaudeProbResult,
} from "../src/lib/strategies/claude-probability-scanner.ts";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}
function flagNum(name: string, fallback: number): number {
  const v = flag(name);
  return v != null ? Number(v) : fallback;
}

const LIMIT = flagNum("limit", 10);
const MIN_EDGE = flagNum("min-edge", 0.05);
const MIN_CONFIDENCE = (flag("min-confidence") ?? "medium") as "high" | "medium" | "low";
const LIVE_LLM = process.env.CLAUDE_PROB_LIVE_LLM === "1" || args.includes("--live-llm");
const DRY_RUN = !LIVE_LLM || args.includes("--dry-run");

(async () => {
  console.log(
    `[scan-claude-probability] limit=${LIMIT} min-edge=${MIN_EDGE} min-conf=${MIN_CONFIDENCE} ` +
      `live-llm=${LIVE_LLM} dry-run=${DRY_RUN}`,
  );

  if (LIVE_LLM && !probabilityBrainAvailable()) {
    console.error("[scan-claude-probability] LIVE_LLM=1 but Anthropic auth unavailable. Run `claude` to log in.");
    process.exit(2);
  }

  // Pull sampling markets. These are reward-eligible Polymarket binaries.
  let samples: any;
  try {
    samples = await poly.samplingMarkets(LIMIT);
  } catch (err) {
    console.error(`[scan-claude-probability] samplingMarkets failed: ${(err as Error).message}`);
    process.exit(1);
  }
  const markets = (samples?.data ?? []) as any[];
  console.log(`[scan-claude-probability] ${markets.length} sampling markets pulled`);

  const handle = db();
  const hourBucket = new Date().toISOString().slice(0, 13); // YYYY-MM-DDThh

  let scanned = 0;
  let enters = 0;
  let logged = 0;
  let deduped = 0;
  const passByReason: Record<string, number> = {};

  for (const m of markets) {
    scanned++;
    // Sampling-markets shape: pick a usable YES token id + question + mid.
    // Markets here have `tokens: [{ token_id, outcome, price }, ...]`.
    const tokens = (m.tokens ?? []) as Array<{ token_id: string; outcome: string; price: number | string }>;
    const yesToken = tokens.find((t) => /yes/i.test(String(t.outcome))) ?? tokens[0];
    if (!yesToken) {
      passByReason["no_token"] = (passByReason["no_token"] ?? 0) + 1;
      continue;
    }
    const currentPrice = Number(yesToken.price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0 || currentPrice >= 1) {
      passByReason["bad_price"] = (passByReason["bad_price"] ?? 0) + 1;
      continue;
    }

    const market: ClaudeProbMarket = {
      tokenId: yesToken.token_id,
      conditionId: m.condition_id ?? "",
      title: m.question ?? "",
      currentPrice,
      expiryIso: m.end_date_iso ?? m.end_date ?? undefined,
      category: m.category ?? undefined,
    };

    let verdict;
    if (LIVE_LLM) {
      try {
        verdict = await claudeProbability(market.title, market.currentPrice);
      } catch (err) {
        passByReason["llm_error"] = (passByReason["llm_error"] ?? 0) + 1;
        console.error(`  ! ${market.title.slice(0, 50)}: ${(err as Error).message}`);
        continue;
      }
      if (!verdict) {
        passByReason["llm_null"] = (passByReason["llm_null"] ?? 0) + 1;
        continue;
      }
    } else {
      // Dry-run: skip the LLM, just enumerate.
      passByReason["dry_run_skipped"] = (passByReason["dry_run_skipped"] ?? 0) + 1;
      continue;
    }

    const result: ClaudeProbResult = evaluateMarketWithClaude(market, verdict, {
      minEdge: MIN_EDGE,
      minConfidence: MIN_CONFIDENCE,
    });

    if (result.decision === "PASS") {
      passByReason[result.reason] = (passByReason[result.reason] ?? 0) + 1;
      continue;
    }

    enters++;
    const existing = handle
      .prepare(
        `SELECT 1 FROM evolution_log
          WHERE event_type = 'claude-probability-opportunity'
            AND created_at >= datetime('now', '-2 hours')
            AND payload_json LIKE ?`,
      )
      .get(`%"tokenId":"${result.tokenId}"%"side":"${result.side}"%"bucket":"${hourBucket}"%`);
    if (existing) {
      deduped++;
      continue;
    }

    const summary =
      `CLAUDE-PROB ${result.side} ${result.title.slice(0, 50)} ` +
      `@ ${result.marketPrice.toFixed(3)} → cal ${result.calibratedProbYes.toFixed(3)} ` +
      `(${result.confidence}, edge ${(result.edge * 100).toFixed(1)}pp)`;
    console.log(`  ↳ ${summary}`);
    insertEvolutionEvent({
      event_type: "claude-probability-opportunity",
      summary,
      payload_json: JSON.stringify({ ...result, bucket: hourBucket }),
    });
    logged++;
  }

  const passSummary = Object.entries(passByReason)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `[scan-claude-probability] scanned=${scanned} ENTER=${enters} logged=${logged} ` +
      `deduped=${deduped} pass[${passSummary}]`,
  );

  if (enters === 0 && LIVE_LLM) {
    insertEvolutionEvent({
      event_type: "claude-prob-scan-empty",
      summary: `CLAUDE-PROB: 0 enters in ${scanned} markets (min-edge=${MIN_EDGE} min-conf=${MIN_CONFIDENCE})`,
      payload_json: JSON.stringify({ scanned, minEdge: MIN_EDGE, minConfidence: MIN_CONFIDENCE, passByReason }),
    });
  }
})().catch((err) => {
  console.error("[scan-claude-probability] FAILED:", err);
  process.exit(1);
});
