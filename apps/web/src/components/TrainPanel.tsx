"use client";

/**
 * Client-side training console used by /arena/agents/[id]/train.
 *
 * Renders:
 *   - Date-range presets (24h / 7d / 30d / 90d / custom)
 *   - Mode selector (backtest | sweep)
 *   - Run button with live spinner
 *   - Result panel (PnL + win rate + DD + equity sparkline)
 *   - History table of recent runs
 */
import { useCallback, useEffect, useMemo, useState } from "react";

type RunRow = {
  id: number;
  mode: string;
  from_iso: string;
  to_iso: string;
  status: string;
  pnl_usd: number | null;
  trades_count: number | null;
  wins_count: number | null;
  max_dd_pct: number | null;
  fitness: number | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
};

type BacktestSummary = {
  pnl_usd: number;
  pnl_pct: number;
  trades_count: number;
  wins_count: number;
  win_rate: number;
  max_dd_usd: number;
  max_dd_pct: number;
  fitness: number;
  starting_cash: number;
  ending_equity: number;
  ticks: number;
  signals_emitted: { entries: number; exits: number; holds: number };
  equity_curve: Array<{ ts: string; equity: number }>;
};

type SweepVariant = {
  param_key: string;
  param_from: number;
  param_to: number;
  summary: BacktestSummary;
};

type SweepResult = {
  per_pct: number;
  base: BacktestSummary;
  variants: SweepVariant[];
};

type ApiResponse =
  | { ok: true; mode: "backtest"; run_id: number; summary: BacktestSummary }
  | { ok: true; mode: "sweep"; run_id: number; result: SweepResult }
  | { ok: false; error: string };

type Mode = "backtest" | "sweep";
type Preset = "24h" | "7d" | "30d" | "90d" | "custom";

const PRESET_DAYS: Record<Preset, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, custom: 30 };

