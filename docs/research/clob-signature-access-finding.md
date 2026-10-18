---
title: "CLOB v2 signature-access limitation — Path A scope finding"
type: finding
status: confirmed (2026-05-30 spike)
relates_to:
  - docs/research/atomic-multicall-plan.md
  - contracts/AtomicArbExecutor.sol
  - src/lib/arb/atomic-executor.ts
---

# Finding: Polymarket CLOB v2 does NOT expose maker-order signatures

## What I went looking for

The `EXEC_MODE=atomic` branch in `executeSingleMarketArb` is supposed to
call `AtomicArbExecutor.executeBasket([yesOrder, noOrder], ...)`. That
requires the **full `CtfOrder` struct including the maker's EIP-712
signature** for each leg. Without a signature, `CTFExchange.fillOrder`
reverts at signature validation.

The plan assumed the Polymarket CLOB SDK would expose these via a method
like `getOrders` or `getOrderBook` — that the operator could fetch
"the maker order at $0.30 on token X" and hand it to the contract.

## What I found

Read of `node_modules/@polymarket/clob-client-v2/dist/types/clob.d.cts`:

```ts
interface OpenOrder {
  id: string;
  status: string;
  owner: string;
  maker_address: string;
  market: string;
  asset_id: string;
  side: string;
  original_size: string;
  size_matched: string;
  price: string;
  associate_trades: string[];
  outcome: string;
  created_at: number;
  expiration: string;
  order_type: string;
}
```

**No `signature` field.** No `salt`, `nonce`, `fee_rate_bps`,
`signature_type`, or any of the other fields needed to reconstruct the
EIP-712 typed message. The SDK exposes order *metadata* but not the
cryptographic material.

The same pattern across the rest of the SDK: `MakerOrder` (returned as
part of a `Trade`) has more fields but still no signature. The signature
exists in Polymarket's matching engine; it's never sent to API consumers
because the matching engine validates + executes on behalf of takers
through its own keys.

## What this means for Path A's contract

The `AtomicArbExecutor` contract is structurally fine — it correctly
implements atomic multi-leg fills with per-leg revert. But the operator
can only use it for orders THEY OWN THE SIGNATURE FOR. Two scenarios:

### Scenario 1: TAKER raid on someone else's order book (the article's case)

`BUY YES at $0.30 + BUY NO at $0.30` against existing maker liquidity.

**INFEASIBLE through this contract.** We don't have the maker
signatures. We have to submit via the CLOB API, which means the existing
parallel-best-effort path (`Promise.all` in `executeSingleMarketArb`)
is the only option. The partial-fill rollback + block-timing telemetry
already shipped (2026-05-30) are the actual mitigation for this case.

### Scenario 2: SELF-MAKER strategy (where the contract genuinely helps)

**WE** post limit orders as the maker on both YES and NO sides. The
contract address signs the orders (via EIP-1271 or by holding the
private key — design decision). When market conditions create a
crossable spread between our own orders, we call `executeBasket` on
our own pre-signed orders + an ERC20 transfer of $1, atomically:

  - Crosses our YES order (we buy YES from ourselves at our price)
  - Crosses our NO order (we buy NO from ourselves at our price)
  - Receive YES + NO outcome tokens worth $1 at resolution
  - Net cost: < $1 (our two ask prices summed)

This IS a valid arbitrage strategy and the contract correctly
implements it atomically. It's just a different strategy than the
article describes.

## Recommended pivots

1. **DROP** the EXEC_MODE=atomic path for cross-book taker raids. The
   feature was based on an incorrect assumption about CLOB API access.
   The `arb-atomic-skipped` audit event we already emit makes this
   transparent in production.

2. **REPURPOSE** the contract for self-maker arb strategies. New
   integration work needed:
   - Maker signature flow: contract signs orders via EIP-1271 lookup,
     or operator's key signs on behalf of a delegated maker address.
   - Posting flow: scanner identifies a YES + NO basket where sum-of-
     asks < $1, posts limit orders, then watches for someone to lift
     them (or self-crosses if liquidity allows).
   - This is a meaningful project but a different one from what the
     plan originally scoped.

3. **KEEP** the artifacts as-is for the contract + TS client + tests +
   deploy runbook. They're correct and deployable. Just don't deploy
   without doing the self-maker integration first — there's nothing for
   the contract to do otherwise.

4. **THE ALREADY-SHIPPED MITIGATIONS** (partial-fill rollback +
   block-timing telemetry) are now the primary article-failure-mode
   defense. They are NOT downgraded by this finding — they're the
   correct answer for the taker-raid case.

## Open follow-up: does Polymarket have a private API for signatures?

Possible — institutional bots may have access to a private endpoint
that exposes maker signatures (this would make Path A's contract
usable for taker raids too). To check:
- Contact Polymarket's engineering team via their Discord / business
  channel.
- Look at the bytecode of the top-volume bots (kch123, RN1, etc. from
  the 0x_Discover article's 15-bots table) and see what their contract
  calls. If they're calling `fillOrder` directly with sigs they didn't
  post themselves, there's an access pathway we don't know about.

Neither lookup is in scope right now; flagging for future.
