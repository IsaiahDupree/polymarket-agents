/**
 * Time-walked backtest for the Markov persistence strategy on cached
 * trajectories. Distinct from `replay-markov-on-cache.ts` (which only
 * evaluates at the latest point): this module simulates the strategy
 * tick-by-tick through every cached trajectory and tallies P&L.
 *
 * Algorithm (per slug):
 *
 *   for each tick t in trajectory:
 *     if entered: continue (one position per slug per backtest)
 *     if not enough history (< minHistory): continue
 *     build transition matrix from prices[0..t]
 *     check persistence at currentState; skip if < minPersistence
 *     run Monte Carlo → probYes
 *     edge = |probYes - currentYesPrice|
 *     if edge < minEdge: continue
 *     side = probYes > currentYesPrice ? "YES" : "NO"
 *     entryPrice = side == "YES" ? currentYesPrice : currentNoPrice
 *     entryTick = t
 *   if entered, compute pnl at terminal tick (last cached point):
 *     terminalYesPrice = last yesPrice
 *     payoff = side == "YES" ? terminalYesPrice : 1 - terminalYesPrice
 *     pnl = stake * (payoff / entryPrice - 1)
 *
 * Note that the "terminal price" is the LATEST cached price, not the
 * settled outcome. For unsettled markets that's an unrealized P&L
 * estimate. When the binary has settled (poly_binaries.settled = 1,
 * outcome_yes ∈ {0,1}), we use the resolved outcome instead — that's
 * the true backtest verdict.
 *
 * Pure / read-only.
 */

import { listCachedSlugs, replayCachedSlug, type SlugTrajectory } from "@/lib/backtest/cache-replay";
import { buildTransitionMatrix, priceToState, persistenceProbability, monteCarlo, validateMatrix } from "@/lib/quant/markov";
import { db } from "@/lib/db/client";

export type WalkParams = {
  /** Markov nstates — default 10 (Ricker article). */
  nStates?: number;
  /** Monte Carlo simulations — default 10,000. */
  nSims?: number;
  /** Time horizon (steps) for Monte Carlo — default 12 (≈12×60s lookahead). */
  timeHorizon?: number;
  /**
   * Persistence threshold p(j*,j*) — default 0.92.
   *
   * Tighter than the Ricker article's 0.87 baseline because cached
   * trajectories shorter than ~30 points produce degenerate matrices
   * with p(j*,j*) = 1.0 on noise. 0.92 still includes real persistence
   * regimes but rejects more of the noise floor.
   */
  minPersistence?: number;
  /** Minimum edge probYes - marketPrice — default 0.03. */
  minEdge?: number;
  /** Minimum number of historical points required before any decision — default 8. */
  minHistory?: number;
  /**
   * Minimum observed transitions OUT of the current state before the
   * matrix row is considered informative. Default 3. When fewer than
   * this many observations have started at the current state, the
   * row's probabilities are dominated by Laplace-smoothing / single-sample
   * noise — we refuse to act. This is the fix for the "degenerate
   * matrix on sparse data" failure mode the first walk-markov run
   * surfaced.
   */
  minObservationsCurrentState?: number;
  /** $ stake per entry — default 2 (the Hermes / 2-dollar-bot stake). */
  stakeUsd?: number;
};

export type EntryEvent = {
  slug: string;
  tickIndex: number;
  /** Wall-clock time of the entry. */
  enteredAt: string;
  side: "YES" | "NO";
  entryPrice: number;
  /** persistence probability that gated the entry. */
  persistence: number;
  /** Monte Carlo predicted probYes at entry. */
  probYes: number;
  /** Edge that the strategy saw at entry. */
  edge: number;
  /** YES price at the last cached point (used for unsettled markets' MTM). */
  terminalYesPrice: number;
  /** When the market is settled, the resolved YES outcome (1=YES won, 0=NO won). */
  resolvedOutcomeYes: number | null;
  /** $ profit/loss — uses outcome when settled, terminal price otherwise. */
  pnlUsd: number;
  /** "settled" when payoff comes from the resolved outcome; "mtm" when from terminal price. */
  pnlBasis: "settled" | "mtm";
};

export type WalkResult = {
  slug: string;
  nPoints: number;
  /** The entry that triggered (at most one per slug per backtest). */
  entry: EntryEvent | null;
  /** Diagnostic reason if no entry — last-tick state. */
  noEntryReason?: string;
};

export type WalkAggregate = {
  totalSlugs: number;
  slugsConsidered: number;       // had enough history
  slugsEntered: number;
  slugsWon: number;
  slugsLost: number;
  slugsUnsettled: number;
  winRate: number;
  totalPnlUsd: number;
  meanPnlUsd: number;
  totalStakeUsd: number;
};

/** Resolve outcome lookup from poly_binaries by slug. Returns null when
 *  the binary isn't settled or we don't have it. */
function lookupOutcome(slug: string): number | null {
  // Slugs in poly_binaries are stored differently — the canonical slug
  // shape is what listCachedSlugs returned. We look up by event_slug or
  // a derived match on question (which contains the recurrence string).
  // For now: only return outcome when we can find a settled row matching
  // the slug fragment.
  const row = db().prepare(`
    SELECT settled, outcome_yes
      FROM poly_binaries
     WHERE event_slug = ?
        OR question LIKE ?
     LIMIT 1
  `).get(slug, `%${slug}%`) as { settled: number; outcome_yes: number | null } | undefined;
  if (!row || !row.settled || row.outcome_yes === null) return null;
  return row.outcome_yes;
}

