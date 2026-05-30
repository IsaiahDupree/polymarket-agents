"use client";

/**
 * BinaryChart — toggleable SVG line chart embedded in LiveBinaryPanel.
 *
 * Three modes:
 *   - "market"     MARKET implied UP% over time (Polymarket-style chart)
 *   - "btc"        Asset spot price over the window, with a horizontal
 *                  reference line at the start-of-window price (the literal
 *                  "target to beat" — binary resolves UP if final ≥ ref)
 *   - "consensus"  Aggregate AGENT UP% vs MARKET UP%, both lines overlaid
 *
 * Pure presentational — caller supplies the data, this just draws.
 */
import { useMemo } from "react";

export type SeriesPoint = { ts_ms: number; price: number };
export type HistoryPoint = { ts_ms: number; market_up: number | null; consensus_up: number | null };

export type ChartMode = "market" | "btc" | "consensus";

export type BinaryChartProps = {
  mode: ChartMode;
  startMs: number;
  expiryMs: number;
  btcSeries: SeriesPoint[];
  referencePrice: number | null;
  history: HistoryPoint[];
  marketUpNow: number | null;
  consensusUpNow: number | null;
  productId: string | null;
  width?: number;
  height?: number;
};

const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;

export function BinaryChart({
  mode,
  startMs,
  expiryMs,
  btcSeries,
  referencePrice,
  history,
  marketUpNow,
  consensusUpNow,
  productId,
  width = 600,
  height = 180,
}: BinaryChartProps) {
  const plotW = width - PAD_L - PAD_R;
  const plotH = height - PAD_T - PAD_B;

  const xFor = (t: number): number =>
    PAD_L + ((Math.max(startMs, Math.min(expiryMs, t)) - startMs) / Math.max(1, expiryMs - startMs)) * plotW;

  // Mode-specific data + Y scale
  const view = useMemo(() => {
    if (mode === "btc") {
      const points = btcSeries.filter((p) => p.ts_ms >= startMs - 30_000 && p.ts_ms <= expiryMs + 30_000);
      if (points.length === 0 && referencePrice == null) return null;
      const prices = points.map((p) => p.price);
      if (referencePrice != null) prices.push(referencePrice);
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const pad = Math.max((max - min) * 0.1, max * 0.0005);
      const yMin = min - pad;
      const yMax = max + pad;
      return {
        type: "single" as const,
        points: points.map((p) => ({ ts_ms: p.ts_ms, y: p.price })),
        yMin, yMax,
        strokeColor: "#46d39a",
        refLine: referencePrice,
        yFmt: (v: number) => `$${v >= 1000 ? v.toFixed(0) : v.toFixed(3)}`,
        label: productId ?? "asset",
      };
    }
    if (mode === "market") {
      // 0–100% Y axis; use full history (server pre-population + client buffer).
      // Filtered to a wider lead-in (-10min) so the line shows context before
      // the binary's natural window start, matching Polymarket's chart.
      const pts = history
        .filter((h) => h.market_up != null && h.ts_ms >= startMs - 10 * 60_000 && h.ts_ms <= expiryMs + 30_000)
        .map((h) => ({ ts_ms: h.ts_ms, y: (h.market_up as number) * 100 }));
      return {
        type: "single" as const,
        points: pts,
        yMin: 0, yMax: 100,
        strokeColor: "#5b9eff",
        refLine: 50,
        yFmt: (v: number) => `${v.toFixed(0)}%`,
        label: "MARKET UP%",
      };
    }
    // consensus: two overlaid lines (market + consensus). Both series
    // independently filtered so a sparse consensus doesn't truncate the
    // market line.
    const marketPts = history
      .filter((h) => h.market_up != null && h.ts_ms >= startMs - 10 * 60_000 && h.ts_ms <= expiryMs + 30_000)
      .map((h) => ({ ts_ms: h.ts_ms, y: (h.market_up as number) * 100 }));
    const consensusPts = history
      .filter((h) => h.consensus_up != null && h.ts_ms >= startMs - 10 * 60_000 && h.ts_ms <= expiryMs + 30_000)
      .map((h) => ({ ts_ms: h.ts_ms, y: (h.consensus_up as number) * 100 }));
    return {
      type: "dual" as const,
      seriesA: { points: marketPts, color: "#5b9eff", label: "MARKET" },
      seriesB: { points: consensusPts, color: "#46d39a", label: "AGENT CONSENSUS" },
      consensusPointCount: consensusPts.length,
      yMin: 0, yMax: 100,
      refLine: 50,
      yFmt: (v: number) => `${v.toFixed(0)}%`,
    };
  }, [mode, btcSeries, history, startMs, expiryMs, referencePrice, productId]);

  if (!view) {
    return (
      <div className="text-[11px] text-zinc-500 italic px-2 py-6 text-center">
        {mode === "btc"
          ? "No BTC candles or ticks yet for this window. Run worker:snapshot (1-min Coinbase candles) or worker:realtime."
          : mode === "consensus"
            ? "Building consensus history — needs a few poll ticks with non-null agent predictions."
            : "Building MARKET history — server-side market_snapshots cover this window in the next poll."}
      </div>
    );
  }

  const yFor = (v: number): number => PAD_T + plotH - ((v - view.yMin) / Math.max(1e-9, view.yMax - view.yMin)) * plotH;
  const refY = view.refLine != null ? yFor(view.refLine) : null;

  // Time grid: 5 vertical ticks across the window
  const totalSec = (expiryMs - startMs) / 1000;
  const tickStepMs = (expiryMs - startMs) / 4;
  const xTicks = Array.from({ length: 5 }, (_, i) => startMs + i * tickStepMs);

  const pathFor = (pts: Array<{ ts_ms: number; y: number }>): string => {
    if (pts.length === 0) return "";
    return pts.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.ts_ms).toFixed(1)},${yFor(p.y).toFixed(1)}`).join(" ");
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none">
      {/* Background grid */}
      <rect x={PAD_L} y={PAD_T} width={plotW} height={plotH} fill="#0c0c0e" stroke="#1f1f23" />
      {/* Y axis ticks (3) */}
      {[0, 0.5, 1].map((f) => {
        const y = PAD_T + plotH * (1 - f);
        const v = view.yMin + f * (view.yMax - view.yMin);
        return (
          <g key={f}>
            <line x1={PAD_L} y1={y} x2={PAD_L + plotW} y2={y} stroke="#1f1f23" strokeDasharray="2 4" />
            <text x={PAD_L - 4} y={y + 3} fontSize="9" textAnchor="end" fill="#6b6b73" fontFamily="ui-monospace">{view.yFmt(v)}</text>
          </g>
        );
      })}
      {/* X axis labels */}
      {xTicks.map((t, i) => (
        <text key={i} x={xFor(t)} y={height - 6} fontSize="9" textAnchor="middle" fill="#6b6b73" fontFamily="ui-monospace">
          {new Date(t).toISOString().slice(11, 16)}
        </text>
      ))}
      {/* Reference line ("target to beat") — drawn brighter for BTC mode
          since it's the literal threshold the binary settles against; a soft
          glow halo makes it visible on the dark background. */}
      {refY != null && (
        <g>
          {mode === "btc" && (
            <line x1={PAD_L} y1={refY} x2={PAD_L + plotW} y2={refY}
                  stroke="#ffea7e" strokeWidth={4} opacity={0.18} />
          )}
          <line x1={PAD_L} y1={refY} x2={PAD_L + plotW} y2={refY}
                stroke={mode === "btc" ? "#ffea7e" : "#ff6e6e"}
                strokeDasharray={mode === "btc" ? "5 3" : "3 3"}
                strokeWidth={mode === "btc" ? 1.8 : 1} />
          <rect x={PAD_L + 2} y={refY - 11} width={mode === "btc" ? 116 : 30} height="14"
                fill={mode === "btc" ? "#1a1a05" : "#1a0606"}
                stroke={mode === "btc" ? "#ffea7e" : "#ff6e6e"} strokeWidth={0.5} />
          <text x={PAD_L + 6} y={refY - 1} fontSize="10" textAnchor="start"
                fill={mode === "btc" ? "#ffea7e" : "#ff6e6e"} fontFamily="ui-monospace" fontWeight="bold">
            {mode === "btc" ? `▶ target: ${view.yFmt(view.refLine!)}` : "50%"}
          </text>
        </g>
      )}
      {/* Lines */}
      {view.type === "single" ? (
        <g>
          {/* Soft glow halo behind the main line for the Polymarket-style look */}
          <path d={pathFor(view.points)} stroke={view.strokeColor} strokeWidth={6} fill="none" opacity={0.15} />
          <path d={pathFor(view.points)} stroke={view.strokeColor} strokeWidth={2} fill="none" />
          {/* Last-point glowing dot */}
          {view.points.length > 0 && (() => {
            const last = view.points[view.points.length - 1];
            const cx = xFor(last.ts_ms);
            const cy = yFor(last.y);
            return (
              <g>
                <circle cx={cx} cy={cy} r={8} fill={view.strokeColor} opacity={0.25} />
                <circle cx={cx} cy={cy} r={4} fill={view.strokeColor} />
                <circle cx={cx} cy={cy} r={2} fill="#fff" />
              </g>
            );
          })()}
        </g>
      ) : (
        <g>
          <path d={pathFor(view.seriesA.points)} stroke={view.seriesA.color} strokeWidth={4} fill="none" opacity={0.15} />
          <path d={pathFor(view.seriesA.points)} stroke={view.seriesA.color} strokeWidth={1.8} fill="none" />
          <path d={pathFor(view.seriesB.points)} stroke={view.seriesB.color} strokeWidth={4} fill="none" opacity={0.15} />
          <path d={pathFor(view.seriesB.points)} stroke={view.seriesB.color} strokeWidth={1.8} fill="none" strokeDasharray={view.seriesB.points.length < 5 ? "4 3" : undefined} />
          {/* Consensus point markers (dots) so a sparse line is still visible */}
          {view.seriesB.points.map((p, i) => (
            <circle key={i} cx={xFor(p.ts_ms)} cy={yFor(p.y)} r={2.5} fill={view.seriesB.color} />
          ))}
          {/* "Consensus points: N" badge when sparse */}
          {view.consensusPointCount < 5 && (
            <text x={PAD_L + plotW - 4} y={PAD_T + plotH - 8} fontSize="9" textAnchor="end" fill="#46d39a" fontFamily="ui-monospace">
              {view.consensusPointCount} consensus points · sparse
            </text>
          )}
        </g>
      )}
      {/* "Now" vertical marker */}
      <NowMarker startMs={startMs} expiryMs={expiryMs} xFor={xFor} plotTop={PAD_T} plotBottom={PAD_T + plotH} />
      {/* Legend for dual mode */}
      {view.type === "dual" && (
        <g transform={`translate(${PAD_L + 4}, ${PAD_T + 4})`}>
          <rect width="135" height="20" fill="#0c0c0e" stroke="#1f1f23" />
          <circle cx="6" cy="6" r="2" fill={view.seriesA.color} />
          <text x="12" y="9" fontSize="9" fill="#cccccc" fontFamily="ui-monospace">{view.seriesA.label}</text>
          <circle cx="70" cy="6" r="2" fill={view.seriesB.color} />
          <text x="76" y="9" fontSize="9" fill="#cccccc" fontFamily="ui-monospace">{view.seriesB.label}</text>
        </g>
      )}
      {/* Current price highlight for BTC mode — glowing dot + horizontal price
          line + bright pill showing the latest spot, matching the MARKET dot
          treatment. Uses the last point of the BTC series (most recent tick). */}
      {mode === "btc" && view.type === "single" && view.points.length > 0 && (() => {
        const last = view.points[view.points.length - 1];
        const cx = xFor(last.ts_ms);
        const cy = yFor(last.y);
        const priceLabel = view.yFmt(last.y);
        return (
          <g>
            {/* Horizontal dashed price line across the plot */}
            <line x1={PAD_L} y1={cy} x2={PAD_L + plotW} y2={cy} stroke={view.strokeColor} strokeDasharray="2 3" strokeWidth={0.8} opacity={0.5} />
            {/* Glowing dot */}
            <circle cx={cx} cy={cy} r={9} fill={view.strokeColor} opacity={0.25} />
            <circle cx={cx} cy={cy} r={5} fill={view.strokeColor} />
            <circle cx={cx} cy={cy} r={2.5} fill="#fff" />
            {/* Bright pill showing the current price */}
            <rect x={PAD_L + plotW - 76} y={cy - 9} width="74" height="18" fill="#0c1a0c" stroke={view.strokeColor} strokeWidth={1} />
            <text x={PAD_L + plotW - 39} y={cy + 4} fontSize="11" textAnchor="middle" fill={view.strokeColor} fontFamily="ui-monospace" fontWeight="bold">
              ● {priceLabel}
            </text>
          </g>
        );
      })()}
      {/* Current value pill (rightmost) */}
      {mode === "market" && marketUpNow != null && (
        <g>
          <line x1={PAD_L + plotW - 1} y1={yFor(marketUpNow * 100)} x2={PAD_L + plotW + 2} y2={yFor(marketUpNow * 100)} stroke="#5b9eff" strokeWidth={2} />
          <rect x={PAD_L + plotW - 32} y={yFor(marketUpNow * 100) - 8} width="30" height="14" fill="#5b9eff" />
          <text x={PAD_L + plotW - 17} y={yFor(marketUpNow * 100) + 3} fontSize="10" textAnchor="middle" fill="#000" fontFamily="ui-monospace" fontWeight="bold">{(marketUpNow * 100).toFixed(0)}%</text>
        </g>
      )}
      {mode === "consensus" && consensusUpNow != null && (
        <g>
          <rect x={PAD_L + plotW - 36} y={yFor(consensusUpNow * 100) - 8} width="34" height="14" fill="#46d39a" />
          <text x={PAD_L + plotW - 19} y={yFor(consensusUpNow * 100) + 3} fontSize="10" textAnchor="middle" fill="#000" fontFamily="ui-monospace" fontWeight="bold">{(consensusUpNow * 100).toFixed(0)}%</text>
        </g>
      )}
    </svg>
  );
}

/** Vertical "now" marker — re-evaluates on each render via the parent's
 *  100ms ticker so it slides smoothly across the chart. */
function NowMarker({ startMs, expiryMs, xFor, plotTop, plotBottom }: { startMs: number; expiryMs: number; xFor: (t: number) => number; plotTop: number; plotBottom: number }) {
  const now = Date.now();
  if (now < startMs || now > expiryMs) return null;
  const x = xFor(now);
  return (
    <g>
      <line x1={x} y1={plotTop} x2={x} y2={plotBottom} stroke="#ffd56e" strokeWidth={1} strokeDasharray="2 2" />
    </g>
  );
}
