/**
 * Self-maker basket scanner — Path A's actual achievable strategy.
 *
 *   npm run scan:self-maker-basket
 *   npm run scan:self-maker-basket -- --limit 50 --min-edge 0.03
 *
 * For each unsettled binary market in poly_binaries, fetches both YES and
 * NO orderbooks and runs detectSelfMakerOpportunity. Emits opportunities
 * to evolution_log as `self-maker-opportunity` events.
 *
 * IMPORTANT: This scanner finds opportunities but DOES NOT post orders.
 * Posting requires either (a) the AtomicArbExecutor contract deployed +
 * audited + funded + maker-signature flow wired, OR (b) the operator
 * manually posting limit orders on Polymarket and managing the lifecycle.
 * Auto-execution is gated on the contract path being live.
 *
 * Idempotency: dedup key = (tokenId, half-hour bucket).
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { poly } from "@adapters/polymarket/client";
import {
  detectSelfMakerOpportunity,
  type BinaryBookSnapshot,
  type BookLevel,
} from "../src/lib/strategies/self-maker-basket.ts";

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
}
function flagNum(name: string, fallback: number): number {
  const v = flag(name);
  return v != null ? Number(v) : fallback;
}

const ASSET = flag("asset");
const DURATION = flag("duration");
const SOURCE = (flag("source") ?? "binaries") as "binaries" | "samples";
const LIMIT = flagNum("limit", 100);
const MIN_EDGE = flagNum("min-edge", 0.02);
const MAX_USD = flagNum("max-usd", 25);
const FEE_BPS = flagNum("fee-bps", 50);
const AGGR = flagNum("aggressiveness", 0.5);
const DRY_RUN = args.includes("--dry-run");

const handle = db();

type BinaryRow = {
  token_id: string;          // YES side
  no_token_id: string | null;
  condition_id: string;
  question: string;
  asset: string;
  duration_kind: string;
  expiry_iso: string;
};

(async () => {
  console.log(
    `[scan-self-maker] source=${SOURCE} asset=${ASSET ?? "*"} duration=${DURATION ?? "*"} ` +
      `min-edge=$${MIN_EDGE} max-usd=$${MAX_USD} fee=${FEE_BPS}bps aggr=${AGGR}` +
      (DRY_RUN ? " DRY_RUN" : ""),
  );

  let rows: BinaryRow[];
  if (SOURCE === "samples") {
    // Use the CLOB sampling-markets endpoint (reward-eligible, deep liquidity).
    const samples = await poly.samplingMarkets(LIMIT);
    rows = ((samples.data ?? []) as any[])
      .map((m) => {
        const tokens = (m.tokens ?? []) as Array<{ token_id: string; outcome: string }>;
        const yesToken = tokens.find((t) => /yes/i.test(String(t.outcome))) ?? tokens[0];
        const noToken = tokens.find((t) => /no/i.test(String(t.outcome))) ?? tokens[1];
        if (!yesToken || !noToken) return null;
        return {
          token_id: yesToken.token_id,
          no_token_id: noToken.token_id,
          condition_id: m.condition_id ?? "",
          question: m.question ?? "",
          asset: m.category ?? "unknown",
          duration_kind: "—",
          expiry_iso: m.end_date_iso ?? new Date(Date.now() + 7 * 86_400_000).toISOString(),
        } as BinaryRow;
      })
      .filter((x): x is BinaryRow => x !== null);
  } else {
    const clauses: string[] = [
      "settled = 0",
      "expiry_iso > datetime('now')",
      "no_token_id IS NOT NULL",
    ];
    const params: any[] = [];
    if (ASSET) {
      clauses.push("asset = ?");
      params.push(ASSET);
    }
    if (DURATION) {
      clauses.push("duration_kind = ?");
      params.push(DURATION);
    }
    rows = handle
      .prepare(
        `SELECT token_id, no_token_id, condition_id, question, asset, duration_kind, expiry_iso
           FROM poly_binaries
          WHERE ${clauses.join(" AND ")}
          ORDER BY expiry_iso ASC
          LIMIT ?`,
      )
      .all(...params, LIMIT) as BinaryRow[];
  }

  console.log(`[scan-self-maker] ${rows.length} candidate markets`);

  let scanned = 0;
  let enters = 0;
  let logged = 0;
  let deduped = 0;
  const failByReason: Record<string, number> = {};
  const bucket = `${new Date().toISOString().slice(0, 13)}-${Math.floor(new Date().getMinutes() / 30)}`;

  for (const row of rows) {
    scanned++;
    try {
      const [yesBook, noBook] = await Promise.all([
        poly.orderbook(row.token_id),
        row.no_token_id ? poly.orderbook(row.no_token_id) : Promise.resolve(null),
      ]);
      if (!noBook) {
        failByReason["no_no_token"] = (failByReason["no_no_token"] ?? 0) + 1;
        continue;
      }

      const snapshot: BinaryBookSnapshot = {
        conditionId: row.condition_id,
        title: row.question,
        yesBids: parseLevels(yesBook?.bids),
        yesAsks: parseLevels(yesBook?.asks),
        noBids: parseLevels(noBook?.bids),
        noAsks: parseLevels(noBook?.asks),
        windowCloseMs: new Date(row.expiry_iso).getTime(),
        nowMs: Date.now(),
        feeBps: FEE_BPS,
      };

      const opp = detectSelfMakerOpportunity(snapshot, {
        minNetEdgePerPair: MIN_EDGE,
        maxUsdPerPair: MAX_USD,
        bidAggressivenessFraction: AGGR,
      });
      if (!opp) {
        failByReason["no_opportunity"] = (failByReason["no_opportunity"] ?? 0) + 1;
        continue;
      }
      enters++;

      // Dedup.
      const existing = handle
        .prepare(
          `SELECT 1 FROM evolution_log
            WHERE event_type = 'self-maker-opportunity'
              AND created_at >= datetime('now', '-1 day')
              AND payload_json LIKE ?`,
        )
        .get(`%"conditionId":"${opp.conditionId}"%"bucket":"${bucket}"%`);
      if (existing) {
        deduped++;
        continue;
      }

      const summary =
        `SELF-MAKER ${(opp.title ?? opp.conditionId).slice(0, 50)} ` +
        `bid YES@${opp.yesBidPrice.toFixed(3)} + NO@${opp.noBidPrice.toFixed(3)} ` +
        `→ edge $${opp.netEdgePerPair.toFixed(3)}/pair ` +
        `(${opp.maxPairs} pairs, ${(opp.expectedAnnualizedYield * 100).toFixed(0)}%apy)`;
      console.log(`  ↳ ${summary}`);
      if (!DRY_RUN) {
        insertEvolutionEvent({
          event_type: "self-maker-opportunity",
          summary,
          payload_json: JSON.stringify({
            ...opp,
            marketKey: opp.conditionId,
            marketTitle: opp.title,
            asset: row.asset,
            durationKind: row.duration_kind,
            yesTokenId: row.token_id,
            noTokenId: row.no_token_id,
            bucket,
          }),
        });
        logged++;
      }
    } catch (err) {
      failByReason["fetch_error"] = (failByReason["fetch_error"] ?? 0) + 1;
      console.error(`  ! ${row.token_id.slice(0, 12)}: ${(err as Error).message}`);
    }
  }

  const passSummary = Object.entries(failByReason)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `[scan-self-maker] scanned=${scanned} ENTER=${enters} logged=${logged} deduped=${deduped} fail[${passSummary}]`,
  );

  if (enters === 0 && !DRY_RUN) {
    insertEvolutionEvent({
      event_type: "self-maker-scan-empty",
      summary: `SELF-MAKER: 0 enters in ${scanned} markets (min-edge ${MIN_EDGE})`,
      payload_json: JSON.stringify({ scanned, minEdge: MIN_EDGE, asset: ASSET, duration: DURATION }),
    });
  }
})().catch((err) => {
  console.error("[scan-self-maker] FAILED:", err);
  process.exit(1);
});

function parseLevels(raw: any): BookLevel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((l: any) => ({
      price: Number(l.price),
      sizeUsd: Number(l.size) * Number(l.price),
    }))
    .filter((l) => Number.isFinite(l.price) && Number.isFinite(l.sizeUsd) && l.price > 0 && l.price < 1);
}
