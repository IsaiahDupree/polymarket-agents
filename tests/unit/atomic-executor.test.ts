import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildExecuteBasketCalldata,
  submitBasket,
  batchTagFromClientOrderId,
  type CtfOrder,
} from "@/lib/arb/atomic-executor";
import type { Hex } from "viem";

function order(overrides: Partial<CtfOrder> = {}): CtfOrder {
  return {
    salt: 1n,
    maker: "0x1111111111111111111111111111111111111111",
    signer: "0x1111111111111111111111111111111111111111",
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: 0xabcn,
    makerAmount: 100n,
    takerAmount: 30n,
    expiration: 9999999999n,
    nonce: 1n,
    feeRateBps: 100n,
    side: 0,
    signatureType: 1,
    signature: "0x" as Hex,
    ...overrides,
  };
}

const tag = batchTagFromClientOrderId("test-batch-1");

describe("buildExecuteBasketCalldata", () => {
  it("encodes a single-leg basket without error", () => {
    const data = buildExecuteBasketCalldata({
      orders: [order()],
      fillAmounts: [30n],
      minFills: [29n],
      batchTag: tag,
    });
    expect(data).toMatch(/^0x[0-9a-f]+$/);
    expect(data.length).toBeGreaterThan(10);
  });

  it("encodes a two-leg basket (the article's BUY-YES + BUY-NO arb case)", () => {
    const yesOrd = order({ tokenId: 100n, makerAmount: 100n, takerAmount: 30n });
    const noOrd = order({ tokenId: 200n, makerAmount: 100n, takerAmount: 30n, salt: 2n });
    const data = buildExecuteBasketCalldata({
      orders: [yesOrd, noOrd],
      fillAmounts: [30n, 30n],
      minFills: [29n, 29n],
      batchTag: tag,
    });
    expect(data).toMatch(/^0x[0-9a-f]+$/);
  });

  it("throws on empty orders array", () => {
    expect(() =>
      buildExecuteBasketCalldata({ orders: [], fillAmounts: [], minFills: [], batchTag: tag }),
    ).toThrow(/empty orders/);
  });

  it("throws on fillAmounts length mismatch", () => {
    expect(() =>
      buildExecuteBasketCalldata({
        orders: [order(), order({ salt: 2n })],
        fillAmounts: [30n],
        minFills: [29n, 29n],
        batchTag: tag,
      }),
    ).toThrow(/fillAmounts length mismatch/);
  });

  it("throws when any minFill exceeds its fillAmount (unsatisfiable)", () => {
    expect(() =>
      buildExecuteBasketCalldata({
        orders: [order()],
        fillAmounts: [10n],
        minFills: [20n],
        batchTag: tag,
      }),
    ).toThrow(/unsatisfiable/);
  });
});

describe("submitBasket — env-gated routing", () => {
  const origAddr = process.env.ATOMIC_EXECUTOR_ADDRESS;
  const origLive = process.env.ATOMIC_EXECUTOR_LIVE;

  beforeEach(() => {
    delete process.env.ATOMIC_EXECUTOR_ADDRESS;
    delete process.env.ATOMIC_EXECUTOR_LIVE;
  });

  afterEach(() => {
    if (origAddr) process.env.ATOMIC_EXECUTOR_ADDRESS = origAddr; else delete process.env.ATOMIC_EXECUTOR_ADDRESS;
    if (origLive) process.env.ATOMIC_EXECUTOR_LIVE = origLive; else delete process.env.ATOMIC_EXECUTOR_LIVE;
  });

  it("returns no_contract when ATOMIC_EXECUTOR_ADDRESS is unset", async () => {
    const r = await submitBasket({
      orders: [order()],
      fillAmounts: [30n],
      minFills: [29n],
      batchTag: tag,
    });
    expect(r.kind).toBe("no_contract");
  });

  it("returns dry_run when address is set but LIVE!=1", async () => {
    process.env.ATOMIC_EXECUTOR_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const r = await submitBasket({
      orders: [order()],
      fillAmounts: [30n],
      minFills: [29n],
      batchTag: tag,
    });
    expect(r.kind).toBe("dry_run");
    if (r.kind === "dry_run") {
      expect(r.calldata).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it("returns rejected when LIVE=1 but no writeContract is supplied", async () => {
    process.env.ATOMIC_EXECUTOR_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env.ATOMIC_EXECUTOR_LIVE = "1";
    const r = await submitBasket({
      orders: [order()],
      fillAmounts: [30n],
      minFills: [29n],
      batchTag: tag,
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toContain("no writeContract");
  });

  it("returns submitted with tx hash when LIVE=1 and writeContract succeeds", async () => {
    process.env.ATOMIC_EXECUTOR_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    process.env.ATOMIC_EXECUTOR_LIVE = "1";
    const mockWrite = async () => ("0xabc123" as Hex);
    const r = await submitBasket({
      orders: [order()],
      fillAmounts: [30n],
      minFills: [29n],
      batchTag: tag,
      writeContract: mockWrite,
    });
    expect(r.kind).toBe("submitted");
    if (r.kind === "submitted") {
      expect(r.txHash).toBe("0xabc123");
      expect(r.calldata).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it("returns rejected when calldata-builder throws (e.g. unsatisfiable minFill)", async () => {
    process.env.ATOMIC_EXECUTOR_ADDRESS = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const r = await submitBasket({
      orders: [order()],
      fillAmounts: [10n],
      minFills: [20n],
      batchTag: tag,
    });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toContain("unsatisfiable");
  });
});

describe("batchTagFromClientOrderId", () => {
  it("produces a 32-byte hex string", () => {
    const t = batchTagFromClientOrderId("short");
    expect(t).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("pads short ids and truncates long ones", () => {
    const short = batchTagFromClientOrderId("a");
    const long = batchTagFromClientOrderId("a".repeat(64));
    expect(short.length).toBe(66);
    expect(long.length).toBe(66);
  });
});