/** Walk one trajectory and return the first entry (if any). */
export function walkOne(traj: SlugTrajectory, params: WalkParams): WalkResult {
  const nStates = params.nStates ?? 10;
  const nSims = params.nSims ?? 10_000;
  const timeHorizon = params.timeHorizon ?? 12;
  const minPersistence = params.minPersistence ?? 0.92;
  const minEdge = params.minEdge ?? 0.03;
  const minHistory = params.minHistory ?? 8;
  const minObsCurrentState = params.minObservationsCurrentState ?? 3;
  const stakeUsd = params.stakeUsd ?? 2;

  const points = traj.points.filter((p) => p.yesPrice !== null);
  if (points.length < minHistory + 1) {
    return { slug: traj.slug, nPoints: points.length, entry: null, noEntryReason: `too few points (${points.length} < ${minHistory + 1})` };
  }

  let lastReason = "";
  for (let t = minHistory; t < points.length; t++) {
    const history = points.slice(0, t).map((p) => p.yesPrice!);
    const currentYes = points[t].yesPrice!;
    const currentNo = points[t].noPrice ?? (1 - currentYes);
    const T = buildTransitionMatrix(history, nStates);
    const state = priceToState(currentYes, nStates);
    // Sparse-row guard: refuse to act when the current state has too
    // few observed transitions to support a meaningful matrix row.
    // validateMatrix is cheap (O(n_history)) so the per-tick cost is fine.
    const v = validateMatrix(T, history, { minObservationsPerRow: minObsCurrentState });
    const currentStateObservations = v.rowObservations[state] ?? 0;
    if (currentStateObservations < minObsCurrentState) {
      lastReason = `current-state obs ${currentStateObservations} < ${minObsCurrentState} at tick ${t}`;
      continue;
    }
    const pers = persistenceProbability(T, state);
    if (pers < minPersistence) {
      lastReason = `persistence ${pers.toFixed(3)} < ${minPersistence} at tick ${t}`;
      continue;
    }
    const mc = monteCarlo(T, state, timeHorizon, { nSims });
    const edge = Math.abs(mc.probYes - currentYes);
    if (edge < minEdge) {
      lastReason = `edge ${edge.toFixed(3)} < ${minEdge} at tick ${t}`;
      continue;
    }
    const side: "YES" | "NO" = mc.probYes > currentYes ? "YES" : "NO";
    const entryPrice = side === "YES" ? currentYes : currentNo;
    // Compute P&L.
    const terminal = points[points.length - 1];
    const terminalYes = terminal.yesPrice!;
    const resolved = lookupOutcome(traj.slug);
    let pnlBasis: "settled" | "mtm";
    let payoff: number;
    if (resolved !== null) {
      pnlBasis = "settled";
      // Binary payoff: $1 per share if your side wins, $0 otherwise.
      const won = (side === "YES" && resolved === 1) || (side === "NO" && resolved === 0);
      payoff = won ? 1 : 0;
    } else {
      pnlBasis = "mtm";
      // Mark-to-market against the LATEST cached price.
      payoff = side === "YES" ? terminalYes : 1 - terminalYes;
    }
    // shares = stakeUsd / entryPrice; pnl = shares * payoff - stakeUsd.
    const pnlUsd = (stakeUsd / entryPrice) * payoff - stakeUsd;
    return {
      slug: traj.slug,
      nPoints: points.length,
      entry: {
        slug: traj.slug,
        tickIndex: t,
        enteredAt: points[t].fetchedAt,
        side,
        entryPrice,
        persistence: pers,
        probYes: mc.probYes,
        edge,
        terminalYesPrice: terminalYes,
        resolvedOutcomeYes: resolved,
        pnlUsd,
        pnlBasis,
      },
    };
  }
  return { slug: traj.slug, nPoints: points.length, entry: null, noEntryReason: lastReason || "no qualifying tick" };
}

/** Walk every cached slug matching the filter; aggregate results. */
export function walkAll(
  filter: { asset?: string; recurrence?: string; limit?: number } = {},
  params: WalkParams = {},
): { aggregate: WalkAggregate; results: WalkResult[] } {
  const stakeUsd = params.stakeUsd ?? 2;
  const slugs = listCachedSlugs({ asset: filter.asset, recurrence: filter.recurrence, limit: filter.limit ?? 500 });
  const results: WalkResult[] = [];
  let considered = 0; let entered = 0; let won = 0; let lost = 0; let unsettled = 0;
  let totalPnl = 0; let totalStake = 0;
  for (const s of slugs) {
    const traj = replayCachedSlug(s.slug);
    if (!traj) { results.push({ slug: s.slug, nPoints: 0, entry: null, noEntryReason: "no trajectory" }); continue; }
    const r = walkOne(traj, params);
    results.push(r);
    if (r.entry === null) continue;
    considered++; entered++;
    totalStake += stakeUsd;
    totalPnl += r.entry.pnlUsd;
    if (r.entry.pnlBasis === "settled") {
      if (r.entry.pnlUsd > 0) won++;
      else lost++;
    } else {
      unsettled++;
    }
  }
  // For win-rate stat, count only settled entries.
  const settledEntries = won + lost;
  const winRate = settledEntries > 0 ? won / settledEntries : 0;
  return {
    aggregate: {
      totalSlugs: slugs.length,
      slugsConsidered: results.filter((r) => r.nPoints > (params.minHistory ?? 8)).length,
      slugsEntered: entered,
      slugsWon: won,
      slugsLost: lost,
      slugsUnsettled: unsettled,
      winRate,
      totalPnlUsd: totalPnl,
      meanPnlUsd: entered > 0 ? totalPnl / entered : 0,
      totalStakeUsd: totalStake,
    },
    results,
  };
}
