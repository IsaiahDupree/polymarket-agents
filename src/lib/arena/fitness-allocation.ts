/**
 * Capital-follows-fitness allocator.
 *
 * Replaces the equal-split allocation in auto-promote.ts so winning elites
 * earn proportionally more capital. Same total risk envelope; only the
 * distribution changes.
 *
 * Algorithm (pure / deterministic):
 *
 *   1. RESERVE the floor first: floor_per_agent = totalBudget × minShare
 *      remaining = totalBudget × (1 - N × minShare)
 *   2. Shift each agent's fitness so the worst qualifying elite has
 *      shifted_fitness = 1.0 (avoids zero/negative weights).
 *   3. Normalize: weight[i] = shifted[i] / sum(shifted)
 *   4. Distribute the remaining by weight, ADD the floor.
 *      allocation[i] = floor_per_agent + weight[i] × remaining
 *
 * This is materially different from "compute weights, clip floor,
 * renormalize" — that approach silently dilutes the floor when the leader
 * has extreme fitness. By reserving the floor first, the floor is
 * GUARANTEED regardless of fitness spread.
 *
 * Edge cases:
 *   - 1 elite → gets 100% of budget (regardless of fitness)
 *   - All identical fitness → falls through to equal split
 *   - N elites but min_share × N > 1.0 → throw (configuration error)
 *
 * Why a floor: without it, a dominant elite can take 90%+ and starve the
 * #2 elite to ~$0.10 which is useless. The floor preserves diversification
 * intent while still letting top performers earn extra capital.
 */

export type FitnessAllocationInputs = {
  /** Per-agent fitness scores. Order is preserved in output. */
  agents: readonly { id: number; name: string; fitness: number }[];
  /** Total USD to distribute across all agents. */
  totalBudgetUsd: number;
  /** Min fraction of budget each agent gets (floor). Default 0.15 (15%). */
  minShare?: number;
};

export type FitnessAllocationResult = {
  agent_id: number;
  agent_name: string;
  fitness: number;
  weight: number;
  allocation_usd: number;
};

const DEFAULT_MIN_SHARE = 0.15;

export function allocateByFitness(
  inputs: FitnessAllocationInputs,
): FitnessAllocationResult[] {
  const { agents, totalBudgetUsd } = inputs;
  const minShare = inputs.minShare ?? DEFAULT_MIN_SHARE;

  if (agents.length === 0) return [];

  // Single elite → no allocation math needed.
  if (agents.length === 1) {
    return [
      {
        agent_id: agents[0]!.id,
        agent_name: agents[0]!.name,
        fitness: agents[0]!.fitness,
        weight: 1.0,
        allocation_usd: totalBudgetUsd,
      },
    ];
  }

  // Sanity: min_share × N must leave room for the leader to win.
  if (minShare * agents.length >= 1.0) {
    throw new Error(
      `allocateByFitness: minShare ${minShare} × ${agents.length} agents ≥ 1.0 — no room left for weighting`,
    );
  }

  // 1. Reserve the floor for every agent BEFORE distributing by fitness.
  const floorPerAgent = totalBudgetUsd * minShare;
  const remaining = totalBudgetUsd * (1 - agents.length * minShare);

  // 2. Shift fitnesses so the worst qualifier has shifted_fitness = 1.
  const fitnessValues = agents.map((a) => a.fitness);
  const minFitness = Math.min(...fitnessValues);
  const shifted = fitnessValues.map((f) => f - minFitness + 1);

  // 3. Normalize shifted fitness → weights for the REMAINING budget.
  const shiftedSum = shifted.reduce((s, x) => s + x, 0);
  const weights = shifted.map((s) => s / shiftedSum);

  // 4. Final allocation = floor + (weight × remaining). The reported
  // `weight` field is the share of TOTAL budget the agent received (for UI).
  return agents.map((a, i) => {
    const allocationUsd = +(floorPerAgent + weights[i]! * remaining).toFixed(2);
    return {
      agent_id: a.id,
      agent_name: a.name,
      fitness: a.fitness,
      weight: allocationUsd / totalBudgetUsd,
      allocation_usd: allocationUsd,
    };
  });
}
