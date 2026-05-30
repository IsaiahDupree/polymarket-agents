"use client";

/**
 * LiveBinaryPanel — focused real-time view of one 5-min binary window with
 * every agent's prediction side-by-side against the market.
 *
 * Polls /api/arena/binary-now once a second. Prev/next buttons navigate to
 * adjacent 5-min windows. Window progress bar shows where we are; the
 * "optimal bet window" (2–3 min after start) is highlighted because the
 * operator observed that's when agents typically place. Latency badge shows
 * round-trip + server-side breakdown so you can see if the book is fresh.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StageCapsuleForm } from "./StageCapsuleForm";
import { BinaryChart, type ChartMode, type HistoryPoint, type SeriesPoint } from "./BinaryChart";

type Confidence = "high" | "medium" | "low" | "none";

type SubPrediction = {
  kind: string;
  upProb: number | null;
  confidence: Confidence;
  rationale: string;
};

type AgentPrediction = {
  upProb: number | null;
  confidence: Confidence;
  rationale: string;
  subs?: SubPrediction[];
};

type Agent = {
  id: number;
  name: string;
  generation: number;
  is_elite: boolean;
  strategy_nick: string;
  strategy_kind: string;
  lifetime_pnl: number;
  trades_count: number;
  win_pct: number;
  capsule_id: string | null;
  capsule_status: string | null;
  capsule_capital: number | null;
  prediction: AgentPrediction;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  hint?: string;
  server_ts_ms: number;
  server_elapsed_ms: number;
  quote_fetch_ms: number;
  asset: string;
  binary: {
    upTokenId: string;
    downTokenId: string | null;
    conditionId: string;
    question: string;
    asset: string;
    startIso: string | null;
    expiryIso: string;
    durationMin: number;
  };
  time: {
    nowIso: string;
    nowEpochMs: number;
    startEpochMs: number | null;
    expiryEpochMs: number;
    elapsedSec: number;
    remainingSec: number;
    fractionElapsed: number;
    optimalBetWindowStartSec: number;
    optimalBetWindowEndSec: number;
    inOptimalBetWindow: boolean;
    pastOptimalBetWindow: boolean;
  };
  quote: {
    upBestAsk: number | null;
    upBestBid: number | null;
    upAskDepthShares: number;
    upAskDepthUsd: number;
    downBestAsk: number | null;
    downBestBid: number | null;
    downAskDepthShares: number;
    downAskDepthUsd: number;
    topNDepthUsd: number;
    upImpliedProb: number | null;
  };
  nav: {
    prev_epoch_ms: number | null;
    next_epoch_ms: number | null;
    prev_question: string | null;
    next_question: string | null;
  };
  agents: Agent[];
  staged_capsules: Array<{ id: string; name: string; status: string; capital_allocated_usd: number; paper_agent_id: number | null }>;
  series: {
    btc: SeriesPoint[];
    reference_price: number | null;
    reference_ts_ms: number | null;
    product_id: string | null;
    market_up: Array<{ ts_ms: number; market_up: number }>;
  };
};

type Props = {
  asset?: string;
  initialLimit?: number;
};

export function LiveBinaryPanel({ asset = "BTC", initialLimit = 15 }: Props) {
  const [windowEpoch, setWindowEpoch] = useState<number | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchMs, setLastFetchMs] = useState<number>(0);
  const [lastFetchEnd, setLastFetchEnd] = useState<number>(0);
  const [paused, setPaused] = useState(false);
  const [chartMode, setChartMode] = useState<ChartMode>("market");
  const [agentSet, setAgentSet] = useState<"top" | "archetypes" | "all">("top");
  // Lifetime-PnL floor — defaults to 0 (show everything alive). Operator can
  // raise this to filter out small-PnL agents and focus on real performers.
  const [minPnlUsd, setMinPnlUsd] = useState<number>(0);
  // Track when the MARKET implied UP value LAST CHANGED so we can show "last
  // moved Xs ago" even when the value itself is stable (e.g. near resolution).
  // This is proof-of-life: the polling IS running, the number just isn't moving.
  const lastChangedMsRef = useRef<number>(Date.now());
  const lastMarketUpRef = useRef<number | null>(null);
  const lastUpDeltaRef = useRef<number>(0);
  // History buffer keyed by conditionId — MARKET implied UP% + AGENT consensus
  // UP% accumulated client-side across polls. Resets when the window changes.
  const [history, setHistory] = useState<Map<string, HistoryPoint[]>>(new Map());
  const [, forceRerender] = useState(0); // tick-the-clock for latency badge
  // Consecutive failure tracker — we silently retry until this crosses a
  // threshold, then we surface the error UI. Turbopack hot-reload routinely
  // kills in-flight fetches, so a strict "show error on first miss" loop
  // would flash red constantly during dev. Stored in a ref so the counter
  // updates don't trigger re-renders.
  const consecutiveFailsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    // Abort any prior in-flight request so we don't pile up stale responses.
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const t0 = performance.now();
    try {
      const q = new URLSearchParams({ asset, limit: String(initialLimit), agent_set: agentSet });
      if (windowEpoch != null) q.set("windowEpoch", String(windowEpoch));
      if (minPnlUsd !== 0) q.set("min_pnl", String(minPnlUsd));
      const res = await fetch(`/api/arena/binary-now?${q.toString()}`, {
        cache: "no-store",
        signal: ac.signal,
      });
      const json = (await res.json().catch(() => ({}))) as ApiResponse;
      const t1 = performance.now();
      setLastFetchMs(t1 - t0);
      setLastFetchEnd(Date.now());
      if (!json.ok) {
        consecutiveFailsRef.current += 1;
        if (consecutiveFailsRef.current >= 3) setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      // Success — reset failure counter, clear any previous error UI.
      consecutiveFailsRef.current = 0;
      setError(null);
      setData(json);
      // Track MARKET UP movement for the "last moved Xs ago" badge — uses
      // a tiny tolerance (>= 0.0005 = 0.05pp) so book-precision noise
      // doesn't count as a real move.
      const newUp = json.quote.upImpliedProb;
      if (newUp != null && lastMarketUpRef.current != null) {
        const delta = newUp - lastMarketUpRef.current;
        if (Math.abs(delta) >= 0.0005) {
          lastChangedMsRef.current = Date.now();
          lastUpDeltaRef.current = delta;
        }
      }
      lastMarketUpRef.current = newUp;
      // Accumulate history for this conditionId so the MARKET + CONSENSUS
      // charts have a series even though the server doesn't store it yet.
      // Confidence-weighted mean over agents with a non-null prediction.
      const condId = json.binary.conditionId;
      const marketUp = json.quote.upImpliedProb;
      let consensusUp: number | null = null;
      if (Array.isArray(json.agents)) {
        const w = (c: Confidence) => c === "high" ? 1 : c === "medium" ? 0.5 : c === "low" ? 0.25 : 0;
        let num = 0, den = 0;
        for (const a of json.agents) {
          if (a.prediction.upProb == null) continue;
          const wi = w(a.prediction.confidence);
          if (wi === 0) continue;
          num += a.prediction.upProb * wi;
          den += wi;
        }
        if (den > 0) consensusUp = num / den;
      }
      const point: HistoryPoint = { ts_ms: json.server_ts_ms ?? Date.now(), market_up: marketUp, consensus_up: consensusUp };
      setHistory((prev) => {
        const next = new Map(prev);
        const arr = next.get(condId) ?? [];
        // Cap buffer at 600 entries (~10 min @ 1Hz) so memory stays bounded.
        const capped = arr.length >= 600 ? arr.slice(arr.length - 599) : arr;
        next.set(condId, [...capped, point]);
        return next;
      });
    } catch (err) {
      // AbortError is expected when we intentionally cancel an in-flight
      // request (e.g. user clicked prev/next while a poll was pending). Don't
      // count it as a failure or surface it.
      if ((err as Error)?.name === "AbortError") return;
      consecutiveFailsRef.current += 1;
      // Stay quiet until 3 consecutive failures — Turbopack hot-reload kills
      // in-flight fetches routinely in dev, so flashing red on each miss is
      // noise. After 3 misses something is actually wrong.
      if (consecutiveFailsRef.current >= 3) setError((err as Error).message);
    }
  }, [asset, initialLimit, windowEpoch, agentSet, minPnlUsd]);

  // Polling loop with backoff on errors:
  //   0 fails  → 1000ms
  //   1–2 fails → 1500ms
  //   3+ fails  → 5000ms (we're showing the error UI by now)
  useEffect(() => {
    if (paused) return;
    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchOnce();
      if (cancelled) return;
      const n = consecutiveFailsRef.current;
      const delay = n >= 3 ? 5000 : n >= 1 ? 1500 : 1000;
      timer = setTimeout(tick, delay);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer!);
      abortRef.current?.abort();
    };
  }, [fetchOnce, paused]);

  // Render-clock tick so the "Xms since last fetch" / countdown updates smoothly
  useEffect(() => {
    const id = setInterval(() => forceRerender((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  const handlePrev = () => { if (data?.nav.prev_epoch_ms) setWindowEpoch(data.nav.prev_epoch_ms); };
  const handleNext = () => { if (data?.nav.next_epoch_ms) setWindowEpoch(data.nav.next_epoch_ms); };
  const handleNow = () => setWindowEpoch(null);

  // Confidence-weighted mean of agent UP% predictions — the "consensus" line.
  // MUST live above any early returns to keep hook order stable across renders
  // (Rules of Hooks). Returns null when there's no data yet OR when no agent
  // has a non-null prediction.
  const consensusUp = useMemo<number | null>(() => {
    if (!data) return null;
    const wMap = { high: 1, medium: 0.5, low: 0.25, none: 0 } as const;
    let num = 0, den = 0;
    for (const a of data.agents) {
      if (a.prediction.upProb == null) continue;
      const wi = wMap[a.prediction.confidence];
      if (wi === 0) continue;
      num += a.prediction.upProb * wi;
      den += wi;
    }
    return den > 0 ? num / den : null;
  }, [data]);

  // Error UI ONLY surfaces when we have no data at all — the inline ⚠ in the
  // footer already covers transient blips while keeping the last good snapshot
  // on screen.
  if (error && !data) {
    return (
      <section className="card border-accent-red/40 bg-accent-red/5">
        <div className="text-sm text-accent-red">Live binary panel: {error}</div>
        <button onClick={fetchOnce} className="mt-2 text-xs underline text-accent-blue">Retry</button>
      </section>
    );
  }
  if (!data) return <section className="card text-xs text-zinc-500">Loading current BTC window…</section>;

  const nowMs = Date.now();
  const sinceFetchMs = nowMs - lastFetchEnd;
  const marketUp = data.quote.upImpliedProb;
  const marketDown = marketUp != null ? 1 - marketUp : null;
  const isLive = windowEpoch == null || Math.abs(windowEpoch - nowMs) < 5 * 60_000;
  // Derive all time values from `nowMs` rather than the server snapshot so
  // they tick locally between polls. The 100ms forceRerender already in place
  // makes this a smooth countdown without an extra fetch.
  const totalSec = data.binary.durationMin * 60;
  const expiryMs = data.time.expiryEpochMs;
  const startMs = expiryMs - totalSec * 1000;
  const liveElapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const liveRemainingSec = Math.max(0, Math.floor((expiryMs - nowMs) / 1000));
  const liveFractionElapsed = Math.max(0, Math.min(1, (nowMs - startMs) / (totalSec * 1000)));
  const optimalLoSec = data.time.optimalBetWindowStartSec;
  const optimalHiSec = data.time.optimalBetWindowEndSec;
  const liveInOptimal = liveElapsedSec >= optimalLoSec && liveElapsedSec <= optimalHiSec;
  const livePastOptimal = liveElapsedSec > optimalHiSec;
  const elapsedFmt = formatMmSs(liveElapsedSec);
  const remainingFmt = formatMmSs(liveRemainingSec);
  const totalFmt = formatMmSs(totalSec);
  const nowClockUtc = new Date(nowMs).toISOString().slice(11, 19);

  return (
    <section className="card border-accent-blue/30 bg-zinc-950">
      {/* Header strip — window title + prev/next + latency */}
      <div className="flex items-start gap-3 mb-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-zinc-100 font-medium text-sm flex items-center gap-2 flex-wrap">
            <span>{data.binary.question}</span>
            {isLive ? (
              <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-accent-green/20 text-accent-green border border-accent-green/40">LIVE</span>
            ) : (
              <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-accent-amber/20 text-accent-amber border border-accent-amber/40">REVIEW</span>
            )}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5 font-mono flex items-center gap-3 flex-wrap">
            <span>{data.binary.conditionId.slice(0, 14)}…</span>
            <span>expiry {new Date(expiryMs).toUTCString().slice(-12, -4)} UTC</span>
            <span className="text-zinc-300">
              now <span className="tabular-nums">{nowClockUtc}Z</span>
              <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse align-middle" />
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={handlePrev}
            disabled={!data.nav.prev_epoch_ms}
            className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title={data.nav.prev_question ?? "no previous window"}
          >← prev 5m</button>
          <button
            onClick={handleNow}
            className={`px-2 py-1 rounded border ${isLive ? "border-accent-green/40 text-accent-green" : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"}`}
          >now</button>
          <button
            onClick={handleNext}
            disabled={!data.nav.next_epoch_ms}
            className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
            title={data.nav.next_question ?? "no next window"}
          >next 5m →</button>
          <button
            onClick={() => setPaused((p) => !p)}
            className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          >{paused ? "▶ play" : "⏸ pause"}</button>
        </div>
      </div>

      {/* Window progress + betting window highlight — fed from LIVE-derived
          values that tick every render (100ms) so the bar slides smoothly. */}
      <WindowProgress
        fractionElapsed={liveFractionElapsed}
        optimalLoSec={optimalLoSec}
        optimalHiSec={optimalHiSec}
        totalSec={totalSec}
      />
      <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
        <span>elapsed <span className="text-zinc-300 tabular-nums">{elapsedFmt}</span> · remaining <span className="text-zinc-300 tabular-nums">{remainingFmt}</span> · total <span className="tabular-nums">{totalFmt}</span></span>
        <span>
          {liveInOptimal
            ? <span className="text-accent-green">★ optimal bet window NOW (2–3 min mark)</span>
            : livePastOptimal
              ? <span className="text-accent-amber">past optimal · {remainingFmt} to close</span>
              : <span className="text-zinc-400">pre-bet · optimal at 2:00–3:00</span>}
        </span>
      </div>

      {/* MARKET big UP/DOWN display.
          Shows proof-of-life: "last moved Xs ago" + last delta + brief flash. */}
      <div className="grid grid-cols-2 gap-3 mt-4">
        <SidePanel side="UP" pct={marketUp} label="MARKET · UP" depthUsd={data.quote.upAskDepthUsd} bestAsk={data.quote.upBestAsk} lastChangedMs={lastChangedMsRef.current} />
        <SidePanel side="DOWN" pct={marketDown} label="MARKET · DOWN" depthUsd={data.quote.downAskDepthUsd} bestAsk={data.quote.downBestAsk} lastChangedMs={lastChangedMsRef.current} />
      </div>
      <div className="mt-2 text-[10px] text-zinc-500 flex justify-between">
        <span>
          {lastUpDeltaRef.current !== 0 && (
            <>last MARKET UP move:{" "}
              <span className={lastUpDeltaRef.current > 0 ? "text-accent-green tabular-nums" : "text-accent-red tabular-nums"}>
                {lastUpDeltaRef.current >= 0 ? "+" : ""}{(lastUpDeltaRef.current * 100).toFixed(2)}pp
              </span>
              {" "}<span className="text-zinc-600">
                · {Math.floor((nowMs - lastChangedMsRef.current) / 1000)}s ago
              </span>
            </>
          )}
        </span>
        <span>top-3 depth across both sides: ${data.quote.topNDepthUsd.toFixed(0)}</span>
      </div>

      {/* Chart strip — toggle between MARKET implied UP%, asset spot price
          (with reference horizontal line at the start-of-window price → the
          literal "target to beat"), and agent CONSENSUS vs MARKET overlay. */}
      <div className="mt-4 border-t border-zinc-800 pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1 text-xs">
            <ChartToggleButton mode="market" active={chartMode} onClick={setChartMode} label="MARKET UP%" />
            <ChartToggleButton mode="btc" active={chartMode} onClick={setChartMode} label={`${data.binary.asset} spot`} />
            <ChartToggleButton mode="consensus" active={chartMode} onClick={setChartMode} label="vs CONSENSUS" />
          </div>
          <span className="text-[10px] text-zinc-500">
            {chartMode === "btc" && data.series.reference_price != null
              ? <>target to beat: <span className="text-accent-yellow tabular-nums font-semibold" style={{ color: "#ffea7e" }}>${data.series.reference_price.toFixed(2)}</span>
                  <span className="text-zinc-600 ml-2">· source: Coinbase {data.series.product_id} (1-min candles + WS ticks)</span></>
              : chartMode === "market"
                ? <>MARKET implied UP — Polymarket midpoint over the window</>
                : <>AGENT confidence-weighted mean UP% vs MARKET</>}
          </span>
        </div>
        <BinaryChart
          mode={chartMode}
          startMs={startMs}
          expiryMs={expiryMs}
          btcSeries={data.series.btc}
          referencePrice={data.series.reference_price}
          history={mergeHistory(data.series.market_up, history.get(data.binary.conditionId) ?? [])}
          marketUpNow={marketUp}
          consensusUpNow={consensusUp}
          productId={data.series.product_id}
        />
      </div>

      {/* Agents grid */}
      <div className="mt-5">
        <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-zinc-200 text-sm font-medium">Agent predictions ({data.agents.length})</h3>
          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-zinc-500 mr-1">show:</span>
            <AgentSetToggle mode="top" active={agentSet} onClick={setAgentSet} label="top PnL" />
            <AgentSetToggle mode="archetypes" active={agentSet} onClick={setAgentSet} label="archetypes" />
            <AgentSetToggle mode="all" active={agentSet} onClick={setAgentSet} label="all" />
            <span className="text-zinc-600 mx-1">·</span>
            <label className="text-zinc-500">min PnL $</label>
            <input
              type="number"
              value={minPnlUsd}
              onChange={(e) => setMinPnlUsd(Number(e.target.value) || 0)}
              step={1}
              className="w-14 px-1 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 tabular-nums"
            />
          </div>
        </div>
        <div className="text-[10px] text-zinc-500 mb-2">
          {agentSet === "archetypes" && <>PRD-seeded archetype agents only · sorted by lifetime PnL{minPnlUsd !== 0 ? ` · floor ≥ $${minPnlUsd}` : ""}</>}
          {agentSet === "top" && <>naturally-evolved winners (archetypes excluded) · sorted by lifetime PnL{minPnlUsd !== 0 ? ` · floor ≥ $${minPnlUsd}` : ""} · color-coded vs market UP{marketUp != null ? ` (${(marketUp * 100).toFixed(0)}%)` : ""}</>}
          {agentSet === "all" && <>archetypes pinned first, then top-PnL fillers{minPnlUsd !== 0 ? ` · floor ≥ $${minPnlUsd}` : ""}</>}
        </div>
        <div className="space-y-1.5">
          {data.agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              marketUp={marketUp}
              conditionId={data.binary.conditionId}
              upTokenId={data.binary.upTokenId}
              downTokenId={data.binary.downTokenId}
              question={data.binary.question}
            />
          ))}
        </div>
      </div>

      {/* Staged capsules already bound to this binary */}
      {data.staged_capsules.length > 0 && (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h3 className="text-zinc-200 text-sm font-medium mb-2">Staged on this market ({data.staged_capsules.length})</h3>
          <ul className="text-xs space-y-1">
            {data.staged_capsules.map((c) => (
              <li key={c.id} className="text-zinc-400">
                <span className="font-mono text-[10px]">{c.id.slice(0, 8)}</span>
                {" · "}<span className="text-zinc-300">{c.status}</span>
                {" · "}<span className="tabular-nums">${c.capital_allocated_usd.toFixed(2)}</span>
                {c.paper_agent_id != null && <span className="text-zinc-500"> · agent #{c.paper_agent_id}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Footer — latency + freshness */}
      <div className="mt-4 border-t border-zinc-800 pt-2 flex items-center justify-between text-[10px] text-zinc-500">
        <div>
          last fetch: <span className={sinceFetchMs > 4000 ? "text-accent-red" : sinceFetchMs > 2000 ? "text-accent-amber" : "text-accent-green"}>{sinceFetchMs}ms ago</span>
          {" · "}round-trip {lastFetchMs.toFixed(0)}ms
          {" · "}server {data.server_elapsed_ms}ms (book fetch {data.quote_fetch_ms}ms)
          {error && <span className="ml-2 text-accent-amber">· ⚠ {error.slice(0, 60)} (retrying)</span>}
        </div>
        <div>
          {paused ? <span className="text-accent-amber">⏸ paused</span> : <span className="text-accent-green">● polling 1Hz</span>}
        </div>
      </div>
    </section>
  );
}

function WindowProgress({ fractionElapsed, optimalLoSec, optimalHiSec, totalSec }: { fractionElapsed: number; optimalLoSec: number; optimalHiSec: number; totalSec: number }) {
  // Compute percentages for: window itself, optimal bet zone (2:00–3:00), elapsed marker
  const optimalStartPct = (optimalLoSec / totalSec) * 100;
  const optimalEndPct = (optimalHiSec / totalSec) * 100;
  const elapsedPct = fractionElapsed * 100;
  return (
    <div className="relative h-4 rounded bg-zinc-900 border border-zinc-800 overflow-hidden mt-2">
      {/* optimal bet window highlight */}
      <div
        className="absolute top-0 bottom-0 bg-accent-green/20 border-x border-accent-green/50"
        style={{ left: `${optimalStartPct}%`, width: `${optimalEndPct - optimalStartPct}%` }}
        title={`optimal bet window: ${formatMmSs(optimalLoSec)}–${formatMmSs(optimalHiSec)} after start`}
      />
      {/* elapsed marker — transitions smoothly between 100ms render ticks so
          the head appears to slide continuously */}
      <div className="absolute top-0 bottom-0 left-0 bg-accent-blue/30 transition-[width] duration-100 ease-linear" style={{ width: `${elapsedPct}%` }} />
      <div className="absolute top-0 bottom-0 w-0.5 bg-accent-blue transition-[left] duration-100 ease-linear" style={{ left: `${elapsedPct}%` }} />
    </div>
  );
}

function ChartToggleButton({ mode, active, onClick, label }: { mode: ChartMode; active: ChartMode; onClick: (m: ChartMode) => void; label: string }) {
  const isActive = mode === active;
  return (
    <button
      onClick={() => onClick(mode)}
      className={`px-2 py-1 rounded border text-[11px] ${isActive ? "border-accent-blue/60 bg-accent-blue/20 text-accent-blue" : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}
    >{label}</button>
  );
}

function AgentSetToggle({ mode, active, onClick, label }: { mode: "top" | "archetypes" | "all"; active: "top" | "archetypes" | "all"; onClick: (m: "top" | "archetypes" | "all") => void; label: string }) {
  const isActive = mode === active;
  return (
    <button
      onClick={() => onClick(mode)}
      className={`px-1.5 py-0.5 rounded border ${isActive ? "border-accent-green/60 bg-accent-green/15 text-accent-green" : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}
    >{label}</button>
  );
}

function SidePanel({ side, pct, label, depthUsd, bestAsk, lastChangedMs }: { side: "UP" | "DOWN"; pct: number | null; label: string; depthUsd: number; bestAsk: number | null; lastChangedMs: number }) {
  const accentClass = side === "UP" ? "text-accent-green" : "text-accent-red";
  const sinceChangedSec = Math.floor((Date.now() - lastChangedMs) / 1000);
  const recentlyChanged = sinceChangedSec < 2;
  return (
    <div className={`rounded border bg-zinc-900/40 p-3 text-center transition-colors duration-300 ${recentlyChanged ? "border-accent-blue/80 bg-accent-blue/5" : "border-zinc-800"}`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center justify-center gap-1.5">
        <span>{label}</span>
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent-green animate-pulse" title="polling 1Hz" />
      </div>
      <div className={`text-4xl font-semibold tabular-nums ${accentClass} mt-1 transition-transform ${recentlyChanged ? "scale-105" : ""}`}>
        {pct != null ? `${(pct * 100).toFixed(2)}%` : "—"}
      </div>
      <div className="text-[10px] text-zinc-500 mt-1">
        best ask {bestAsk != null ? `$${bestAsk.toFixed(3)}` : "—"} · depth ${depthUsd.toFixed(0)}
      </div>
      <div className="text-[10px] text-zinc-600 mt-1">
        last moved <span className="tabular-nums">{sinceChangedSec}s</span> ago
      </div>
    </div>
  );
}

function AgentRow({ agent, marketUp, conditionId, upTokenId, downTokenId, question }: {
  agent: Agent;
  marketUp: number | null;
  conditionId: string;
  upTokenId: string;
  downTokenId: string | null;
  question: string;
}) {
  const p = agent.prediction.upProb;
  const delta = p != null && marketUp != null ? (p - marketUp) * 100 : null;
  const side: "UP" | "DOWN" | null = p == null ? null : p >= 0.5 ? "UP" : "DOWN";
  const sideColor = side === "UP" ? "text-accent-green" : side === "DOWN" ? "text-accent-red" : "text-zinc-500";
  const confColor: Record<Confidence, string> = {
    high: "text-accent-green border-accent-green/40 bg-accent-green/10",
    medium: "text-accent-amber border-accent-amber/40 bg-accent-amber/10",
    low: "text-zinc-400 border-zinc-700 bg-zinc-800",
    none: "text-zinc-600 border-zinc-800 bg-zinc-900",
  };
  return (
    <details className="border border-zinc-800 rounded bg-zinc-900/40">
      <summary className="px-3 py-2 cursor-pointer flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-zinc-200 text-sm flex items-center gap-1.5">
            <span className="truncate">{agent.name}</span>
            {agent.is_elite && <span className="text-[10px] px-1 rounded bg-accent-amber/20 text-accent-amber border border-accent-amber/40">ELITE</span>}
            <span className={`text-[10px] tabular-nums ${agent.lifetime_pnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
              {agent.lifetime_pnl >= 0 ? "+" : ""}${agent.lifetime_pnl.toFixed(2)}
            </span>
          </div>
          <div className="text-[10px] text-zinc-500">{agent.strategy_kind} · {agent.strategy_nick}</div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <div className="text-right">
            <div className={`tabular-nums font-semibold ${sideColor}`}>
              {p != null ? `${side} ${(p * 100).toFixed(1)}%` : "—"}
            </div>
            {delta != null && (
              <div className="text-[10px] tabular-nums">
                vs market{" "}
                <span className={Math.abs(delta) < 5 ? "text-zinc-500" : delta > 0 ? "text-accent-green" : "text-accent-red"}>
                  {delta >= 0 ? "+" : ""}{delta.toFixed(1)}pp
                </span>
              </div>
            )}
          </div>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${confColor[agent.prediction.confidence]}`}>
            {agent.prediction.confidence}
          </span>
        </div>
      </summary>
      <div className="px-3 pb-3 pt-1 border-t border-zinc-800 space-y-2">
        <div className="text-[11px] text-zinc-400">{agent.prediction.rationale}</div>
        {agent.prediction.subs && agent.prediction.subs.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Sub-strategies</div>
            <div className="flex flex-wrap gap-1.5">
              {agent.prediction.subs.map((s, i) => {
                const subColor = s.upProb == null
                  ? "text-zinc-600 border-zinc-800"
                  : s.upProb >= 0.5 ? "text-accent-green border-accent-green/30" : "text-accent-red border-accent-red/30";
                return (
                  <span
                    key={i}
                    className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap font-mono ${subColor}`}
                    title={s.rationale}
                  >
                    {s.kind.replace("cb_", "cb·").replace("poly_", "poly·")} {s.upProb != null ? `→ UP ${(s.upProb * 100).toFixed(0)}%` : "—"}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {agent.capsule_id && (
          <div className="text-[10px] text-zinc-500">
            current capsule: <span className="font-mono">{agent.capsule_id.slice(0, 8)}</span>{" "}
            <span className="text-zinc-300">{agent.capsule_status}</span>{" "}
            <span className="tabular-nums">${(agent.capsule_capital ?? 0).toFixed(2)}</span>
          </div>
        )}
        <StagingForBinary
          agentId={agent.id}
          conditionId={conditionId}
          upTokenId={upTokenId}
          downTokenId={downTokenId}
          question={question}
          suggestedSide={side}
        />
      </div>
    </details>
  );
}

/** Stage a capsule against THIS binary. Looks up the most recent compatible
 *  opportunity event for the same conditionId so the existing stage-capsule
 *  API can fill in. Falls back to direct-create if none exists. */
function StagingForBinary({ agentId, conditionId, upTokenId, downTokenId, question, suggestedSide }: {
  agentId: number;
  conditionId: string;
  upTokenId: string;
  downTokenId: string | null;
  question: string;
  suggestedSide: "UP" | "DOWN" | null;
}) {
  const [oppId, setOppId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const requestedRef = useRef(false);
  useEffect(() => {
    if (requestedRef.current) return;
    requestedRef.current = true;
    (async () => {
      try {
        const r = await fetch(`/api/arena/binary-opportunity?conditionId=${encodeURIComponent(conditionId)}&suggestedSide=${suggestedSide ?? ""}&question=${encodeURIComponent(question)}&upTokenId=${encodeURIComponent(upTokenId)}${downTokenId ? `&downTokenId=${encodeURIComponent(downTokenId)}` : ""}`);
        const json = await r.json();
        if (json.ok && json.opportunity_id) setOppId(json.opportunity_id);
      } catch { /* swallow */ }
    })();
  }, [conditionId, suggestedSide, question, upTokenId, downTokenId]);

  if (oppId == null) {
    return <div className="text-[10px] text-zinc-600">{creating ? "preparing staging context…" : "waiting for opportunity context"}</div>;
  }
  return (
    <div>
      <div className="text-[10px] text-zinc-500 mb-1">
        Stage capsule against this binary (paused — operator flips paper/live separately)
      </div>
      <StageCapsuleForm
        agentId={agentId}
        opportunityId={oppId}
        defaultBetUsd={5}
        side={suggestedSide ?? undefined}
      />
      {status && <div className="text-[10px] text-zinc-500 mt-1">{status}</div>}
    </div>
  );
}

function formatMmSs(totalSec: number): string {
  const t = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Merge the server-side `market_up` history with the client-buffered
 *  `consensus_up` history. Server points carry only market_up; client points
 *  carry both market_up and consensus_up. The result is sorted by ts_ms with
 *  no duplicates (client points always win at the same timestamp). */
function mergeHistory(
  serverMarket: Array<{ ts_ms: number; market_up: number }>,
  clientHistory: HistoryPoint[],
): HistoryPoint[] {
  const byTs = new Map<number, HistoryPoint>();
  for (const s of serverMarket) {
    byTs.set(s.ts_ms, { ts_ms: s.ts_ms, market_up: s.market_up, consensus_up: null });
  }
  for (const c of clientHistory) {
    byTs.set(c.ts_ms, c);  // client wins on overlap (has consensus too)
  }
  return Array.from(byTs.values()).sort((a, b) => a.ts_ms - b.ts_ms);
}
