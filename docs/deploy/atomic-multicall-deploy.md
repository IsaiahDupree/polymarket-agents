---
title: AtomicArbExecutor deploy runbook
type: deploy-runbook
status: pre-audit (DO NOT DEPLOY)
created: 2026-05-30
contract: contracts/AtomicArbExecutor.sol
client: src/lib/arb/atomic-executor.ts
plan: docs/research/atomic-multicall-plan.md
---

# AtomicArbExecutor — deploy + verify runbook

> ⚠️ **Do not deploy this contract to Polygon mainnet without a
> professional audit.** It holds USDC + has owner privileges. Audit is
> the first non-skippable step.
>
> ⚠️ **Scope constraint discovered 2026-05-30** — see
> [`docs/research/clob-signature-access-finding.md`](../research/clob-signature-access-finding.md).
> Polymarket's public CLOB v2 SDK does NOT expose maker-order
> signatures. This contract CANNOT atomically fill other wallets'
> resting maker orders (the 0x_Discover article's "taker raid" use
> case). It CAN atomically execute self-maker arb strategies where
> the operator owns both sides. **Confirm which use case you actually
> need before paying for the audit.** If the use case is taker raid,
> the partial-fill rollback + block-timing telemetry already shipped
> are the right answer and this contract is wasted audit spend.

## 0. Pre-deploy checklist

  - [ ] Audit complete (target firms: Trail of Bits, Spearbit, Cantina;
        budget $5K–$15K for ~200 LOC Solidity)
  - [ ] Auditor signed off on the items in the contract's "Audit
        checklist" comment block (signature replay, reentrancy, owner
        key risk, redemption path, pause hatch)
  - [ ] Open question from the design plan resolved: **does
        Polymarket's CLOB v2 expose batch submission via the off-chain
        API?** If yes, this contract may not be needed at all.
  - [ ] CTF Exchange ABI in `contracts/interfaces/ICTFExchange.sol`
        verified byte-for-byte against the live ABI on PolygonScan
        (0xE111180000d2663C0091e4f400237545B87B996B). Order struct
        field order + types match exactly.

## 1. Toolchain setup

The repo does NOT currently have Solidity tooling configured. Install
Foundry for the deploy:

```bash
# https://getfoundry.sh
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

Initialize a foundry project alongside the existing code (skip if
already done):

```bash
forge init --no-commit --no-git contracts
# This will create contracts/foundry.toml + a default test layout.
# Move the existing AtomicArbExecutor.sol + interfaces/ into the
# foundry src/ dir, then update foundry.toml's src path.
```

`foundry.toml` should pin:

```toml
[profile.default]
src = "."
out = "out"
libs = ["lib"]
optimizer = true
optimizer_runs = 200
solc_version = "0.8.20"
```

## 2. Fork-test against live Polygon

Create `contracts/test/AtomicArbExecutor.t.sol` that:

  1. Forks Polygon at a recent block (e.g. last week's known arb).
  2. Funds the test wallet with USDC via `deal(USDC, address(this), 100e6)`.
  3. Deploys AtomicArbExecutor.
  4. Constructs an Order struct matching a real maker order from that block.
  5. Calls `executeBasket` with the order + a sensible fillAmount.
  6. Asserts the fill happened by checking the OrderFilled event was emitted.

Run:

```bash
forge test --fork-url https://polygon-mainnet.g.alchemy.com/v2/<KEY> --fork-block-number <BLOCK>
```

Expected: all tests pass + gas under 250k per leg.

## 3. Deploy to Polygon mainnet

```bash
# Required env:
#   POLYGON_RPC_URL    - your Alchemy / QuickNode / Infura endpoint
#   DEPLOYER_KEY       - hex-encoded private key for the deployer EOA (NEVER commit)
#   USDC_ADDRESS       - 0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359 (Polygon native USDC)
#                        or 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174 (USDC.e bridged)
#   CTF_EXCHANGE       - 0xE111180000d2663C0091e4f400237545B87B996B

forge create \
  --rpc-url $POLYGON_RPC_URL \
  --private-key $DEPLOYER_KEY \
  contracts/AtomicArbExecutor.sol:AtomicArbExecutor \
  --constructor-args $USDC_ADDRESS $CTF_EXCHANGE \
  --verify --etherscan-api-key $POLYGONSCAN_API_KEY
