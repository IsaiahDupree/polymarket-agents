#!/usr/bin/env tsx
/**
 * worker:gpu-oracle — paper-only inference worker.
 *
 * Loads a trained ONNX checkpoint, polls active binaries every N seconds,
 * runs inference, and logs every decision to evolution_log. Does NOT
 * execute trades — calling this worker can never put real or paper
 * money at risk.
 *
 * Purpose: get the GPU oracle in front of the data stream while the
 * genome-level integration is still pending. Lets the operator:
 *   - See predictions in real time (via /quality or evolution_log)
 *   - Catch decide-time integration bugs (feature mismatch, etc.) early
 *   - Build calibration history before live wiring
 *
 * Usage:
 *   npm run worker:gpu-oracle
 *   npm run worker:gpu-oracle -- --interval-sec 30 \
 *       --model train/checkpoints/lstm_v2_ofi_ts_cal.onnx
 *
 * Safety:
 *   - Never imports execute.ts / venue routers
 *   - Logs to evolution_log with event_type='gpu-oracle-decision'
 *   - One row per (binary, tick) — no order side effects
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { recordHeartbeat } from "../src/lib/heartbeat.ts";
import { predictYesProbability, probabilityToSignal } from "../src/lib/arena/gpu-oracle.ts";
import { parseClobBook } from "../src/lib/quant/book-snapshot-lookup.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
const runOnce = process.argv.includes("--once");
const intervalSec = Number(arg("interval-sec", "30"));
const modelPath = arg("model", "train/checkpoints/lstm_v2_ofi_ts_cal.onnx")!;
const horizonMin = Number(arg("horizon-min", "30"));
const maxBinaries = Number(arg("max-binaries", "20"));
const stakeUsd = Number(arg("stake-usd", "2"));
const thresholdYes = Number(arg("threshold-yes", "0.60"));
const thresholdNo = Number(arg("threshold-no", "0.40"));

type ActiveBinary = {
  token_id: string;
  no_token_id: string | null;
  event_slug: string | null;
  question: string;
  asset: string;
  duration_kind: string;
  expiry_iso: string;
};

function pickActiveBinaries(): ActiveBinary[] {
  const horizonIso = new Date(Date.now() + horizonMin * 60_000).toISOString();
  const nowIso = new Date().toISOString();
  return db().prepare(`
    SELECT token_id, no_token_id, event_slug, question, asset, duration_kind, expiry_iso
      FROM poly_binaries
     WHERE settled = 0
       AND expiry_iso BETWEEN ? AND ?
       AND event_slug IS NOT NULL
     ORDER BY expiry_iso ASC
     LIMIT ?
  `).all(nowIso, horizonIso, maxBinaries) as ActiveBinary[];
}

function buildFeatures(b: ActiveBinary, decisionUnixMs: number) {
  // Pull the YES price trajectory from api_call_cache (last N gamma snapshots).
  // The model's lookback (set in its meta.json) controls how many we need;
  // pull 30 to be safe, the loader slices to the right size.
  const slugPattern = `slug=${b.event_slug}`;
  const cacheRows = db().prepare(`
    SELECT response_body, fetched_at
      FROM api_call_cache
     WHERE source='polymarket-gamma' AND endpoint='/markets'
       AND query_string = ?
     ORDER BY fetched_at DESC
     LIMIT 30
  `).all(slugPattern) as Array<{ response_body: string; fetched_at: string }>;
  const prices: number[] = [];
  let yesPrice = 0.5, noPrice = 0.5, volume = 0, liquidity = 0;
  for (const r of cacheRows.reverse()) {  // chronological
    try {
      const body = JSON.parse(r.response_body);
      const first = Array.isArray(body) ? body[0] : body;
      if (!first) continue;
      const rawPrices = first.outcomePrices;
      let p: number[] = [];
      if (typeof rawPrices === "string") {
        try { p = (JSON.parse(rawPrices) as string[]).map(Number); } catch { /* skip */ }
      } else if (Array.isArray(rawPrices)) p = (rawPrices as number[]).map(Number);
      if (p.length >= 1 && Number.isFinite(p[0])) {
        prices.push(p[0]);
        yesPrice = p[0];
        noPrice = p[1] ?? 1 - p[0];
      }
      volume = Number(first.volumeNum ?? first.volume ?? 0);
      liquidity = Number(first.liquidity ?? 0);
    } catch { /* skip bad row */ }
  }

  // Book snapshot features at decision time
  const yesTok = b.token_id;
  const bookRow = db().prepare(`
    SELECT total_bid_depth, total_ask_depth, spread, bid_price, bid_size, ask_price, ask_size, ts_unix_ms
      FROM book_snapshots
     WHERE token_id = ? AND ts_unix_ms <= ?
     ORDER BY ts_unix_ms DESC
     LIMIT 1
  `).get(yesTok, decisionUnixMs) as
    { total_bid_depth: number | null; total_ask_depth: number | null; spread: number | null;
      bid_price: number | null; bid_size: number | null; ask_price: number | null; ask_size: number | null;
      ts_unix_ms: number } | undefined;

  // OFI: pull a 30s window and re-run the calculator from the TS-side
  // OFI module so features match training exactly.
  const ofiRows = db().prepare(`
    SELECT ts_unix_ms, bid_price, bid_size, ask_price, ask_size
      FROM book_snapshots
     WHERE token_id = ? AND ts_unix_ms BETWEEN ? AND ?
     ORDER BY ts_unix_ms ASC
  `).all(yesTok, decisionUnixMs - 30_000, decisionUnixMs) as
    Array<{ ts_unix_ms: number; bid_price: number | null; bid_size: number | null;
            ask_price: number | null; ask_size: number | null }>;

  // Compute three OFI values at 1s / 5s / 30s windows
  let ofi1s = 0, ofi5s = 0, ofi30s = 0;
  if (ofiRows.length >= 2) {
    const samples = ofiRows
      .filter((r) => r.bid_price !== null && r.bid_size !== null && r.ask_price !== null && r.ask_size !== null)
      .map((r) => ({ ts: r.ts_unix_ms / 1000, bidPx: Number(r.bid_price), bidSz: Number(r.bid_size),
                     askPx: Number(r.ask_price), askSz: Number(r.ask_size) }));
    if (samples.length >= 2) {
      const { runOfiOverHistory } = require("../src/lib/quant/ofi.ts");
      ofi1s = runOfiOverHistory(samples, 1.0);
      ofi5s = runOfiOverHistory(samples, 5.0);
      ofi30s = runOfiOverHistory(samples, 30.0);
    }
  }

  // Minutes to resolution
  const expiryMs = new Date(b.expiry_iso).getTime();
  const minToResolution = (expiryMs - decisionUnixMs) / 60_000;

  return {
    price_window: prices.slice(-30),
    yes_price: yesPrice,
    no_price: noPrice,
    volume_usd: volume,
    liquidity_usd: liquidity,
    min_to_resolution: minToResolution,
    total_bid_depth: Number(bookRow?.total_bid_depth ?? 0),
    total_ask_depth: Number(bookRow?.total_ask_depth ?? 0),
    spread: Number(bookRow?.spread ?? 0),
    ofi_1s: ofi1s,
    ofi_5s: ofi5s,
    ofi_30s: ofi30s,
  };
}

