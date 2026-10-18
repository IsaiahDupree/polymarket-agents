---
title: "Atomic multi-leg Polymarket execution — design plan"
type: design-doc
status: draft (not yet approved)
created: 2026-05-30
relates_to: docs/research/articles/0x_discover-polymarket-40m-arb.md
follow_up_to: rollback-planner.ts + block-timing.ts (article #1 round shipped 2026-05-30)
---

# Atomic multi-leg execution — design plan

## 1. The problem

The 0x_Discover article (#1, "$40M arbitrage roadmap") frames the
arbitrage failure mode as:

> Your arbitrage plan: buy YES at $0.30, buy NO at $0.30, guaranteed
> $0.40 profit. Reality: YES fills at $0.30 ✓. Price updates. NO fills
> at $0.78 ✗. You just lost $0.08.

What's shipped today (`src/lib/arb/rollback-planner.ts` + wiring into
`executeSingleMarketArb`) mitigates this by detecting the partial fill
and immediately dumping the over-filled leg via a closing SELL. That
gets us back to flat-with-a-loss instead of long-with-directional-risk.
But it's a mitigation, not a fix — every partial-fill round trip burns
slippage.

The article's actual claim is that the winning bots get TRUE atomicity:
both legs fill in the same block or NEITHER does. On Polymarket this
requires a custom on-chain path because the CLOB's REST API matches
each order independently — `Promise.all` is best-effort parallel, not
atomic.

## 2. What atomicity actually requires on Polymarket

Polymarket's settlement runs on Polygon via three contracts (verified
in `packages/adapters/polymarket/src/onchain.ts`):

  - `0xE111180000d2663C0091e4f400237545B87B996B` — CTF Exchange (v2)
  - `0xe2222d279d744050d28e00520010520000310F59` — Neg Risk CTF Exchange
  - `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` — Conditional Token
    Framework (Gnosis CTF)

Each exchange exposes `fillOrder(order, signature, fillAmount)` (and
`fillOrders(...)` for batch). An off-chain CLOB order is a signed
EIP-712 message; the on-chain `fillOrder` validates the signature
against the maker's address.

To get atomic multi-leg execution we need a contract that:

  1. Holds USDC (or pulls it via approved spend allowance).
  2. Calls `fillOrder` on the CTF Exchange (and/or Neg Risk variant) for
     each leg, all inside the same tx.
  3. Reverts the whole tx if any leg fails or fills outside the price
     bounds we specified.

This is well-trodden territory in DeFi MEV bots and has a clean
reference implementation pattern (multicall + custom revert logic).

## 3. Three implementation paths, ranked

### Path A — Fork makerdao/multicall3 with custom revert  (recommended)

Smallest contract that does the job. Multicall3 already supports
"call this address with this calldata, allow-or-revert per call." We add
one wrapper that:

  - Pre-checks: USDC balance ≥ sum of fill amounts.
  - Issues `fillOrder(...)` calls in order.
  - Reverts if ANY call returns less than the operator's `minFill`.

Pros:
  - ~150 lines of Solidity. One audit pass.
  - No new dependencies; multicall3 is widely-deployed already.
  - Operator funds the contract once, refills as PnL flows.

Cons:
  - Still needs an audit (this is real money on real chain).
  - On-chain settlement adds ~$0.05–0.20 per tx in Polygon gas, eaten
    only when the arb is real.

### Path B — Use Polymarket's existing Neg Risk Adapter

The Neg Risk Adapter contract already coordinates multi-outcome events
atomically (e.g., when you redeem a basket position). We may be able to
piggyback on its `splitPosition`/`mergePositions` calls to express a
basket arb without deploying anything new.

Pros:
  - No new contract. No audit cost beyond what Polymarket already did.

Cons:
  - The Adapter's surface area is designed for redemption, not active
    trading. We'd be using it for a purpose it wasn't built for; any
    upstream change could silently break us.
  - Doesn't help for arbs across non-Neg-Risk markets.

### Path C — Flashbots-style relay (Polygon Marlin / Polygon Fast Lane)

Submit a bundle of pre-signed transactions to a private relay that
guarantees same-block inclusion (or no inclusion). This is the canonical
MEV path on Ethereum.

Pros:
  - No contract dev — pure off-chain orchestration.
  - True same-block guarantee from the relay side.

Cons:
  - Polygon's MEV relay ecosystem is much thinner than Ethereum's.
    Marlin's MEV-Boost-on-Polygon is in beta as of late 2025; coverage
    is patchy.
  - Doesn't actually solve the atomic-fill problem unless EACH order
    independently encodes its price bounds correctly — and the CLOB's
    `fillOrder` does that already, so this just adds a relay without
    solving the core issue.
  - Adds relay-trust assumption.