function nowIso(): string {
  return new Date().toISOString();
}
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function TrainPanel({ agentId, initialRuns }: { agentId: number; initialRuns: RunRow[] }) {
  const [mode, setMode] = useState<Mode>("backtest");
  const [preset, setPreset] = useState<Preset>("7d");
  const [from, setFrom] = useState<string>(daysAgoIso(7).slice(0, 16));
  const [to, setTo] = useState<string>(nowIso().slice(0, 16));
  const [perPct, setPerPct] = useState<number>(0.20);
  const [running, setRunning] = useState(false);
  const [tStartMs, setTStartMs] = useState<number>(0);
  const [, forceTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [runs, setRuns] = useState<RunRow[]>(initialRuns);

  // Re-render every 500ms while a backtest is running so the elapsed counter
  // updates live. Cheap — no network, no DB, just a state bump.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [running]);

  const onPresetClick = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") {
      setFrom(daysAgoIso(PRESET_DAYS[p]).slice(0, 16));
      setTo(nowIso().slice(0, 16));
    }
  };

  const run = useCallback(async () => {
    setRunning(true);
    setTStartMs(Date.now());
    setError(null);
    setResult(null);
    try {
      const fromIso = new Date(from).toISOString();
      const toIso = new Date(to).toISOString();
      const body: Record<string, unknown> = { mode, from: fromIso, to: toIso };
      if (mode === "sweep") body.perPct = perPct;
      const res = await fetch(`/api/arena/agents/${agentId}/train`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || (json as { ok: boolean }).ok === false) {
        const msg = (json as { error?: string })?.error ?? `HTTP ${res.status}`;
        setError(msg);
      } else {
        setResult(json);
        const refresh = await fetch(`/api/arena/agents/${agentId}/train`, { cache: "no-store" });
        const jr = (await refresh.json().catch(() => ({}))) as { ok: boolean; runs?: RunRow[] };
        if (jr.ok && jr.runs) setRuns(jr.runs);
      }
    } catch (err) {
      setError((err as Error).message ?? String(err));
    } finally {
      setRunning(false);
    }
  }, [agentId, mode, from, to, perPct]);

  return (
    <div className="space-y-4">
      {/* Mode + range + run */}
      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <span className="text-xs uppercase tracking-wide text-zinc-500">mode</span>
          <ModeToggle mode="backtest" active={mode} onClick={setMode} label="backtest" />
          <ModeToggle mode="sweep" active={mode} onClick={setMode} label="sweep (±20%)" />
          <span className="text-zinc-600">·</span>
          <span className="text-xs uppercase tracking-wide text-zinc-500">range</span>
          {(["24h", "7d", "30d", "90d", "custom"] as Preset[]).map((p) => (
            <PresetButton key={p} preset={p} active={preset} onClick={onPresetClick} />
          ))}
          {mode === "sweep" && (
            <>
              <span className="text-zinc-600">·</span>
              <label className="text-xs text-zinc-500">perturbation ±</label>
              <input
                type="number"
                min={0.05}
                max={0.50}
                step={0.05}
                value={perPct}
                onChange={(e) => setPerPct(Number(e.target.value))}
                className="w-16 px-1 py-0.5 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs tabular-nums"
              />
            </>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">from</label>
            <input
              type="datetime-local"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("custom");
              }}
              className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">to</label>
            <input
              type="datetime-local"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
              className="px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 text-xs"
            />
          </div>
          <button
            type="button"
            onClick={run}
            disabled={running}
            className="px-3 py-1.5 rounded bg-accent-blue/20 text-accent-blue border border-accent-blue/40 hover:bg-accent-blue/30 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
          >
            {running ? "running…" : `run ${mode}`}
          </button>
          {running && (() => {
            const elapsedMs = Date.now() - tStartMs;
            const elapsedSec = Math.floor(elapsedMs / 1000);
            const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
            const ss = String(elapsedSec % 60).padStart(2, "0");
            // ETA: with the pre-load fast-path, 14d backtests run in ~5-30s.
            // Use ~2s/day as a rough estimate, with a 5s minimum.
            const fromMs = new Date(from).getTime();
            const toMs = new Date(to).getTime();
            const windowDays = Math.max(0.5, (toMs - fromMs) / 86_400_000);
            const etaSec = Math.max(5, Math.round(windowDays * 2 * (mode === "sweep" ? 8 : 1)));
            const etaMm = String(Math.floor(etaSec / 60)).padStart(2, "0");
            const etaSs = String(etaSec % 60).padStart(2, "0");
            const pct = Math.min(99, Math.floor((elapsedSec / etaSec) * 100));
            return (
              <span className="text-[11px] text-zinc-400 inline-flex items-center gap-2">
                <span className="tabular-nums">
                  elapsed <span className="text-accent-blue">{mm}:{ss}</span> · est ~{etaMm}:{etaSs} ({windowDays.toFixed(0)}d × ~{Math.round(etaSec / windowDays)}s/d{mode === "sweep" ? " · 8 variants" : ""})
                </span>
                <span className="inline-block w-24 h-1.5 bg-zinc-800 rounded overflow-hidden">
                  <span
                    className="block h-full bg-accent-blue transition-[width] duration-300 ease-linear"
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </span>
            );
          })()}
        </div>
      </section>

      {/* Result */}
      {error && (
        <section className="rounded border border-accent-red/40 bg-accent-red/10 p-3 text-sm text-accent-red">
          run failed: {error}
        </section>
      )}
      {result && result.ok && result.mode === "backtest" && <BacktestResult summary={result.summary} runId={result.run_id} />}
      {result && result.ok && result.mode === "sweep" && <SweepResultView result={result.result} runId={result.run_id} />}

      {/* History */}
      <section>
        <h2 className="text-sm font-medium text-zinc-300 mb-2">recent training runs ({runs.length})</h2>
        {runs.length === 0 ? (
          <div className="text-xs text-zinc-500 italic">no runs yet — kick one off above.</div>
        ) : (
          <div className="overflow-x-auto rounded border border-zinc-800">
            <table className="w-full text-xs">
              <thead className="bg-zinc-900/60 text-zinc-500">
                <tr>
                  <th className="text-left px-2 py-1.5">id</th>
                  <th className="text-left px-2 py-1.5">mode</th>
                  <th className="text-left px-2 py-1.5">range</th>
                  <th className="text-right px-2 py-1.5">PnL</th>
                  <th className="text-right px-2 py-1.5">trades</th>
                  <th className="text-right px-2 py-1.5">win%</th>
                  <th className="text-right px-2 py-1.5">max DD</th>
                  <th className="text-right px-2 py-1.5">fitness</th>
                  <th className="text-left px-2 py-1.5">status</th>
                  <th className="text-left px-2 py-1.5">when</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-900/40">
                    <td className="px-2 py-1.5 tabular-nums text-zinc-500">#{r.id}</td>
                    <td className="px-2 py-1.5">{r.mode}</td>
                    <td className="px-2 py-1.5 text-zinc-400 tabular-nums">
                      {prettyRange(r.from_iso, r.to_iso)}
                    </td>
                    <td
                      className={
                        "px-2 py-1.5 text-right tabular-nums " +
                        ((r.pnl_usd ?? 0) >= 0 ? "text-accent-green" : "text-accent-red")
                      }
                    >
                      {r.pnl_usd != null ? `${(r.pnl_usd >= 0 ? "+$" : "−$") + Math.abs(r.pnl_usd).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{r.trades_count ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                      {r.trades_count && r.wins_count != null
                        ? `${((r.wins_count / r.trades_count) * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                      {r.max_dd_pct != null ? `${(r.max_dd_pct * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                      {r.fitness != null ? r.fitness.toFixed(3) : "—"}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={
                          "px-1.5 py-0.5 rounded text-[10px] " +
                          (r.status === "done"
                            ? "bg-accent-green/15 text-accent-green border border-accent-green/40"
                            : r.status === "failed"
                            ? "bg-accent-red/15 text-accent-red border border-accent-red/40"
                            : "bg-accent-amber/15 text-accent-amber border border-accent-amber/40")
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-zinc-500 tabular-nums">{prettyAgo(r.started_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ModeToggle({ mode, active, onClick, label }: { mode: Mode; active: Mode; onClick: (m: Mode) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onClick(mode)}
      className={
        "px-2 py-0.5 rounded text-xs " +
        (mode === active
          ? "bg-accent-blue/20 text-accent-blue border border-accent-blue/40"
          : "bg-zinc-900 text-zinc-400 border border-zinc-700 hover:bg-zinc-800")
      }
    >
      {label}
    </button>
  );
}

function PresetButton({ preset, active, onClick }: { preset: Preset; active: Preset; onClick: (p: Preset) => void }) {
  return (
    <button
      type="button"
      onClick={() => onClick(preset)}
      className={
        "px-2 py-0.5 rounded text-xs " +
        (preset === active
          ? "bg-zinc-700 text-zinc-200 border border-zinc-600"
          : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300")
      }
    >
      {preset}
    </button>
  );
}

function BacktestResult({ summary, runId }: { summary: BacktestSummary; runId: number }) {
  return (
    <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-sm font-medium text-zinc-200">backtest result <span className="text-zinc-500">#{runId}</span></h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Stat
          label="PnL"
          value={`${summary.pnl_usd >= 0 ? "+$" : "−$"}${Math.abs(summary.pnl_usd).toFixed(2)}`}
          sub={`${(summary.pnl_pct * 100).toFixed(2)}%`}
          accent={summary.pnl_usd >= 0 ? "green" : "red"}
        />
        <Stat label="trades" value={String(summary.trades_count)} sub={`${summary.signals_emitted.entries} entries · ${summary.signals_emitted.exits} exits`} />
        <Stat label="win rate" value={`${(summary.win_rate * 100).toFixed(0)}%`} sub={`${summary.wins_count} / ${summary.trades_count}`} />
        <Stat label="max DD" value={`${(summary.max_dd_pct * 100).toFixed(1)}%`} sub={`$${summary.max_dd_usd.toFixed(2)}`} />
        <Stat label="fitness" value={summary.fitness.toFixed(3)} sub="pnl% − 2·DD%" />
      </div>
      {summary.equity_curve.length > 1 && <EquitySparkline points={summary.equity_curve} starting={summary.starting_cash} />}
    </section>
  );
}

function SweepResultView({ result, runId }: { result: SweepResult; runId: number }) {
  const winners = result.variants.slice(0, 8);
  return (
    <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-sm font-medium text-zinc-200">sweep result <span className="text-zinc-500">#{runId}</span></h2>
        <span className="text-[11px] text-zinc-500">
          ±{(result.per_pct * 100).toFixed(0)}% on each numeric param · {result.variants.length} variants tested
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label="base PnL" value={`${result.base.pnl_usd >= 0 ? "+$" : "−$"}${Math.abs(result.base.pnl_usd).toFixed(2)}`} accent={result.base.pnl_usd >= 0 ? "green" : "red"} />
        <Stat label="best variant" value={winners[0] ? `${winners[0].summary.pnl_usd >= 0 ? "+$" : "−$"}${Math.abs(winners[0].summary.pnl_usd).toFixed(2)}` : "—"} sub={winners[0] ? `${winners[0].param_key}=${winners[0].param_to.toFixed(4)}` : ""} accent={winners[0] && winners[0].summary.pnl_usd >= 0 ? "green" : undefined} />
        <Stat label="improvement" value={winners[0] ? `${((winners[0].summary.pnl_usd - result.base.pnl_usd) / Math.abs(result.base.pnl_usd || 1) * 100).toFixed(0)}%` : "—"} />
        <Stat label="variants tested" value={String(result.variants.length)} />
      </div>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full text-xs">
          <thead className="bg-zinc-900/60 text-zinc-500">
            <tr>
              <th className="text-left px-2 py-1.5">rank</th>
              <th className="text-left px-2 py-1.5">param</th>
              <th className="text-right px-2 py-1.5">from</th>
              <th className="text-right px-2 py-1.5">to</th>
              <th className="text-right px-2 py-1.5">PnL</th>
              <th className="text-right px-2 py-1.5">trades</th>
              <th className="text-right px-2 py-1.5">win%</th>
              <th className="text-right px-2 py-1.5">fitness</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {winners.map((v, i) => (
              <tr key={`${v.param_key}-${v.param_to}-${i}`}>
                <td className="px-2 py-1.5 tabular-nums text-zinc-500">#{i + 1}</td>
                <td className="px-2 py-1.5 text-zinc-300">{v.param_key}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">{v.param_from.toFixed(4)}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-200">{v.param_to.toFixed(4)}</td>
                <td className={"px-2 py-1.5 text-right tabular-nums " + (v.summary.pnl_usd >= 0 ? "text-accent-green" : "text-accent-red")}>
                  {(v.summary.pnl_usd >= 0 ? "+$" : "−$") + Math.abs(v.summary.pnl_usd).toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{v.summary.trades_count}</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{(v.summary.win_rate * 100).toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{v.summary.fitness.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-zinc-500">
        applying a variant to the live agent is not yet wired — for now, note the winning params and pass them to a CLI seed script. UI "apply" comes in Phase 1.5.
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "green" | "red";
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={
          "text-base tabular-nums " +
          (accent === "green" ? "text-accent-green" : accent === "red" ? "text-accent-red" : "text-zinc-200")
        }
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function EquitySparkline({ points, starting }: { points: Array<{ ts: string; equity: number }>; starting: number }) {
  const width = 600;
  const height = 80;
  const padding = 4;
  const equities = points.map((p) => p.equity);
  const min = Math.min(starting, ...equities);
  const max = Math.max(starting, ...equities);
  const range = Math.max(1, max - min);
  const xs = points.length > 1 ? width - padding * 2 : 0;
  const path = points
    .map((p, i) => {
      const x = padding + (xs * i) / Math.max(1, points.length - 1);
      const y = padding + (height - padding * 2) * (1 - (p.equity - min) / range);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const startY = padding + (height - padding * 2) * (1 - (starting - min) / range);
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950/40 p-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-20">
        <line x1={padding} x2={width - padding} y1={startY} y2={startY} stroke="#52525b" strokeDasharray="2 2" strokeWidth={1} />
        <path d={path} fill="none" stroke="rgb(59 130 246)" strokeWidth={1.5} />
      </svg>
      <div className="text-[10px] text-zinc-500 mt-1 flex justify-between">
        <span>start ${starting.toFixed(0)}</span>
        <span>{points.length} samples</span>
        <span>end ${points[points.length - 1].equity.toFixed(0)}</span>
      </div>
    </div>
  );
}

function prettyRange(fromIso: string, toIso: string): string {
  const f = fromIso.slice(0, 16).replace("T", " ");
  const t = toIso.slice(0, 16).replace("T", " ");
  const days = (Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000;
  return `${f} → ${t} (${days.toFixed(0)}d)`;
}

function prettyAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
