/**
 * Multi-kind factory config helpers — extracted from
 * scripts/worker-multi-kind-factory.ts so they can be unit-tested
 * without importing the worker (which has side-effecting top-level code).
 */
import { GENOME_KINDS, type GenomeKind } from "../arena/genome";

/**
 * Kinds the multi-kind factory deliberately skips. The BTC-5m factory
 * owns poly_short_binary_directional with its tuned consistent-winner
 * profile; including it here would double-seed agents.
 */
export const MULTI_FACTORY_SKIP_KINDS: ReadonlySet<GenomeKind> = new Set<GenomeKind>([
  "poly_short_binary_directional",
]);

/**
 * Resolve the list of kinds the multi-kind factory should cover.
 *
 * Source of truth, in order:
 *   1. FACTORY_MULTI_KINDS env var (CSV) — operator-set subset.
 *      Unknown kinds in the env var are dropped with a warning.
 *   2. Default: every genome kind except the ones in SKIP_KINDS.
 *
 * An empty / whitespace-only env var falls through to the default.
 */
export function readTargetKinds(
  env: NodeJS.ProcessEnv = process.env,
  warn: (msg: string) => void = console.error,
): GenomeKind[] {
  const csv = env.FACTORY_MULTI_KINDS;
  if (csv && csv.trim().length > 0) {
    const requested = csv.split(",").map((s) => s.trim()).filter(Boolean);
    const valid: GenomeKind[] = [];
    const seen = new Set<string>();
    const invalid: string[] = [];
    for (const k of requested) {
      if ((GENOME_KINDS as readonly string[]).includes(k)) {
        if (!seen.has(k)) { valid.push(k as GenomeKind); seen.add(k); }
      } else {
        invalid.push(k);
      }
    }
    if (invalid.length > 0) {
      warn(`[multi-factory] WARN: ignoring unknown kinds in FACTORY_MULTI_KINDS: ${invalid.join(", ")}`);
    }
    return valid;
  }
  return GENOME_KINDS.filter((k) => !MULTI_FACTORY_SKIP_KINDS.has(k));
}

/**
 * Asset filter applied at the campaign level for each kind.
 *
 * Most cb_* kinds randomize product_id ∈ {BTC,ETH,SOL} inside their genome,
 * so leaving the campaign-level assetFilter undefined preserves breadth.
 * The Polymarket-binary kinds (poly_fade_spike, poly_breakout) benefit
 * from a single-asset hint at the campaign level for naming + filtering.
 */
export function assetForKind(kind: GenomeKind): string | undefined {
  switch (kind) {
    case "poly_fade_spike":
    case "poly_breakout":
      return "BTC";
    default:
      return undefined;
  }
}

/**
 * Compact slug used in campaign names + history-LIKE queries. Keeps the
 * first 12 alphabetic characters so the slug is filename-safe and the
 * SQL LIKE prefix stays stable as the kind's full name grows.
 *
 *   poly_fade_spike       → polyfadespik
 *   cb_mean_reversion     → cbmeanrevers
 *   poly_short_binary_dir → polyshortbin
 */
export function kindSlug(kind: string): string {
  return kind.replace(/[^a-z]/g, "").slice(0, 12);
}