**Recommendation: Path A.** Smallest surface, audit cost is bounded
($5K–$15K from a reputable firm for ~150 lines), and it composes
cleanly with the existing CLOB/Neg-Risk contracts.

## 4. Path A — concrete steps

**Phase 1 — design (1 day)**

  - Sketch the Solidity contract. Single function:
    `executeBasket(Order[] orders, uint256[] fillAmounts, uint256 minTotalFill)`
  - Decide ownership model: simple Ownable with a single operator key,
    or a multi-sig? For our scale, Ownable + the existing trading EOA.
  - Verify against CTF Exchange v2 ABI in
    `packages/adapters/polymarket/src/onchain.ts`.

**Phase 2 — implementation (2–3 days)**

  - Solidity contract (`contracts/AtomicArbExecutor.sol`).
  - Foundry test suite: fork-test against live Polygon state with a
    mainnet snapshot of a known historical arb opportunity.
  - Gas profiling — target < 250k gas per leg.

**Phase 3 — audit (2–4 weeks, external)**

  - Reputable firm — Trail of Bits, Spearbit, Cantina, or a single
    independent auditor. Budget $5K–$15K for ~150 LOC of Solidity.
  - Specific concerns to flag:
    - Signature replay (the CTF Exchange should handle this, but
      double-check our wrapper doesn't re-enable it).
    - Reentrancy on `fillOrder` callbacks (CTF doesn't have callbacks,
      but check).
    - Front-running by the operator themselves (a deployed contract
      with USDC is a target; consider per-tx min-fill bounds).

**Phase 4 — deploy + ops (1 day)**

  - Deploy on Polygon mainnet via Hardhat/Foundry script.
  - Verify on PolygonScan.
  - Fund with a small initial USDC balance ($100).
  - Add `src/lib/arb/atomic-executor.ts` — TypeScript client that builds
    the call data and submits via viem `writeContract`.
  - Wire as a third execution mode in `executeSingleMarketArb`:
    `EXEC_MODE=atomic` (alongside current default + the partial-fill
    rollback path).

**Phase 5 — measurement (ongoing)**

  - The block-timing telemetry (`src/lib/arb/block-timing.ts`) already
    ships. After Phase 4 every atomic-executed arb writes
    `sameBlock: true` to evolution_log, vs. parallel-best-effort runs
    where we'll see the actual split-block distribution.
  - Run BOTH modes in parallel for 2 weeks; compare PnL + fill rate.
    The Becker-paper shape predicts atomic mode wins by ~5–10pp on
    fill rate.

## 5. Risks + open questions

  - **Audit timeline.** If we move on this, Phase 3 is the bottleneck.
    Two weeks minimum, four if the auditor finds anything substantive.
  - **CLOB API still posts off-chain orders.** Our contract calls
    `fillOrder` against orders that someone else posted. We need to be
    sure we're not racing other takers on the same order — the CLOB
    serves the same order to multiple subscribers, and only one
    `fillOrder` succeeds. Mitigation: try-catch each leg and revert
    the whole bundle if any leg's fill amount is below `minFill`.
  - **USDC approval surface.** The contract needs USDC approval; that
    approval is a permanent attack surface. Use Revoke.cash to limit
    + check periodically.
  - **Gas cost.** $0.05–0.20 per tx eats edge on small arbs. The
    article's "$496 average profit per trade" assumes the operator is
    sizing up — for our scale (per-trade caps in single digits to low
    double digits), gas could be 1–5% of edge. Tighten `MIN_EDGE_USD`
    accordingly.
  - **Open question:** does Polymarket's CLOB v2 expose batch
    submission via the off-chain API (an endpoint that takes N orders
    and commits all-or-none on its side)? If yes, that's a simpler
    fix than a custom contract — let's check the API docs before
    starting Path A. (As of 2026-05-26 the existing
    `executeSingleMarketArb` uses `createAndPostMarketOrder` per leg,
    so the answer is probably no, but worth a 30-minute spike.)

## 6. Decision needed

  - **Approve Path A and budget for audit ($5K–$15K)?**
  - **Or wait?** The rollback+telemetry mitigation already addresses
    the article's worst case (no more unhedged directional exposure).
    If the operator's per-trade size stays small (≤ $25), the
    additional edge from true atomicity is bounded by what we lose to
    rollback round-trips. Worth measuring with the existing telemetry
    for a few weeks before committing the audit budget.

  - **Recommended:** wait 2 weeks, gather rollback-frequency + block-
    timing data, then re-evaluate. If we're seeing > 5% partial-fill
    rate, Path A pays for itself quickly.
