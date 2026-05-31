import { describe, expect, it } from "vitest";
import { checkMakerOnly } from "@core/venue/maker-only-gate";
import type { UnifiedOrder } from "@core/venue/types";

function order(overrides: Partial<UnifiedOrder> = {}): UnifiedOrder {
  return {
    clientOrderId: "test-coid",
    venue: "sim",
    symbol: "TOKEN-123",
    side: "BUY",
    type: "LIMIT",
    size: 10,
    refPrice: 0.5,
    ...overrides,
  };
}

describe("checkMakerOnly", () => {
  it("allows LIMIT orders unconditionally", () => {
    expect(checkMakerOnly(order({ type: "LIMIT" })).ok).toBe(true);
  });

  it("allows FOK_BASKET orders (multi-leg arb is intentionally a cross)", () => {
    expect(checkMakerOnly(order({ type: "FOK_BASKET" })).ok).toBe(true);
  });

  it("blocks MARKET orders by default", () => {
    const v = checkMakerOnly(order({ type: "MARKET" }), { envAllowTaker: undefined });
    expect(v.ok).toBe(false);
    if (v.ok === false) {
      expect(v.code).toBe("TAKER_BLOCKED");
      expect(v.reason).toContain("MARKET orders are blocked");
      expect(v.reason).toContain("Becker maker-rebate");
    }
  });

  it("allows MARKET when order.metadata.allowTaker === true", () => {
    const v = checkMakerOnly(
      order({ type: "MARKET", metadata: { allowTaker: true } }),
      { envAllowTaker: undefined },
    );
    expect(v.ok).toBe(true);
  });

  it("ignores allowTaker=false (does NOT allow taker — explicit false stays blocked)", () => {
    const v = checkMakerOnly(
      order({ type: "MARKET", metadata: { allowTaker: false } }),
      { envAllowTaker: undefined },
    );
    expect(v.ok).toBe(false);
  });

  it("allows MARKET when ROUTER_ALLOW_TAKER=1 in env", () => {
    const v = checkMakerOnly(order({ type: "MARKET" }), { envAllowTaker: "1" });
    expect(v.ok).toBe(true);
  });

  it("still blocks when env is '0' or 'true' or anything not exactly '1'", () => {
    for (const bad of ["0", "true", "yes", "", undefined]) {
      const v = checkMakerOnly(order({ type: "MARKET" }), { envAllowTaker: bad as string | undefined });
      expect(v.ok).toBe(false);
    }
  });

  it("does not require metadata to exist (handles undefined metadata cleanly)", () => {
    const v = checkMakerOnly(order({ type: "MARKET", metadata: undefined }), { envAllowTaker: undefined });
    expect(v.ok).toBe(false);
  });
});
