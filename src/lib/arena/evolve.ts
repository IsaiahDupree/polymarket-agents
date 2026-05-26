/**
 * Generation evolution as an importable function so both `scripts/arena-evolve.ts`
 * (manual CLI) and `scripts/arena-tick.ts` (auto-trigger when tick threshold
 * crossed) call the same code path.
 *
 * Seals the current open generation, ranks alive agents, retires bottom
 * SURVIVAL_PCT + retires survivors (their lineage continues via carryover
 * rows in the next generation), starts the next generation, breeds one
 * mutated child per survivor + one carryover row per survivor, then evaluates
 * championship eligibility.
 */
import { db } from "@/lib/db/client";
import { insertEvolutionEvent } from "@/lib/db/queries";
import { partitionSurvivors, rankAgents } from "./score";
import { buildLiveTickContext } from "./context";
import {
  getCurrentGeneration, getPaperAgent, insertPaperAgent, insertPaperTrade,
  listAliveAgentsForGen, listGenerations, persistAgentTick, recordChampionship,
  retireAgent, sealGeneration, setGenerationAgentCount, startGeneration, toLiveAgent,
} from "./db";
import { genomeNickname, parseGenome, type Genome } from "./genome";
import { mutate, mutateLlm, mutateProgrammatic } from "./mutate";
import { computeReplayFitness } from "./replay-fitness";
import { aggressivePresets } from "./seed-presets";
import { applySignal, markToMarket } from "./sim";
import type { LiveAgent, PaperAgentRow, TickContext } from "./types";

/**
 * Force-close any open positions on `row` at current snapshot prices, then
 * persist. Realizes PnL into the agent so its final fitness reflects the
 * positions it actually held at seal time, rather than leaving them orphaned
 * on a retired row.
 *
 * Positions whose market is missing from the snapshot context are left open
 * (we can't price them) — `applySignal` returns `{}` in that case.
 *
 * Returns the number of positions that were realized (for logging).
 */
function realizeOpenPositions(row: PaperAgentRow, ctx: TickContext, generation: number): { closed: number; realized_usd: number } {
  const positionsJson = row.position_basket_json;
  if (!positionsJson || positionsJson === "[]") return { closed: 0, realized_usd: 0 };
  const agent: LiveAgent = toLiveAgent(row);
  if (agent.positions.length === 0) return { closed: 0, realized_usd: 0 };
  let closed = 0;
  let realized = 0;
  // Snapshot the list of market_ids first — applySignal mutates agent.positions.
  const marketIds = agent.positions.map((p) => p.market_id);
  for (const mid of marketIds) {
    if (!ctx.snapshots.has(mid)) continue;
    const res = applySignal(agent, { kind: "exit", venue: agent.positions.find((p) => p.market_id === mid)!.venue, market_id: mid, rationale: "force-close on retire" }, ctx, generation);
    if (res.trade) {
      insertPaperTrade(res.trade);
      closed += 1;
      realized += res.trade.realized_pnl_usd ?? 0;
    }
  }
  markToMarket(agent, ctx);
  persistAgentTick(agent);
  return { closed, realized_usd: realized };
}

/**
 * Reject any child genome that doesn't fire at least once when replayed
 * against the historical candle window. Up to `maxAttempts` mutation retries
 * before falling back to a permissive random genome of the same kind.
 * Read-only — runs entirely in memory, never touches paper_trades.
 *
 * This is the cold-start cure: without it, populations can freeze when every
 * agent has thresholds too strict to fire, leaving evolution no fitness signal.
 */
async function genFiringChild(
  produce: () => Promise<Genome> | Genome,
  _fallbackKind: Genome["kind"],
  opts: { polyConditionIdPool?: string[]; maxAttempts?: number } = {},
): Promise<{ genome: Genome; attempts: number; trades: number }> {
  const maxAttempts = opts.maxAttempts ?? 6;
  let lastAttempt: Genome | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    const g = await produce();
    lastAttempt = g;
    try {
      const r = computeReplayFitness(g, { tickIntervalMin: 5 });
      if (r.trades_count >= 1) return { genome: g, attempts: i + 1, trades: r.trades_count };
    } catch {
      // Replay can fail when historical data is too thin for the strategy
      // (e.g. poly_fade_spike with 45h lookback against 4h snapshot history).
      // Treat as "didn't fire" and retry.
    }
  }
  // All attempts exhausted. Accept the last mutation rather than a permissive
  // random genome — poly_fade_spike / poly_breakout / cross_venue_arb can't be
  // replay-validated until we have multi-day snapshot history, so the gate
  // would otherwise destroy the evolutionary signal for those strategies.
  // Live ticks will sort firing from non-firing on the next sealed gen.
  return { genome: lastAttempt!, attempts: maxAttempts, trades: 0 };
}

export type EvolveResult = {
  sealed_gen: number;
  next_gen: number;
  n_survivors: number;
  n_culled: number;
  n_children: number;
  top_paper_agent_id: number | null;
  top_score: number | null;
  championship_recorded: boolean;
} | { skipped: "no_open_generation" } | { skipped: "no_alive_agents"; sealed_gen: number };