async function pass(): Promise<void> {
  const t0 = Date.now();
  const binaries = pickActiveBinaries();
  if (binaries.length === 0) {
    console.log(`[gpu-oracle] no active binaries in next ${horizonMin}min`);
    return;
  }
  const decisionMs = Date.now();
  let predicted = 0, skipped = 0, errored = 0;
  for (const b of binaries) {
    try {
      const features = buildFeatures(b, decisionMs);
      if (features.price_window.length < 4) {
        skipped++;
        continue;
      }
      const prob = await predictYesProbability(modelPath, features);
      const sig = probabilityToSignal(prob, features.yes_price,
        { threshold_buy_yes: thresholdYes, threshold_buy_no: thresholdNo, stake_usd: stakeUsd },
        b.event_slug ?? b.token_id);
      // Log to evolution_log as a paper-only decision; no execution.
      insertEvolutionEvent({
        event_type: "gpu-oracle-decision",
        summary: `${b.asset} ${b.duration_kind} ${sig.action}${sig.action === "BUY" ? " " + sig.side : ""}` +
                 ` (P(YES)=${prob.toFixed(3)} market=${features.yes_price.toFixed(3)})`,
        payload_json: JSON.stringify({
          slug: b.event_slug,
          asset: b.asset,
          duration_kind: b.duration_kind,
          decision_ts: new Date(decisionMs).toISOString(),
          expiry_iso: b.expiry_iso,
          prob_yes: prob,
          market_yes_price: features.yes_price,
          signal: sig,
          model_path: modelPath,
          ofi: { ofi_1s: features.ofi_1s, ofi_5s: features.ofi_5s, ofi_30s: features.ofi_30s },
        }),
      });
      predicted++;
    } catch (e) {
      errored++;
      console.warn(`[gpu-oracle] ${b.event_slug ?? b.token_id} failed: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  recordHeartbeat("gpu-oracle" as any /* extend SubsystemName when promoting */, {
    binaries: binaries.length, predicted, skipped, errored,
  });
  console.log(`[gpu-oracle] cycle: binaries=${binaries.length} predicted=${predicted} skipped=${skipped} err=${errored} ${Date.now() - t0}ms`);
}

(async () => {
  console.log(`[gpu-oracle] starting: model=${modelPath} interval=${intervalSec}s horizon=${horizonMin}min`);
  if (runOnce) {
    await pass();
    return;
  }
  while (true) {
    const t0 = Date.now();
    try { await pass(); }
    catch (e) { console.error(`[gpu-oracle] pass failed: ${(e as Error).message}`); }
    const elapsed = Date.now() - t0;
    await new Promise((r) => setTimeout(r, Math.max(0, intervalSec * 1000 - elapsed)));
  }
})().catch((e) => {
  console.error(`[gpu-oracle] fatal: ${(e as Error).message}`);
  process.exit(1);
});
