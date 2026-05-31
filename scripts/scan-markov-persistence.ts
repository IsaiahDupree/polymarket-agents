/**
 * Markov persistence filter scanner — Ricker article #2.
 *
 *   npm run scan:markov-persistence
 *   npm run scan:markov-persistence -- --asset BTC --duration 5M --limit 50
 *   npm run scan:markov-persistence -- --min-persistence 0.85 --min-edge 0.05
 *
 * Polls active (unsettled) binaries from `poly_binaries`, fetches each
 * market's pricesHistory + current midpoint, runs `evaluateMarket`, and
 * persists ENTER verdicts as `markov-persistence-opportunity` events.
 *
 * Idempotent — dedup key is (tokenId, side, half-hour-bucket). Runs at any
 * cadence; 5-min cron is reasonable for 5M markets.
 *
 * v1 caveat: BTC 5m markets only have ~5min of own price history (sparse).
 * Expect most calls to PASS with reason=filter_data_too_sparse on
 * short-duration markets — that's correct behavior, not a bug. To unlock
 * the full Ricker filter on 5m markets, the next feature is a cross-window
 * BTC-5m price-history aggregator that pools history across many resolved
 * 5m windows of the same asset.
 *
 * For now this scanner is most useful on longer-window binaries (1H, 1D,
 * weekly) where own-history is enough.
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { poly } from "@adapters/polymarket/client";
import {
  evaluateMarket,
  evaluateMarketWithPool,
  type EvaluatorResult,
  type PriceSample,
  type ScanMarket,
} from "../src/lib/strategies/markov-persistence-scanner.ts";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}
function flagNum(name: string, fallback: number): number {
  const v = flag(name);
  return v != null ? Number(v) : fallback;
}

const ASSET = flag("asset");                          // BTC | ETH | ... (optional)
const DURATION = flag("duration");                    // 5M | 15M | 1H | ... (optional)
const LIMIT = flagNum("limit", 100);
const MIN_PERSISTENCE = flagNum("min-persistence", 0.87);
const MAX_PERSISTENCE = flagNum("max-persistence", 0.99);
const MIN_EDGE = flagNum("min-edge", 0.05);
const MIN_SAMPLES = flagNum("min-samples", 30);
const N_SIMS = flagNum("n-sims", 10_000);
// Defaults: '1d' interval at fidelity=1 yields ~1400 samples for short-lived
// markets — plenty to satisfy the article's 20-obs-per-row rule. Drop fidelity
// to 5 or 60 for coarser steps when MC walks get expensive (steps-to-expiry
// rises proportionally to 1/fidelity).
const HISTORY_INTERVAL = (flag("history-interval") ?? "1d") as "max" | "1w" | "1d" | "6h" | "1h";
const HISTORY_FIDELITY = flagNum("history-fidelity", 1);
const CROSS_WINDOW = flagNum("cross-window", 0); // 0 = single-market; N = pool with N most-recent same-asset markets
const DRY_RUN = args.includes("--dry-run");

const handle = db();

type BinaryRow = {
  token_id: string;
  no_token_id: string | null;
  condition_id: string;
  question: string;
  asset: string;
  duration_kind: string;
  expiry_iso: string;
};

(async () => {
  console.log(
    `[scan-markov-persistence] asset=${ASSET ?? "*"} duration=${DURATION ?? "*"} ` +
      `persistence≥${MIN_PERSISTENCE} edge≥${MIN_EDGE} samples≥${MIN_SAMPLES} sims=${N_SIMS} ` +
      `cross-window=${CROSS_WINDOW}` +
      (DRY_RUN ? " DRY_RUN" : ""),
  );

  const clauses: string[] = ["settled = 0", "expiry_iso > datetime('now')"];
  const params: any[] = [];
  if (ASSET) {
    clauses.push("asset = ?");
    params.push(ASSET);
  }
  if (DURATION) {
    clauses.push("duration_kind = ?");
    params.push(DURATION);
  }

  const rows = handle
    .prepare(
      `SELECT token_id, no_token_id, condition_id, question, asset, duration_kind, expiry_iso
         FROM poly_binaries
        WHERE ${clauses.join(" AND ")}
        ORDER BY expiry_iso ASC
        LIMIT ?`,
    )
    .all(...params, LIMIT) as BinaryRow[];

  console.log(`[scan-markov-persistence] ${rows.length} unsettled markets in scope`);

  let scanned = 0;
  let enters = 0;
  let passByReason: Record<string, number> = {};
  let logged = 0;
  let deduped = 0;
  const bucket = `${new Date().toISOString().slice(0, 13)}-${Math.floor(new Date().getMinutes() / 30)}`;

  for (const row of rows) {
    scanned++;
    try {
      const [historyResp, midResp] = await Promise.all([
        poly.pricesHistory(row.token_id, HISTORY_INTERVAL, HISTORY_FIDELITY),
        poly.midpoint(row.token_id),
      ]);
      const history: PriceSample[] = (historyResp.history ?? [])
        .map((s: any) => ({ t: Number(s.t), p: Number(s.p) }))
        .filter((s: PriceSample) => Number.isFinite(s.t) && Number.isFinite(s.p));
      const currentPrice = Number(midResp.mid);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0 || currentPrice >= 1) {
        passByReason["bad_midpoint"] = (passByReason["bad_midpoint"] ?? 0) + 1;
        continue;
      }
      const market: ScanMarket = {
        tokenId: row.token_id,
        conditionId: row.condition_id,
        title: row.question,
        asset: row.asset,
        durationKind: row.duration_kind,
        currentPrice,
        expiryIso: row.expiry_iso,
      };

      let result: EvaluatorResult;
      if (CROSS_WINDOW > 0) {
        // Pool history from CROSS_WINDOW other same-asset same-duration markets.
        // Prefer settled markets first (they have complete trajectories), then
        // any still-trading ones — both are valid samples of the dynamics.
        const peerRows = handle
          .prepare(
            `SELECT token_id FROM poly_binaries
              WHERE asset = ? AND duration_kind = ? AND token_id != ?
              ORDER BY settled DESC, expiry_iso DESC
              LIMIT ?`,
          )
          .all(row.asset, row.duration_kind, row.token_id, CROSS_WINDOW) as Array<{ token_id: string }>;
        const peerHistories: PriceSample[][] = await Promise.all(
          peerRows.map(async (peer) => {
            try {
              const resp = await poly.pricesHistory(peer.token_id, HISTORY_INTERVAL, HISTORY_FIDELITY);
              return (resp.history ?? [])
                .map((s: any) => ({ t: Number(s.t), p: Number(s.p) }))
                .filter((s: PriceSample) => Number.isFinite(s.t) && Number.isFinite(s.p));
            } catch {
              return [] as PriceSample[];
            }
          }),
        );
        result = evaluateMarketWithPool(market, history, peerHistories, {
          minPersistence: MIN_PERSISTENCE,
          maxPersistence: MAX_PERSISTENCE,
          minEdge: MIN_EDGE,
          minPriceSamples: MIN_SAMPLES,
          nSims: N_SIMS,
        });
      } else {
        result = evaluateMarket(market, history, {
          minPersistence: MIN_PERSISTENCE,
          maxPersistence: MAX_PERSISTENCE,
          minEdge: MIN_EDGE,
          minPriceSamples: MIN_SAMPLES,
          nSims: N_SIMS,
        });
      }

      if (result.decision === "PASS") {
        passByReason[result.reason] = (passByReason[result.reason] ?? 0) + 1;
        continue;
      }

      enters++;

      // Dedup: same (tokenId, side, 30-min bucket) → emit once.
      const existing = handle
        .prepare(
          `SELECT 1 FROM evolution_log
            WHERE event_type = 'markov-persistence-opportunity'
              AND created_at >= datetime('now', '-1 day')
              AND payload_json LIKE ?`,
        )
        .get(`%"tokenId":"${result.tokenId}"%"side":"${result.side}"%"bucket":"${bucket}"%`);
      if (existing) {
        deduped++;
        continue;
      }

      const summary =
        `MARKOV ${result.side} ${(result.title ?? result.conditionId).slice(0, 50)} ` +
        `@ ${result.marketPrice.toFixed(3)} → cal ${result.calibratedProbYes.toFixed(3)} ` +
        `(persist ${result.persistence.toFixed(2)}, edge ${(result.edge * 100).toFixed(1)}pp, ` +
        `${result.stepsToExpiry} steps × ${result.inferredFidelitySec}s)`;
      console.log(`  ↳ ${summary}`);
      if (!DRY_RUN) {
        insertEvolutionEvent({
          event_type: "markov-persistence-opportunity",
          summary,
          payload_json: JSON.stringify({ ...result, bucket }),
        });
        logged++;
      }
    } catch (err) {
      passByReason["fetch_error"] = (passByReason["fetch_error"] ?? 0) + 1;
      console.error(`  ! ${row.token_id.slice(0, 12)}: ${(err as Error).message}`);
    }
  }

  const passSummary = Object.entries(passByReason)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `[scan-markov-persistence] scanned=${scanned} ENTER=${enters} logged=${logged} ` +
      `deduped=${deduped} pass[${passSummary}]`,
  );

  if (enters === 0 && !DRY_RUN) {
    insertEvolutionEvent({
      event_type: "markov-persistence-scan-empty",
      summary: `MARKOV: 0 enters in ${scanned} markets (persistence≥${MIN_PERSISTENCE} edge≥${MIN_EDGE})`,
      payload_json: JSON.stringify({ scanned, asset: ASSET, duration: DURATION, passByReason }),
    });
  }
})().catch((err) => {
  console.error("[scan-markov-persistence] FAILED:", err);
  process.exit(1);
});