export async function runEvolveOnce(opts: { survivalPct?: number; championshipGens?: number } = {}): Promise<EvolveResult> {
  const survivalPct = opts.survivalPct ?? Number(process.env.ARENA_SURVIVAL_PCT ?? "0.5");
  const championshipGens = opts.championshipGens ?? Number(process.env.ARENA_CHAMPION_GENS ?? "3");

  const gen = getCurrentGeneration();
  if (!gen) return { skipped: "no_open_generation" };

  const aliveRows = listAliveAgentsForGen(gen.gen_number);
  const ranked = rankAgents(aliveRows);
  if (ranked.length === 0) {
    sealGeneration(gen.id, { n_alive: 0, top_agent_id: null, top_score: null, n_promoted_children: 0 });
    return { skipped: "no_alive_agents", sealed_gen: gen.gen_number };
  }

  // Force zero-activity agents into the cull bucket regardless of where they
  // rank. A lineage that never acted produces no fitness signal and just
  // dilutes the gene pool with cautious genomes that never trade. See PRD
  // `arena-agent-decision-framework.md` §6.1.R1.3.
  const activeRanked = ranked.filter((r) => r.agent.entries_count > 0);
  const inactiveRanked = ranked.filter((r) => r.agent.entries_count === 0);
  const { survivors, cull } = partitionSurvivors(activeRanked, survivalPct);
  const inactiveCull = inactiveRanked;  // every zero-entry agent is culled

  // Force-close any open positions on agents being retired so their final
  // fitness reflects MtM-at-seal rather than leaving positions orphaned on a
  // dead row. Refresh the ranking afterward so sealGeneration's `top_score`
  // sees the realized state.
  const ctx = buildLiveTickContext();
  let totalClosed = 0;
  for (const r of [...cull, ...survivors, ...inactiveCull]) {
    const result = realizeOpenPositions(r.agent, ctx, gen.gen_number);
    totalClosed += result.closed;
  }
  const refreshedRows = listAliveAgentsForGen(gen.gen_number);
  const refreshedRanked = rankAgents(refreshedRows);
  const topAfterClose = refreshedRanked[0] ?? ranked[0];

  for (const c of cull) retireAgent(c.agent.id, "culled by evolve (bottom pct)");
  for (const c of inactiveCull) retireAgent(c.agent.id, "no-activity (0 entries)");
  for (const s of survivors) retireAgent(s.agent.id, "carried over (survivor)");

  sealGeneration(gen.id, {
    n_alive: aliveRows.length,
    top_agent_id: topAfterClose.agent.id,
    top_score: topAfterClose.score.fitness,
    n_promoted_children: survivors.length,
  });

  const nextGen = gen.gen_number + 1;
  const nextGenId = startGeneration(nextGen, undefined, `bred from gen${gen.gen_number} survivors`);

  const polyConditionIdPool = (db().prepare("SELECT poly_condition_id FROM cross_venue_arbs WHERE active = 1").all() as { poly_condition_id: string }[])
    .map((r) => r.poly_condition_id);

  const newIds: number[] = [];

  // In 'compare' mode, spawn one programmatic + one LLM child per survivor so
  // we can group fitness by introduced_by across future generations.
  const mode = (process.env.ARENA_MUTATION_MODE ?? "programmatic").toLowerCase();
  const compare = mode === "compare";
  // Sim starting cash per agent — defaults to $100 so sim caps are small +
  // safe. Override via ARENA_STARTING_CASH or per-call opts.
  const startingCash = Number(process.env.ARENA_STARTING_CASH ?? "100");

  for (const s of survivors) {
    const parentGenome = parseGenome(s.agent.genome_json);
    const perf = {
      fitness: s.score.fitness, pnl_pct: s.score.pnl_pct,
      max_dd_pct: s.score.max_dd_pct, trades_count: s.score.trades_count,
    };
    if (compare) {
      const prog = await genFiringChild(
        () => mutateProgrammatic(parentGenome, Math.random, { polyConditionIdPool }),
        parentGenome.kind, { polyConditionIdPool },
      );
      const llm = await genFiringChild(
        () => mutateLlm(parentGenome, perf, { polyConditionIdPool }),
        parentGenome.kind, { polyConditionIdPool },
      );
      newIds.push(insertPaperAgent({
        name: `g${nextGen}-cp${newIds.length}-${genomeNickname(prog.genome)}`,
        generation: nextGen, parent_paper_agent_id: s.agent.id,
        genome: prog.genome, introduced_by: "mutate-programmatic",
        cash_usd_start: startingCash,
      }));
      newIds.push(insertPaperAgent({
        name: `g${nextGen}-cl${newIds.length}-${genomeNickname(llm.genome)}`,
        generation: nextGen, parent_paper_agent_id: s.agent.id,
        genome: llm.genome, introduced_by: "mutate-llm",
        cash_usd_start: startingCash,
      }));
    } else {
      const child = await genFiringChild(
        () => mutate(parentGenome, perf, { polyConditionIdPool }),
        parentGenome.kind, { polyConditionIdPool },
      );
      newIds.push(insertPaperAgent({
        name: `g${nextGen}-c${newIds.length}-${genomeNickname(child.genome)}`,
        generation: nextGen, parent_paper_agent_id: s.agent.id,
        genome: child.genome,
        introduced_by: mode === "llm" ? "mutate-llm" : "mutate-programmatic",
        cash_usd_start: startingCash,
      }));
    }
  }
  for (const s of survivors) {
    const parentGenome = parseGenome(s.agent.genome_json);
    // If the carryover genome wouldn't fire in replay, re-mutate it until it
    // does — otherwise the lineage is functionally dead and we waste a slot.
    let carryGenome: Genome = parentGenome;
    let carryNote = "survivor-carryover";
    if (s.agent.trades_count === 0) {
      const perf = { fitness: 0, pnl_pct: 0, max_dd_pct: 0, trades_count: 0 };
      const replacement = await genFiringChild(
        () => mutate(parentGenome, perf, { polyConditionIdPool }),
        parentGenome.kind, { polyConditionIdPool },
      );
      carryGenome = replacement.genome;
      carryNote = "survivor-carryover-refreshed";
    }
    const id = insertPaperAgent({
      name: `g${nextGen}-s${newIds.length}-${genomeNickname(carryGenome)}`,
      generation: nextGen,
      parent_paper_agent_id: s.agent.id,
      genome: carryGenome,
      introduced_by: carryNote,
      cash_usd_start: startingCash,
    });
    newIds.push(id);
  }

  // Inject aggressive presets — guaranteed-firing reference points so the
  // gene pool always has known-active agents to compete against. See PRD
  // §6.1.R1.4. Tagged `preset-aggressive` so mutation-stats can group fitness
  // by introduced_by across future generations.
  const presets = aggressivePresets({ polyConditionIdPool });
  for (const p of presets) {
    const id = insertPaperAgent({
      name: `g${nextGen}-p${newIds.length}-${p.nick}`,
      generation: nextGen,
      parent_paper_agent_id: null,
      genome: p.genome,
      introduced_by: "preset-aggressive",
      cash_usd_start: startingCash,
    });
    newIds.push(id);
  }

  setGenerationAgentCount(nextGenId, newIds.length);

  insertEvolutionEvent({
    event_type: "arena-evolve",
    summary: `gen${gen.gen_number} sealed — top fitness ${topAfterClose.score.fitness.toFixed(4)} by ${topAfterClose.agent.name}; bred ${newIds.length} into gen${nextGen}` + (totalClosed > 0 ? ` (force-closed ${totalClosed} open positions)` : "") + (inactiveCull.length > 0 ? ` · ${inactiveCull.length} no-activity culled` : ""),
    payload_json: JSON.stringify({
      from_gen: gen.gen_number, to_gen: nextGen,
      top_agent_id: topAfterClose.agent.id, top_score: topAfterClose.score.fitness,
      n_survivors: survivors.length, n_culled: cull.length, n_inactive_culled: inactiveCull.length,
      n_children: newIds.length, force_closed_positions: totalClosed,
    }),
  });

  // Championship check — top-1 lineage across last N sealed gens.
  let championshipRecorded = false;
  const recent = listGenerations(championshipGens).filter((g) => g.sealed_at !== null);
  if (recent.length >= championshipGens) {
    const tops = recent.map((g) => g.top_paper_agent_id).filter((x): x is number => x != null);
    if (tops.length === championshipGens) {
      const lineageRoot = (id: number): number => {
        let cur = getPaperAgent(id);
        while (cur && cur.parent_paper_agent_id != null) {
          const next = getPaperAgent(cur.parent_paper_agent_id);
          if (!next) break;
          cur = next;
        }
        return cur?.id ?? id;
      };
      const roots = tops.map(lineageRoot);
      if (roots.every((r) => r === roots[0])) {
        recordChampionship(
          tops[0],
          championshipGens,
          `lineage rooted at agent ${roots[0]} won top-1 in gens ${recent.map((g) => g.gen_number).reverse().join(", ")}`,
        );
        insertEvolutionEvent({
          event_type: "arena-championship",
          summary: `lineage ${roots[0]} eligible for capsule activation`,
          payload_json: JSON.stringify({ recent_gens: recent.map((g) => g.gen_number), tops, roots }),
        });
        championshipRecorded = true;
      }
    }
  }

  return {
    sealed_gen: gen.gen_number,
    next_gen: nextGen,
    n_survivors: survivors.length,
    n_culled: cull.length,
    n_children: newIds.length,
    top_paper_agent_id: topAfterClose.agent.id,
    top_score: topAfterClose.score.fitness,
    championship_recorded: championshipRecorded,
  };
}