```

Capture the deployed address from the output. Save to env:

```bash
echo "ATOMIC_EXECUTOR_ADDRESS=0x..." >> .env.local
```

## 4. Post-deploy verification

Run the smoke checks:

```bash
# 1. Owner is correct
cast call $ATOMIC_EXECUTOR_ADDRESS "owner()(address)" --rpc-url $POLYGON_RPC_URL
# Expected: your deployer address

# 2. USDC approval is max
cast call $USDC_ADDRESS \
  "allowance(address,address)(uint256)" \
  $ATOMIC_EXECUTOR_ADDRESS $CTF_EXCHANGE \
  --rpc-url $POLYGON_RPC_URL
# Expected: 2^256-1 (115792089237316195423570985008687907853269984665640564039457584007913129639935)

# 3. Not paused
cast call $ATOMIC_EXECUTOR_ADDRESS "paused()(bool)" --rpc-url $POLYGON_RPC_URL
# Expected: false
```

## 5. Fund with a tiny amount

Start with $25 USDC. NEVER more than you're prepared to lose to a
discovered bug post-audit.

```bash
# Approve the contract to pull $25 from your trading EOA
cast send $USDC_ADDRESS \
  "approve(address,uint256)" \
  $ATOMIC_EXECUTOR_ADDRESS 25000000 \
  --private-key $TRADING_KEY \
  --rpc-url $POLYGON_RPC_URL

# Pull the funds
cast send $ATOMIC_EXECUTOR_ADDRESS \
  "fund(uint256)" 25000000 \
  --private-key $TRADING_KEY \
  --rpc-url $POLYGON_RPC_URL
```

## 6. Wire into the TS executor

The TS path is already in place (`src/lib/arb/atomic-executor.ts` +
the `EXEC_MODE=atomic` branch in `executeSingleMarketArb`). Enable:

```bash
export ATOMIC_EXECUTOR_ADDRESS=0x...      # from step 3
export EXEC_MODE=atomic                    # routes arb path through the contract
# Leave ATOMIC_EXECUTOR_LIVE unset for the first run — that puts the TS
# client in dry-run mode (returns calldata without submitting). Inspect
# the calldata against the on-chain contract via PolygonScan's "Read /
# Write" interface to confirm the encoding before enabling LIVE.

export ATOMIC_EXECUTOR_LIVE=1              # then enable live submissions
```

## 7. The integration gap to close before live submissions actually work

The current `EXEC_MODE=atomic` branch in `executeSingleMarketArb`
submits an EMPTY basket (the TS client rejects it with `unsatisfiable`).
That's intentional — it lets the env flag exist before the maker-order
fetching is wired.

What still needs to be built:

  1. CLOB `/orders` endpoint integration: fetch the raw active maker
     orders (with `signature`, `salt`, `nonce`, etc.) for a given
     market.
  2. A bridge function in `executeSingleMarketArb` that, on
     `EXEC_MODE=atomic`, queries the CLOB for orders matching the
     planned legs and builds the `CtfOrder[]` arg.
  3. `minFills[]` derivation: for the article's "$0.30 expected fill,
     $0.78 actual" failure case, the minFills should be sized so any
     drift past the operator's price tolerance triggers the contract's
     `MinFillNotMet` revert.

These are TypeScript-side, no further Solidity work needed.

## 8. Monitoring + ops

Once live:

  - `evolution_log.event_type = 'arb-atomic-success'` rows are tx-hash-bearing.
  - The existing `block-timing` telemetry (`src/lib/arb/block-timing.ts`)
    can post-hoc verify each tx landed in a single block. Compare to
    pre-atomic baseline.
  - Set up a `/safety`-page alert if the contract's USDC balance drops
    below a floor — early warning if the bot is bleeding to bad arbs.

## 9. Incident response

  - **Suspected bug**: `cast send $ATOMIC_EXECUTOR_ADDRESS "pause()" --private-key $OWNER_KEY ...`
    immediately blocks new baskets.
  - **Compromised key**: `transferOwnership(newOwner)` is the only
    recovery path. Have a multisig or fresh hardware-wallet address
    ready before deploy.
  - **Withdraw all USDC**: `withdraw(balanceOf(contract))` to the owner.
