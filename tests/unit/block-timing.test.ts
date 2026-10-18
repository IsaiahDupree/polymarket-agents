import { describe, expect, it } from "vitest";
import {
  summarizeBlockTiming,
  blockTimingVerdict,
  fetchLegBlockInfo,
  type LegBlockInfo,
} from "@/lib/arb/block-timing";

describe("summarizeBlockTiming — pure analysis", () => {
  it("returns zeros + sameBlock=false on empty input", () => {
    const s = summarizeBlockTiming([]);
    expect(s.sameBlock).toBe(false);
    expect(s.legCount).toBe(0);
    expect(s.maxSpreadBlocks).toBe(0);
  });

  it("single leg → sameBlock=true (trivially)", () => {
    const s = summarizeBlockTiming([
      { label: "YES", txHash: "0xaa", blockNumber: 1000, blockTimestamp: 1700_000_000 },
    ]);
    expect(s.sameBlock).toBe(true);
    expect(s.legCount).toBe(1);
    expect(s.maxSpreadBlocks).toBe(0);
    expect(s.maxSpreadSeconds).toBe(0);
  });

  it("two legs in the same block → sameBlock=true", () => {
    const s = summarizeBlockTiming([
      { label: "YES", txHash: "0xaa", blockNumber: 1000, blockTimestamp: 1700_000_000 },
      { label: "NO",  txHash: "0xbb", blockNumber: 1000, blockTimestamp: 1700_000_000 },
    ]);
    expect(s.sameBlock).toBe(true);
    expect(s.maxSpreadBlocks).toBe(0);
    expect(s.maxSpreadSeconds).toBe(0);
  });

  it("two legs split across 1 block → sameBlock=false", () => {
    const s = summarizeBlockTiming([
      { label: "YES", txHash: "0xaa", blockNumber: 1000, blockTimestamp: 1700_000_000 },
      { label: "NO",  txHash: "0xbb", blockNumber: 1001, blockTimestamp: 1700_000_002 },
    ]);
    expect(s.sameBlock).toBe(false);
    expect(s.maxSpreadBlocks).toBe(1);
    expect(s.maxSpreadSeconds).toBe(2);
    expect(s.minBlockNumber).toBe(1000);
    expect(s.maxBlockNumber).toBe(1001);
  });

  it("three legs split across 5 blocks", () => {
    const s = summarizeBlockTiming([
      { label: "A", txHash: "0xa", blockNumber: 1000, blockTimestamp: 1700_000_000 },
      { label: "B", txHash: "0xb", blockNumber: 1003, blockTimestamp: 1700_000_006 },
      { label: "C", txHash: "0xc", blockNumber: 1005, blockTimestamp: 1700_000_010 },
    ]);
    expect(s.sameBlock).toBe(false);
    expect(s.maxSpreadBlocks).toBe(5);
    expect(s.maxSpreadSeconds).toBe(10);
    expect(s.legs.map((l) => l.label)).toEqual(["A", "B", "C"]); // sorted ascending
  });

  it("falls back to maxSpreadBlocks × 2.1 when block timestamps missing", () => {
    const s = summarizeBlockTiming([
      { label: "X", txHash: "0xx", blockNumber: 100 },
      { label: "Y", txHash: "0xy", blockNumber: 102 },
    ]);
    expect(s.maxSpreadBlocks).toBe(2);
    expect(s.maxSpreadSeconds).toBeCloseTo(4.2, 3);
  });
});

describe("blockTimingVerdict — human-readable summary", () => {
  it("empty → 'no legs to time'", () => {
    expect(blockTimingVerdict(summarizeBlockTiming([]))).toBe("no legs to time");
  });
  it("single → 'single leg'", () => {
    const s = summarizeBlockTiming([{ label: "A", txHash: "0xa", blockNumber: 1 }]);
    expect(blockTimingVerdict(s)).toContain("single leg");
  });
  it("same-block → 'atomic'", () => {
    const s = summarizeBlockTiming([
      { label: "A", txHash: "0xa", blockNumber: 100, blockTimestamp: 1000 },
      { label: "B", txHash: "0xb", blockNumber: 100, blockTimestamp: 1000 },
    ]);
    expect(blockTimingVerdict(s)).toContain("atomic");
  });
  it("split → 'split: N blocks'", () => {
    const s = summarizeBlockTiming([
      { label: "A", txHash: "0xa", blockNumber: 100, blockTimestamp: 1000 },
      { label: "B", txHash: "0xb", blockNumber: 105, blockTimestamp: 1010 },
    ]);
    const v = blockTimingVerdict(s);
    expect(v).toContain("split");
    expect(v).toContain("6 blocks"); // maxSpreadBlocks=5 → printed as "6 blocks" (inclusive range)
    expect(v).toContain("10.0s");
  });
});

describe("fetchLegBlockInfo — uses an injected RPC client", () => {
  it("returns block info for each leg, dropping legs whose receipt isn't found", async () => {
    const calls: string[] = [];
    const mockClient = {
      async getTransactionReceipt({ hash }: { hash: `0x${string}` }) {
        calls.push(`receipt:${hash}`);
        if (hash === "0xnotfound") return null;
        return { blockNumber: hash === "0xaaa" ? 1000n : 1001n };
      },
      async getBlock({ blockNumber }: { blockNumber: bigint }) {
        calls.push(`block:${blockNumber}`);
        return { timestamp: 1700_000_000n + blockNumber * 2n };
      },
    };
    const out = await fetchLegBlockInfo(
      [
        { label: "A", txHash: "0xaaa" },
        { label: "MISS", txHash: "0xnotfound" },
        { label: "B", txHash: "0xbbb" },
      ],
      mockClient,
    );
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe("A");
    expect(out[0].blockNumber).toBe(1000);
    expect(out[1].label).toBe("B");
    expect(out[1].blockNumber).toBe(1001);
    expect(calls).toContain("receipt:0xnotfound");
  });

  it("ignores legs without 0x-prefix tx hash", async () => {
    const mockClient = {
      async getTransactionReceipt() {
        throw new Error("should not be called");
      },
      async getBlock() {
        throw new Error("should not be called");
      },
    };
    const out = await fetchLegBlockInfo(
      [
        { label: "BAD", txHash: "" },
        { label: "ALSO_BAD", txHash: "not-a-hash" },
      ],
      mockClient,
    );
    expect(out).toEqual([]);
  });
});
