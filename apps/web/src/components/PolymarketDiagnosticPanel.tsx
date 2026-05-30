"use client";

/**
 * PolymarketDiagnosticPanel — live proof that Polymarket data is flowing.
 *
 * Polls /api/polymarket/health every 3 seconds, showing per-endpoint latency,
 * the sample orderbook payload for the current BTC binary's UP + DOWN tokens,
 * and a summary health line. Useful when debugging "is the data feed alive?"
 * questions or just for visible reassurance that the page isn't stale.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type EndpointResult =
  | { ok: true; latency_ms: number; sample: unknown }
  | { ok: false; latency_ms: number; error: string };

type BookSample = {
  best_ask: number | null;
  best_bid: number | null;
  ask_levels: number;
  bid_levels: number;
  ask_top1_depth_usd: number;
  bid_top1_depth_usd: number;
  raw: { asks: Array<{ price: string; size: string }>; bids: Array<{ price: string; size: string }> };
};

type HealthResponse = {
  ok: boolean;
  error?: string;
  server_ts_ms: number;
  server_elapsed_ms: number;
  asset: string;
  binary: { question: string; conditionId: string; expiryIso: string; upTokenId: string; downTokenId: string | null };
  endpoints: Array<{ name: string; path: string; result: EndpointResult }>;
  summary: { up_book: BookSample | null; down_book: BookSample | null; midpoint_value: number | null; search_count: number };
  health: { endpoints_total: number; endpoints_ok: number; endpoints_failed: number; total_latency_ms: number; avg_latency_ms: number };
};

export function PolymarketDiagnosticPanel({ asset = "BTC" }: { asset?: string }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetchEnd, setLastFetchEnd] = useState<number>(0);
  const [expanded, setExpanded] = useState(false);
  const failsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [, forceRerender] = useState(0);

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch(`/api/polymarket/health?asset=${asset}`, { cache: "no-store", signal: ac.signal });
      const json = (await res.json()) as HealthResponse;
      if (!json.ok) {
        failsRef.current += 1;
        if (failsRef.current >= 3) setErr(json.error ?? `HTTP ${res.status}`);
        return;
      }
      failsRef.current = 0;
      setErr(null);
      setData(json);
      setLastFetchEnd(Date.now());
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      failsRef.current += 1;
      if (failsRef.current >= 3) setErr((e as Error).message);
    }
  }, [asset]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      await fetchOnce();
      if (cancelled) return;
      const delay = failsRef.current >= 3 ? 6000 : 3000;
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => { cancelled = true; clearTimeout(timer!); abortRef.current?.abort(); };
  }, [fetchOnce]);

  useEffect(() => {
    const id = setInterval(() => forceRerender((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);

  const sinceFetch = data ? Date.now() - lastFetchEnd : null;

  if (err && !data) {
    return (
      <section className="card border-accent-red/40 bg-accent-red/5">
        <div className="text-sm text-accent-red">Polymarket diagnostic: {err}</div>
      </section>
    );
  }
  if (!data) {
    return <section className="card text-xs text-zinc-500">Polymarket diagnostic loading…</section>;
  }

  const allOk = data.health.endpoints_failed === 0;
  return (
    <section className={`card ${allOk ? "border-accent-green/30" : "border-accent-amber/40 bg-accent-amber/5"}`}>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2 className="card-title m-0">
          Polymarket pipeline health
          <span className={`ml-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border ${allOk ? "border-accent-green/40 text-accent-green bg-accent-green/10" : "border-accent-amber/40 text-accent-amber bg-accent-amber/10"}`}>
            {data.health.endpoints_ok}/{data.health.endpoints_total} endpoints OK
          </span>
        </h2>
        <button onClick={() => setExpanded((e) => !e)} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">
          {expanded ? "hide raw samples" : "show raw samples"}
        </button>
      </div>
      <p className="text-xs text-zinc-400 mb-3">
        Live pings to four Polymarket endpoints for the current BTC binary.
        Per-endpoint latency below; failed endpoints highlighted in red.
        Refreshes every 3s (every 6s if failing).
        {err && <span className="text-accent-amber ml-1">⚠ last error: {err.slice(0, 60)}</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {data.endpoints.map((e) => (
          <div key={e.name} className={`border rounded p-2 ${e.result.ok ? "border-zinc-800" : "border-accent-red/50 bg-accent-red/5"}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-zinc-200 font-medium">{e.name}</span>
              <span className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded ${e.result.latency_ms < 200 ? "bg-accent-green/15 text-accent-green" : e.result.latency_ms < 700 ? "bg-accent-amber/15 text-accent-amber" : "bg-accent-red/15 text-accent-red"}`}>
                {e.result.latency_ms}ms
              </span>
            </div>
            <div className="text-[10px] font-mono text-zinc-500 truncate">{e.path}</div>
            {e.result.ok ? null : <div className="text-[11px] text-accent-red mt-1">{e.result.error}</div>}
          </div>
        ))}
      </div>

      {/* Sample orderbook + midpoint summary */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <SampleBook label="UP token book" book={data.summary.up_book} />
        <SampleBook label="DOWN token book" book={data.summary.down_book} />
        <div className="border border-zinc-800 rounded p-2">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">midpoint endpoint</div>
          <div className="text-zinc-200 tabular-nums text-base">
            {data.summary.midpoint_value != null ? `${(data.summary.midpoint_value * 100).toFixed(2)}%` : "—"}
          </div>
          <div className="text-[10px] text-zinc-500 mt-1">implied UP via /clob/midpoint</div>
          <div className="text-[10px] text-zinc-500 mt-2">gamma search returned {data.summary.search_count} events</div>
        </div>
      </div>

      {/* Raw samples (collapsed by default) */}
      {expanded && (
        <details open className="mt-3 border-t border-zinc-800 pt-2">
          <summary className="cursor-pointer text-[10px] text-zinc-500 mb-1">raw orderbook top-3 levels (UP)</summary>
          <pre className="text-[10px] font-mono bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto">
{JSON.stringify(data.summary.up_book?.raw ?? {}, null, 2)}
          </pre>
          {data.summary.down_book && (
            <>
              <summary className="cursor-pointer text-[10px] text-zinc-500 mb-1 mt-2">raw orderbook top-3 levels (DOWN)</summary>
              <pre className="text-[10px] font-mono bg-zinc-950 border border-zinc-800 rounded p-2 overflow-x-auto">
{JSON.stringify(data.summary.down_book.raw, null, 2)}
              </pre>
            </>
          )}
        </details>
      )}

      <div className="mt-3 text-[10px] text-zinc-500 flex items-center justify-between">
        <span>binary: <span className="text-zinc-300">{data.binary.question.slice(0, 50)}</span></span>
        <span>
          last fetch{" "}
          <span className={sinceFetch && sinceFetch > 6000 ? "text-accent-red" : "text-accent-green"}>{sinceFetch}ms ago</span>
          {" · "}avg latency {data.health.avg_latency_ms}ms
          {" · "}server {data.server_elapsed_ms}ms
        </span>
      </div>
    </section>
  );
}

function SampleBook({ label, book }: { label: string; book: BookSample | null }) {
  return (
    <div className="border border-zinc-800 rounded p-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</div>
      {!book ? (
        <div className="text-[11px] text-zinc-600">unavailable</div>
      ) : (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-zinc-500">best ask</span>
            <span className="text-zinc-200 tabular-nums">
              {book.best_ask != null ? `$${book.best_ask.toFixed(3)}` : "—"}
              <span className="text-zinc-600 text-[9px] ml-1">(${book.ask_top1_depth_usd.toFixed(0)})</span>
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-zinc-500">best bid</span>
            <span className="text-zinc-200 tabular-nums">
              {book.best_bid != null ? `$${book.best_bid.toFixed(3)}` : "—"}
              <span className="text-zinc-600 text-[9px] ml-1">(${book.bid_top1_depth_usd.toFixed(0)})</span>
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-zinc-500">
            <span>levels</span>
            <span className="tabular-nums">{book.bid_levels} bid · {book.ask_levels} ask</span>
          </div>
        </div>
      )}
    </div>
  );
}
