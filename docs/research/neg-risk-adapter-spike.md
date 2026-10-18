---
title: "Neg Risk Adapter — Path B spike result"
type: spike-report
status: complete (recommendation: fall back to Path A)
created: 2026-05-30
relates_to: docs/research/atomic-multicall-plan.md
probe_script: scripts/probe-neg-risk-adapter.ts
---

# Path B spike — Neg Risk Adapter for atomic multi-leg execution

## TL;DR

**Path B as scoped is dead.** The probe ran against the address we have
(`0xe2222d279d744050d28e00520010520000310F59`, labelled
`negRiskCtfExchange` in `packages/adapters/polymarket/src/onchain.ts`)
and found NONE of the candidate Gnosis CTF helpers (`splitPosition`,
`mergePositions`, `redeemPositions`, hypothetical `executeBasket`).

That's expected on reflection: the address we know is the **Neg Risk
CTF Exchange** — the matching engine. The functions we want
(`splitPosition` etc.) live on a SEPARATE contract: the actual
**Neg Risk Adapter** (an address we don't have in the codebase) and
the underlying **Conditional Token Framework** at
`0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`.

To genuinely close out Path B we'd need to:
  1. Find the Neg Risk Adapter contract address (Polymarket's docs or a
     trace through one of their own Neg-Risk-event trades).
  2. Re-run the probe against THAT address.
  3. Evaluate the recommendation.

But there's a deeper problem that makes Path B less attractive than
Path A even if it works: **scope.**

## Why Path B is structurally narrower than Path A

Path B (Neg Risk Adapter) can ONLY do atomic execution INSIDE a single
Neg Risk event (e.g., "who wins the 2028 GOP primary" with N
candidates). That's a fraction of Polymarket's volume:

  - The original 0x_Discover article's failure mode (BUY YES + BUY NO
    on a SINGLE binary market) is NOT a Neg Risk basket — it's a
    cross-side basket on a 2-outcome conditional market. Path B doesn't
    help here.
  - Cross-event arbs (the bigger end of the article's payoff) are
    likewise NOT Neg Risk baskets — they're independent markets that
    happen to be logically related. Path B doesn't help.
  - The ONE case Path B helps is: an N-outcome Neg Risk market where
    sum-of-outcomes < $1 and we want to atomically split $1 of collateral
    into one of each outcome. That's a narrow strategy.

Even in the best case (Path B works perfectly for Neg Risk baskets),
we'd ALSO need Path A for everything else. There's no scenario where
Path B replaces Path A; it's purely additive.

## Path B's compounding risks

Even if we close the address gap:

  1. **Repurposing risk.** `splitPosition` is designed for COLLATERAL
     conversion. Using it as an arb mechanism means relying on Polymarket
     to never change its semantics. They could legitimately add a fee,
     a delay, or a permissioned check at any time without warning the
     community.
  2. **Audit cost is similar.** A wrapper that calls `splitPosition` +
     N market sells atomically still needs its own contract (because
     `splitPosition` only mints; the sales are separate). That contract
     needs audit too.
  3. **Edge per opportunity is lower.** Sum-of-outcomes mispricings on
     Neg Risk events are usually small (< 1%); the article's headline
     edges are on independent binaries.

## Recommendation

**Drop Path B. Commit fully to Path A.**

If the Neg Risk Adapter address surfaces later and someone with bandwidth
wants to re-probe, this doc + `scripts/probe-neg-risk-adapter.ts` are
ready. But the spike's purpose was to validate whether Path B was the
easier shortcut, and the answer is clearly no.

## Artifacts shipped from this spike

  - `src/lib/arb/neg-risk-adapter-probe.ts` — pure probe module + viem
    bytecode inspector. 6 tests.
  - `scripts/probe-neg-risk-adapter.ts` — CLI runner
    (`npm run probe:neg-risk`).
  - This spike report.
  - The probe ITSELF found `path_b_dead` against the address we know,
    which is itself useful negative data the operator should record.
