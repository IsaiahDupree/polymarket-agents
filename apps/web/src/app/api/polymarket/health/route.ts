/**
 * GET /api/polymarket/health
 *
 * Live diagnostic that proves Polymarket data is flowing into the app and
 * surfaces what the UI sees. Hits four endpoints against the current 5-min
 * BTC binary and reports latency + sample payload per endpoint:
 *
 *   • CLOB orderbook (UP token) — top bids/asks + depth
 *   • CLOB orderbook (DOWN token) — same
 *   • CLOB midpoint (UP token) — single-value implied UP
 *   • Gamma events search (BTC up-or-down) — list-of-events sanity check
 *
 * Each endpoint is measured independently so partial failures are obvious.
 */
import { NextResponse } from "next/server";
import { poly } from "@adapters/polymarket/client";
import { findBinaryWindow } from "@/lib/arena/binary-window";

export const dynamic = "force-dynamic";

type EndpointResult =
  | { ok: true; latency_ms: number; sample: unknown }
  | { ok: false; latency_ms: number; error: string };

async function timed<T>(label: string, fn: () => Promise<T>): Promise<EndpointResult> {
  const t0 = Date.now();
  try {
    const sample = await fn();
    return { ok: true, latency_ms: Date.now() - t0, sample };
  } catch (err) {
    return { ok: false, latency_ms: Date.now() - t0, error: (err as Error).message?.slice(0, 200) ?? "unknown" };
  }
}

type BookSample = {
  best_ask: number | null;
  best_bid: number | null;
  ask_levels: number;
  bid_levels: number;
  ask_top1_depth_usd: number;
  bid_top1_depth_usd: number;
  raw: unknown;
};

function summarizeBook(book: unknown): BookSample {
  const b = book as { bids?: Array<{ price: string; size: string }>; asks?: Array<{ price: string; size: string }> };
  const asks = Array.isArray(b?.asks) ? b.asks : [];
  const bids = Array.isArray(b?.bids) ? b.bids : [];
  const bestAsk = asks[0]?.price ? Number(asks[0].price) : null;
  const bestBid = bids[0]?.price ? Number(bids[0].price) : null;
  return {
    best_ask: Number.isFinite(bestAsk!) ? bestAsk : null,
    best_bid: Number.isFinite(bestBid!) ? bestBid : null,
    ask_levels: asks.length,
    bid_levels: bids.length,
    ask_top1_depth_usd: bestAsk != null && Number(asks[0]?.size) ? bestAsk * Number(asks[0].size) : 0,
    bid_top1_depth_usd: bestBid != null && Number(bids[0]?.size) ? bestBid * Number(bids[0].size) : 0,
    raw: { asks: asks.slice(0, 3), bids: bids.slice(0, 3) },
  };
}

export async function GET(req: Request) {
  const tServerStart = Date.now();
  const url = new URL(req.url);
  const asset = url.searchParams.get("asset") ?? "BTC";

  const binary = findBinaryWindow(asset, null);
  if (!binary) {
    return NextResponse.json({
      ok: false,
      error: `No live ${asset} 5-min binary in poly_binaries. Run the binary catalogue fetcher (worker:realtime or scripts/scan-binaries).`,
    }, { status: 404 });
  }

  // Hit four endpoints in parallel for a true latency measurement.
  const [upBook, downBook, midpoint, search] = await Promise.all([
    timed("clob.orderbook(UP)", () => poly.orderbook(binary.upTokenId)),
    binary.downTokenId
      ? timed("clob.orderbook(DOWN)", () => poly.orderbook(binary.downTokenId!))
      : Promise.resolve<EndpointResult>({ ok: false, latency_ms: 0, error: "no down_token_id in DB" }),
    timed("clob.midpoint(UP)", () => poly.midpoint(binary.upTokenId)),
    timed("gamma.search(BTC up-or-down)", () => poly.search("bitcoin up or down", 3)),
  ]);

  // Per-endpoint summary so the UI can render quickly without re-parsing raw.
  const summary = {
    up_book: upBook.ok ? summarizeBook(upBook.sample) : null,
    down_book: downBook.ok ? summarizeBook(downBook.sample) : null,
    midpoint_value: midpoint.ok
      ? Number((midpoint.sample as { mid?: string }).mid ?? NaN)
      : null,
    search_count: search.ok && Array.isArray((search.sample as { tags?: unknown[] })?.tags ?? search.sample)
      ? Array.isArray(search.sample) ? (search.sample as unknown[]).length : 0
      : 0,
  };

  const endpoints = [
    { name: "CLOB orderbook (UP)", path: `/clob/book?token_id=${binary.upTokenId.slice(0, 12)}…`, result: upBook },
    { name: "CLOB orderbook (DOWN)", path: binary.downTokenId ? `/clob/book?token_id=${binary.downTokenId.slice(0, 12)}…` : "no down_token_id", result: downBook },
    { name: "CLOB midpoint (UP)", path: `/clob/midpoint?token_id=${binary.upTokenId.slice(0, 12)}…`, result: midpoint },
    { name: "Gamma search", path: "/gamma/...?q=bitcoin up or down", result: search },
  ];

  const okCount = endpoints.filter((e) => e.result.ok).length;
  const totalLatency = endpoints.reduce((s, e) => s + e.result.latency_ms, 0);
  return NextResponse.json({
    ok: true,
    server_ts_ms: Date.now(),
    server_elapsed_ms: Date.now() - tServerStart,
    asset,
    binary: {
      question: binary.question,
      conditionId: binary.conditionId,
      expiryIso: binary.expiryIso,
      upTokenId: binary.upTokenId,
      downTokenId: binary.downTokenId,
    },
    endpoints,
    summary,
    health: {
      endpoints_total: endpoints.length,
      endpoints_ok: okCount,
      endpoints_failed: endpoints.length - okCount,
      total_latency_ms: totalLatency,
      avg_latency_ms: Math.round(totalLatency / Math.max(1, endpoints.length)),
    },
  });
}
