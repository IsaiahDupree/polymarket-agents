/**
 * One tick of the arena. For every alive agent in the current (unsealed)
 * generation, build the TickContext, ask the agent's decide() for a signal,
 * apply, mark-to-market, persist. Increment the generation's tick counter
 * and auto-call evolve when ARENA_EVOLVE_EVERY (default 50) is crossed.
 *
 * Designed to be called once per cron tick (e.g., every 5 min). Crashes
 * leave partial work persisted (per-agent transactions).
 */
import "./_env.ts";
import {
  listAliveAgentsForGen, getCurrentGeneration, persistAgentTick,
  insertPaperTrade, toLiveAgent, incrementGenerationTickCount,
} from "../src/lib/arena/db.ts";
import { applySignal, decide, markToMarket } from "../src/lib/arena/sim.ts";
import { buildLiveTickContext } from "../src/lib/arena/context.ts";
import { runEvolveOnce } from "../src/lib/arena/evolve.ts";
import { findLiveCapsuleForPaperAgent, refreshCapsuleRealtime, routeArenaSignal, supportsLiveRouting } from "../src/lib/arena/live-capsule.ts";
import { applyRiskRails } from "../src/lib/arena/risk-wrapper.ts";

const EVOLVE_EVERY = Number(process.env.ARENA_EVOLVE_EVERY ?? "50");

(async () => {
  const gen = getCurrentGeneration();
  if (!gen) {
    console.error("arena:tick — no open generation. Run `npm run arena:init` first.");
    process.exit(1);
  }

  const ctx = buildLiveTickContext();
  if (ctx.snapshots.size === 0) {
    console.error("arena:tick — no recent snapshots. Run `npm run worker:snapshot` first.");
    process.exit(1);
  }

  const agents = listAliveAgentsForGen(gen.gen_number).map(toLiveAgent);
  const rng = Math.random;
  const stats = { decided: 0, entries: 0, exits: 0, holds: 0, live_fills: 0, live_rejects: 0, ev_kelly_engaged: 0, ev_kelly_blocked: 0, ev_kelly_resized: 0 };

  for (const agent of agents) {
    try {
      let signal = decide(agent, ctx, rng);
      // EV+Kelly risk wrapper: engages when the genome attached a pTrueEstimate
      // to the signal (e.g. llm_oracle, wallet_copy). Pass-through otherwise.
      if (signal.kind === "entry") {
        const rail = applyRiskRails(signal, ctx, agent);
        if (!rail.kept) {
          signal = { kind: "hold" };
          stats.ev_kelly_blocked += 1;
        } else if (rail.engaged) {
          signal = rail.signal;
          stats.ev_kelly_engaged += 1;
          if (rail.sizeAdjusted) stats.ev_kelly_resized += 1;
        }
      }
      if (signal.kind === "hold") stats.holds += 1;
      if (signal.kind !== "hold") {
        // Route through ExecutionRouter when an agent has a live capsule AND
        // its venue supports live routing (Coinbase only in v1). On router
        // rejection, skip arena bookkeeping so we don't track phantom positions.
        const capsule = findLiveCapsuleForPaperAgent(agent.id);
        const liveRoutable = capsule && supportsLiveRouting(signal);
        let proceedToSim = true;
        if (capsule && liveRoutable) {
          const refPrice = ctx.snapshots.get(signal.market_id)?.latest.price ?? 0;
          // For exits, look up the open position so the router can compute
          // base_size from the held qty.
          const position = signal.kind === "exit"
            ? agent.positions.find((p) => p.market_id === signal.market_id)
            : undefined;
          const route = await routeArenaSignal(signal, capsule, agent.id, refPrice, position);
          if (!route.ok) { proceedToSim = false; stats.live_rejects += 1; }
          else if (route.status === "filled") { stats.live_fills += 1; }
        }
        if (proceedToSim) {
          const res = applySignal(agent, signal, ctx, gen.gen_number);
          if (res.trade) {
            insertPaperTrade(res.trade);
            if (res.trade.intent === "entry") stats.entries += 1;
            if (res.trade.intent === "exit")  stats.exits   += 1;
          }
        }
        if (capsule) refreshCapsuleRealtime(capsule.id, agent.id);
      }
      markToMarket(agent, ctx);
      persistAgentTick(agent);
      stats.decided += 1;
    } catch (err) {
      console.error(`[arena:tick] agent ${agent.name} crashed:`, (err as Error).message);
    }
  }

  const tickCount = incrementGenerationTickCount(gen.id);
  const railStr = stats.ev_kelly_engaged > 0 || stats.ev_kelly_blocked > 0
    ? ` rails=engaged${stats.ev_kelly_engaged}/blocked${stats.ev_kelly_blocked}/resized${stats.ev_kelly_resized}`
    : "";
  console.log(`arena:tick gen=${gen.gen_number} agents=${agents.length} → entries=${stats.entries} exits=${stats.exits} holds=${stats.holds} live=${stats.live_fills}/${stats.live_rejects + stats.live_fills}${railStr}  tick=${tickCount}/${EVOLVE_EVERY}`);

  // Auto-evolve trigger
  if (EVOLVE_EVERY > 0 && tickCount >= EVOLVE_EVERY) {
    console.log(`arena:tick → auto-evolve triggered (tick_count=${tickCount} >= ARENA_EVOLVE_EVERY=${EVOLVE_EVERY})`);
    const result = await runEvolveOnce();
    if ("skipped" in result) {
      console.log(`auto-evolve skipped: ${result.skipped}`);
    } else {
      console.log(
        `auto-evolve sealed gen${result.sealed_gen}; bred gen${result.next_gen} ` +
        `with ${result.n_children} agents (top fitness=${(result.top_score ?? 0).toFixed(4)})` +
        (result.championship_recorded ? "  🏆 championship eligible" : ""),
      );
    }
  }
})();
