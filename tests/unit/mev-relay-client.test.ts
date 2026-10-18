import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildBundle,
  submitBundle,
  type RawSignedTx,
} from "@/lib/arb/mev-relay-client";

const sampleTxs: RawSignedTx[] = [
  ("0x" + "ab".repeat(100)) as RawSignedTx,
  ("0x" + "cd".repeat(100)) as RawSignedTx,
];

describe("buildBundle — pure", () => {
  it("wraps txs in the JSON-RPC envelope with hex block numbers", () => {
    const b = buildBundle({ txs: sampleTxs, targetBlock: 64_000_000n });
    expect(b.method).toBe("eth_sendBundle");
    expect(b.jsonrpc).toBe("2.0");
    expect(b.params[0].txs).toHaveLength(2);
    expect(b.params[0].blockNumber).toBe("0x3d09000");
    expect(b.params[0].maxBlockNumber).toBe("0x3d09005"); // target + 5
  });

  it("uses explicit maxBlock when provided", () => {
    const b = buildBundle({ txs: sampleTxs, targetBlock: 100n, maxBlock: 200n });
    expect(b.params[0].maxBlockNumber).toBe("0xc8");
  });

  it("threads revertingTxHashes through when provided", () => {
    const b = buildBundle({
      txs: sampleTxs,
      targetBlock: 100n,
      revertingTxHashes: ["0xdeadbeef"],
    });
    expect(b.params[0].revertingTxHashes).toEqual(["0xdeadbeef"]);
  });

  it("throws on empty txs", () => {
    expect(() => buildBundle({ txs: [], targetBlock: 100n })).toThrow(/empty txs/);
  });

  it("throws on invalid raw tx", () => {
    expect(() =>
      buildBundle({ txs: ["not-hex" as RawSignedTx], targetBlock: 100n }),
    ).toThrow(/invalid raw tx/);
  });

  it("throws when maxBlock < targetBlock", () => {
    expect(() => buildBundle({ txs: sampleTxs, targetBlock: 100n, maxBlock: 50n })).toThrow(/maxBlock/);
  });
});

describe("submitBundle — env-gated routing", () => {
  const origUrl = process.env.MEV_RELAY_URL;
  const origLive = process.env.MEV_RELAY_LIVE;

  beforeEach(() => {
    delete process.env.MEV_RELAY_URL;
    delete process.env.MEV_RELAY_LIVE;
  });

  afterEach(() => {
    if (origUrl) process.env.MEV_RELAY_URL = origUrl; else delete process.env.MEV_RELAY_URL;
    if (origLive) process.env.MEV_RELAY_LIVE = origLive; else delete process.env.MEV_RELAY_LIVE;
  });

  it("returns no_relay when MEV_RELAY_URL is unset", async () => {
    const r = await submitBundle({ txs: sampleTxs, targetBlock: 100n });
    expect(r.kind).toBe("no_relay");
  });

  it("returns dry_run when URL is set but LIVE!=1", async () => {
    process.env.MEV_RELAY_URL = "https://relay.example.com/bundle";
    const r = await submitBundle({ txs: sampleTxs, targetBlock: 100n });
    expect(r.kind).toBe("dry_run");
    if (r.kind === "dry_run") {
      expect(r.payload.method).toBe("eth_sendBundle");
    }
  });

  it("returns submitted when LIVE=1 and fetch succeeds", async () => {
    process.env.MEV_RELAY_URL = "https://relay.example.com/bundle";
    process.env.MEV_RELAY_LIVE = "1";
    const fetchImpl = async () =>
      new Response(JSON.stringify({ result: { bundleHash: "0xbundle" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const r = await submitBundle({ txs: sampleTxs, targetBlock: 100n, fetchImpl: fetchImpl as any });
    expect(r.kind).toBe("submitted");
    if (r.kind === "submitted") {
      expect(r.bundleHash).toBe("0xbundle");
    }
  });

  it("returns rejected when relay returns an HTTP error", async () => {
    process.env.MEV_RELAY_URL = "https://relay.example.com/bundle";
    process.env.MEV_RELAY_LIVE = "1";
    const fetchImpl = async () =>
      new Response("upstream borked", { status: 500 });
    const r = await submitBundle({ txs: sampleTxs, targetBlock: 100n, fetchImpl: fetchImpl as any });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toContain("500");
  });

  it("returns rejected when relay returns a JSON-RPC error", async () => {
    process.env.MEV_RELAY_URL = "https://relay.example.com/bundle";
    process.env.MEV_RELAY_LIVE = "1";
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: "bad bundle" } }), { status: 200 });
    const r = await submitBundle({ txs: sampleTxs, targetBlock: 100n, fetchImpl: fetchImpl as any });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toContain("bad bundle");
  });

  it("returns rejected when build throws (empty txs)", async () => {
    process.env.MEV_RELAY_URL = "https://relay.example.com/bundle";
    const r = await submitBundle({ txs: [], targetBlock: 100n });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toContain("empty txs");
  });

  it("returns rejected when fetch throws", async () => {
    process.env.MEV_RELAY_URL = "https://relay.example.com/bundle";
    process.env.MEV_RELAY_LIVE = "1";
    const fetchImpl = async () => {
      throw new Error("network down");
    };
    const r = await submitBundle({ txs: sampleTxs, targetBlock: 100n, fetchImpl: fetchImpl as any });
    expect(r.kind).toBe("rejected");
    if (r.kind === "rejected") expect(r.reason).toContain("network down");
  });
});
