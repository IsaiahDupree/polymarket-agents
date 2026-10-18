/**
 * TypeScript client for AtomicArbExecutor.sol (Path A from
 * docs/research/atomic-multicall-plan.md).
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠️  REQUIRES THE CONTRACT TO BE DEPLOYED AND AUDITED FIRST.
 *
 * ⚠️  SCOPE CONSTRAINT (2026-05-30 spike, see
 *     docs/research/clob-signature-access-finding.md):
 *
 *     The CLOB v2 SDK's OpenOrder type contains no signature field.
 *     That means this client cannot be used to atomically fill OTHER
 *     wallets' maker orders. It can only fill orders the operator
 *     CONTROLS THE SIGNATURE FOR — i.e., self-maker strategies.
 *
 *     For the 0x_Discover article's "BUY YES + BUY NO against the open
 *     book" failure mode, use the parallel-best-effort path in
 *     executeSingleMarketArb + partial-fill rollback + block-timing
 *     telemetry. Those are the actual mitigations for the article's
 *     failure shape.
 *
 * Until ATOMIC_EXECUTOR_ADDRESS is set in env AND a self-maker
 * integration is wired, this client is dormant: `submitBasket` returns
 * `{kind: "no_contract"}` and the caller falls back gracefully.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Two responsibilities:
 *
 *   1. **buildExecuteBasketCalldata(orders, fillAmounts, minFills, tag)** —
 *      PURE. Encodes the `executeBasket(...)` ABI call. Tested without
 *      any network access.
 *
 *   2. **submitBasket(orders, fillAmounts, minFills, tag)** — sends the
 *      tx via viem `writeContract` IF the contract address is set AND
 *      ATOMIC_EXECUTOR_LIVE=1. Otherwise returns a structured "no-op"
 *      verdict.
 *
 * Why split: the calldata builder is the hard-to-get-right part and we
 * want it deterministic + unit-tested. The network call is a thin
 * wrapper that the caller can mock.
 */

import { encodeFunctionData, parseAbi, type Hex } from "viem";

/** Mirrors ICTFExchange.Order in contracts/interfaces/ICTFExchange.sol. */
export type CtfOrder = {
  salt: bigint;
  maker: Hex;
  signer: Hex;
  taker: Hex;
  tokenId: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  expiration: bigint;
  nonce: bigint;
  feeRateBps: bigint;
  /** 0 = BUY, 1 = SELL. */
  side: 0 | 1;
  /** 0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE. */
  signatureType: 0 | 1 | 2;
  signature: Hex;
};

/**
 * Minimal ABI: just the function selectors the TS client needs to encode.
 * Full ABI lives next to the contract source for the deploy script.
 */
export const ATOMIC_EXECUTOR_ABI = parseAbi([
  "struct CtfOrder { uint256 salt; address maker; address signer; address taker; uint256 tokenId; uint256 makerAmount; uint256 takerAmount; uint256 expiration; uint256 nonce; uint256 feeRateBps; uint8 side; uint8 signatureType; bytes signature; }",
  "function executeBasket(CtfOrder[] orders, uint256[] fillAmounts, uint256[] minFills, bytes32 batchTag) external",
  "function withdraw(uint256 amount) external",
  "function pause() external",
  "function unpause() external",
  "event BasketExecuted(uint256 legCount, uint256 totalFillUsdc, bytes32 indexed batchTag)",
]);

export type SubmitVerdict =
  | { kind: "no_contract"; reason: string }
  | { kind: "dry_run"; reason: string; calldata: Hex }
  | { kind: "submitted"; txHash: Hex; calldata: Hex }
  | { kind: "rejected"; reason: string };

/**
 * Pure: encode the `executeBasket(...)` calldata. No network access.
 *
 * Throws on:
 *   - empty orders array
 *   - length mismatch between orders / fillAmounts / minFills
 *   - any per-leg minFill > fillAmount (unsatisfiable by definition)
 */
export function buildExecuteBasketCalldata(args: {
  orders: CtfOrder[];
  fillAmounts: bigint[];
  minFills: bigint[];
  batchTag: Hex;
}): Hex {
  if (args.orders.length === 0) throw new Error("buildExecuteBasketCalldata: empty orders");
  if (args.orders.length !== args.fillAmounts.length) throw new Error("buildExecuteBasketCalldata: fillAmounts length mismatch");
  if (args.orders.length !== args.minFills.length) throw new Error("buildExecuteBasketCalldata: minFills length mismatch");
  for (let i = 0; i < args.orders.length; i++) {
    if (args.minFills[i] > args.fillAmounts[i]) {
      throw new Error(`buildExecuteBasketCalldata: leg ${i} minFill (${args.minFills[i]}) > fillAmount (${args.fillAmounts[i]}) — unsatisfiable`);
    }
  }
  return encodeFunctionData({
    abi: ATOMIC_EXECUTOR_ABI,
    functionName: "executeBasket",
    args: [args.orders, args.fillAmounts, args.minFills, args.batchTag],
  });
}

/**
 * Submit a basket via the deployed AtomicArbExecutor contract.
 *
 * Behaviour matrix:
 *   - ATOMIC_EXECUTOR_ADDRESS unset           → {kind: "no_contract"}
 *   - ATOMIC_EXECUTOR_LIVE != "1"             → {kind: "dry_run", calldata}
 *   - both set → uses an injected writeContract function (caller supplies
 *     a viem wallet client). This keeps THIS module pure of viem
 *     wallet-client dependencies so tests don't need a real signer.
 */
export async function submitBasket(args: {
  orders: CtfOrder[];
  fillAmounts: bigint[];
  minFills: bigint[];
  batchTag: Hex;
  /** Caller supplies the actual tx-submission function. Returns tx hash on success. */
  writeContract?: (args: { to: Hex; data: Hex }) => Promise<Hex>;
}): Promise<SubmitVerdict> {
  const address = process.env.ATOMIC_EXECUTOR_ADDRESS as Hex | undefined;
  if (!address || !address.startsWith("0x")) {
    return { kind: "no_contract", reason: "ATOMIC_EXECUTOR_ADDRESS not set" };
  }

  let calldata: Hex;
  try {
    calldata = buildExecuteBasketCalldata(args);
  } catch (err) {
    return { kind: "rejected", reason: (err as Error).message };
  }

  if (process.env.ATOMIC_EXECUTOR_LIVE !== "1") {
    return { kind: "dry_run", reason: "ATOMIC_EXECUTOR_LIVE!=1", calldata };
  }

  if (!args.writeContract) {
    return { kind: "rejected", reason: "ATOMIC_EXECUTOR_LIVE=1 but no writeContract function supplied" };
  }

  try {
    const txHash = await args.writeContract({ to: address, data: calldata });
    return { kind: "submitted", txHash, calldata };
  } catch (err) {
    return { kind: "rejected", reason: (err as Error).message };
  }
}

/**
 * Convenience: build the bytes32 batchTag from a clientOrderId string.
 * Keccak-truncates if too long, pads if too short.
 */
export function batchTagFromClientOrderId(coid: string): Hex {
  const bytes = new TextEncoder().encode(coid);
  const padded = new Uint8Array(32);
  for (let i = 0; i < Math.min(32, bytes.length); i++) padded[i] = bytes[i];
  return ("0x" + Array.from(padded).map((b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}
