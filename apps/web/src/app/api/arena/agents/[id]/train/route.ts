/**
 * POST /api/arena/agents/[id]/train
 *
 * Kick off a synchronous training run on a single agent. Three modes:
 *   - "backtest": deterministic replay over [from, to], returns PnL summary.
 *   - "sweep":    runs the base genome + N variants (each numeric param ±perPct),
 *                 returns ranked results.
 *   - "forward":  NOT YET IMPLEMENTED — returns 501. Phase 1.5.
 *
 * Result is persisted to training_runs in all cases. The full summary is
 * returned in-response so the operator sees results immediately.
 *
 * GET /api/arena/agents/[id]/train returns the last 20 training_runs for
 * this agent so the page can render history without a second endpoint.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  insertTrainingRun,
  listTrainingRunsForAgent,
  simulateAgentReplay,
  sweepAgentVariants,
} from "@/lib/arena/training";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteCtx): Promise<NextResponse> {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid agent id" }, { status: 400 });
  }
  const runs = listTrainingRunsForAgent(agentId, 20);
  return NextResponse.json({ ok: true, agent_id: agentId, runs });
}

export async function POST(req: NextRequest, { params }: RouteCtx): Promise<NextResponse> {
  const { id } = await params;
  const agentId = Number(id);
  if (!Number.isFinite(agentId) || agentId <= 0) {
    return NextResponse.json({ ok: false, error: "invalid agent id" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    mode?: "backtest" | "sweep" | "forward";
    from?: string;          // ISO
    to?: string;            // ISO
    tickIntervalMin?: number;
    startingCash?: number;
    perPct?: number;        // sweep only — defaults to 0.20
  };
  const mode = body.mode ?? "backtest";
  if (mode !== "backtest" && mode !== "sweep" && mode !== "forward") {
    return NextResponse.json({ ok: false, error: `unknown mode=${mode}` }, { status: 400 });
  }
  if (mode === "forward") {
    return NextResponse.json({ ok: false, error: "forward mode not yet implemented (Phase 1.5)" }, { status: 501 });
  }
  const to = body.to ?? new Date().toISOString();
  const from = body.from ?? new Date(Date.now() - 30 * 86_400_000).toISOString();
  const tickIntervalMin = body.tickIntervalMin ?? 5;

  // Validate the date range — bounded to a reasonable size so we don't
  // accidentally spin for hours.
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return NextResponse.json({ ok: false, error: "from/to must be ISO timestamps" }, { status: 400 });
  }
  if (toMs <= fromMs) {
    return NextResponse.json({ ok: false, error: "to must be > from" }, { status: 400 });
  }
  const windowDays = (toMs - fromMs) / 86_400_000;
  if (windowDays > 730) {
    return NextResponse.json({
      ok: false,
      error: `window too large (${windowDays.toFixed(0)} days). Max 730 days per run; loop multiple runs for longer ranges.`,
    }, { status: 400 });
  }

  const startedAt = new Date().toISOString();
  try {
    if (mode === "backtest") {
      const summary = simulateAgentReplay({
        agentId,
        fromIso: from,
        toIso: to,
        tickIntervalMin,
        startingCash: body.startingCash,
        equityCurveStride: Math.max(1, Math.floor(((toMs - fromMs) / (tickIntervalMin * 60_000)) / 60)), // ~60 points
      });
      const runId = insertTrainingRun({
        agent_id: agentId,
        mode: "backtest",
        from_iso: from,
        to_iso: to,
        status: "done",
        pnl_usd: summary.pnl_usd,
        trades_count: summary.trades_count,
        wins_count: summary.wins_count,
        max_dd_pct: summary.max_dd_pct,
        fitness: summary.fitness,
        summary_json: JSON.stringify(summary),
        ended_at: new Date().toISOString(),
      });
      return NextResponse.json({
        ok: true,
        mode: "backtest",
        agent_id: agentId,
        run_id: runId,
        started_at: startedAt,
        summary,
      });
    }
    // sweep
    const perPct = body.perPct ?? 0.20;
    const result = sweepAgentVariants({
      agentId,
      fromIso: from,
      toIso: to,
      tickIntervalMin,
      startingCash: body.startingCash,
      perPct,
      equityCurveStride: 9999, // sweep doesn't need equity curves
    });
    // Persist a single training_runs row summarizing the sweep. The full
    // ranked variants list lives in summary_json so callers can drill in.
    const best = result.variants[0]?.summary ?? result.base;
    const runId = insertTrainingRun({
      agent_id: agentId,
      mode: "sweep",
      from_iso: from,
      to_iso: to,
      status: "done",
      pnl_usd: best.pnl_usd,
      trades_count: best.trades_count,
      wins_count: best.wins_count,
      max_dd_pct: best.max_dd_pct,
      fitness: best.fitness,
      summary_json: JSON.stringify({
        per_pct: perPct,
        base: { ...result.base, equity_curve: undefined },  // strip curves to keep row small
        variants: result.variants.map((v) => ({
          ...v,
          summary: { ...v.summary, equity_curve: undefined },
        })),
      }),
      ended_at: new Date().toISOString(),
    });
    return NextResponse.json({
      ok: true,
      mode: "sweep",
      agent_id: agentId,
      run_id: runId,
      started_at: startedAt,
      result: {
        per_pct: perPct,
        base: result.base,
        variants: result.variants,
      },
    });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    insertTrainingRun({
      agent_id: agentId,
      mode,
      from_iso: from,
      to_iso: to,
      status: "failed",
      error: msg,
      ended_at: new Date().toISOString(),
    });
    return NextResponse.json({ ok: false, error: msg, mode, agent_id: agentId }, { status: 500 });
  }
}
