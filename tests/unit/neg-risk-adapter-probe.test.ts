import { describe, expect, it } from "vitest";
import { probeNegRiskAdapter, formatReport } from "@/lib/arb/neg-risk-adapter-probe";

/**
 * Mock viem client. Bytecode contains some of the candidate function
 * selectors but not all — exercises every recommendation branch.
 */
function mockClient(bytecode: string) {
  return {
    async getBytecode({ address }: { address: string }) {
      void address;
      return bytecode;
    },
  } as any;
}

describe("probeNegRiskAdapter", () => {
  it("inspection_failed when bytecode is empty (proxy / wrong address)", async () => {
    const r = await probeNegRiskAdapter({ injectedClient: mockClient("0x") });
    expect(r.recommendation).toBe("inspection_failed");
    expect(r.rationale).toContain("Empty bytecode");
  });

  it("inspection_failed when RPC throws", async () => {
    const r = await probeNegRiskAdapter({
      injectedClient: {
        async getBytecode() {
          throw new Error("rpc dead");
        },
      } as any,
    });
    expect(r.recommendation).toBe("inspection_failed");
    expect(r.rationale).toContain("RPC error");
  });

  it("path_b_dead when no candidate selectors are present", async () => {
    // Bytecode with random hex that doesn't contain any of our candidate selectors.
    const r = await probeNegRiskAdapter({
      injectedClient: mockClient("0xdeadbeefcafe1234"),
    });
    expect(r.recommendation).toBe("path_b_dead");
    expect(r.rationale).toContain("Required functions missing");
  });

  it("path_b_partial_via_split when splitPosition + mergePositions selectors are present", async () => {
    // Inline the two known-Gnosis-CTF selectors anywhere in the bytecode.
    const bytecode = "0xff63" + "4ce2f8a8" + "01ff63" + "fc6e6df0" + "ee";
    const r = await probeNegRiskAdapter({ injectedClient: mockClient(bytecode) });
    expect(r.recommendation).toBe("path_b_partial_via_split");
    expect(r.presentFunctions).toContain("splitPosition");
    expect(r.presentFunctions).toContain("mergePositions");
  });

  it("path_b_viable_full when a native executeBasket selector is present", async () => {
    const bytecode = "0xff63" + "4ce2f8a8" + "63" + "fc6e6df0" + "63" + "0000000d" + "ee";
    const r = await probeNegRiskAdapter({ injectedClient: mockClient(bytecode) });
    expect(r.recommendation).toBe("path_b_viable_full");
    expect(r.presentFunctions).toContain("executeBasket");
  });
});

describe("formatReport — readable output", () => {
  it("formats a path_b_dead report", () => {
    const out = formatReport({
      contractAddress: "0xe2222d279d744050d28e00520010520000310F59",
      presentFunctions: [],
      missingFunctions: ["splitPosition", "mergePositions"],
      recommendation: "path_b_dead",
      rationale: "test",
    });
    expect(out).toContain("recommendation=path_b_dead");
    expect(out).toContain("(none)");
    expect(out).toContain("missing: splitPosition, mergePositions");
  });
});
