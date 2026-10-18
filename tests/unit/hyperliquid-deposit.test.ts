import { describe, expect, it } from "vitest";
import {
  HYPERLIQUID_DEPOSIT,
  buildEip681Uri,
  buildAddressOnlyUri,
  buildDepositPreview,
} from "@/lib/deposits/hyperliquid";

describe("HYPERLIQUID_DEPOSIT — constants", () => {
  it("uses the bridge address from the user's Hyperliquid deposit screen", () => {
    expect(HYPERLIQUID_DEPOSIT.bridgeAddress).toBe("0x840Ba478a11d3631c01d1a9fb4f708b71C3dE121");
  });

  it("uses native USDC on Arbitrum (NOT USDC.e)", () => {
    expect(HYPERLIQUID_DEPOSIT.token.address).toBe("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
    expect(HYPERLIQUID_DEPOSIT.rejected.usdcDotE).toBe("0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8");
    expect(HYPERLIQUID_DEPOSIT.token.address).not.toBe(HYPERLIQUID_DEPOSIT.rejected.usdcDotE);
  });

  it("uses Arbitrum One chain id (42161)", () => {
    expect(HYPERLIQUID_DEPOSIT.chainId).toBe(42161);
    expect(HYPERLIQUID_DEPOSIT.chainName).toBe("Arbitrum One");
  });

  it("enforces the 5 USDC minimum", () => {
    expect(HYPERLIQUID_DEPOSIT.minDepositUsdc).toBe(5);
  });

  it("is frozen so callers can't mutate it in flight", () => {
    expect(Object.isFrozen(HYPERLIQUID_DEPOSIT)).toBe(true);
    expect(Object.isFrozen(HYPERLIQUID_DEPOSIT.token)).toBe(true);
  });
});

describe("buildAddressOnlyUri", () => {
  it("emits ethereum:<addr>@42161", () => {
    expect(buildAddressOnlyUri()).toBe(
      "ethereum:0x840Ba478a11d3631c01d1a9fb4f708b71C3dE121@42161",
    );
  });
});

describe("buildEip681Uri — without amount", () => {
  it("includes the token address and chain id but only the recipient address", () => {
    const uri = buildEip681Uri();
    expect(uri).toBe(
      "ethereum:0xaf88d065e77c8cC2239327C5EDb3A432268e5831@42161/transfer?address=0x840Ba478a11d3631c01d1a9fb4f708b71C3dE121",
    );
    expect(uri).not.toContain("uint256=");
  });
});

describe("buildEip681Uri — with amount", () => {
  it("encodes 5 USDC as 5_000_000 atomic units (6 decimals)", () => {
    const uri = buildEip681Uri(5);
    expect(uri).toContain("uint256=5000000");
  });

  it("encodes 20.5 USDC as 20_500_000", () => {
    const uri = buildEip681Uri(20.5);
    expect(uri).toContain("uint256=20500000");
  });

  it("encodes 1234.567890 USDC correctly", () => {
    const uri = buildEip681Uri(1234.56789);
    // floor((1234.56789 * 10^6) — anything beyond 6 decimals is truncated.
    expect(uri).toContain("uint256=1234567890");
  });

  it("throws when amount is below the 5 USDC minimum", () => {
    expect(() => buildEip681Uri(4.99)).toThrow(/below Hyperliquid's 5 USDC minimum/);
    expect(() => buildEip681Uri(0)).toThrow(/below/);
  });

  it("throws on non-finite amount (NaN, Infinity)", () => {
    expect(() => buildEip681Uri(Number.NaN)).toThrow(/finite number/);
    expect(() => buildEip681Uri(Number.POSITIVE_INFINITY)).toThrow(/finite number/);
  });

  it("accepts exactly the 5 USDC minimum", () => {
    expect(() => buildEip681Uri(5)).not.toThrow();
  });
});

describe("buildDepositPreview — UI-facing summary", () => {
  it("returns both URIs + verified constants when no amount given", () => {
    const p = buildDepositPreview();
    expect(p.amountUsdc).toBeNull();
    expect(p.recipient).toBe("0x840Ba478a11d3631c01d1a9fb4f708b71C3dE121");
    expect(p.network).toBe("Arbitrum One");
    expect(p.chainId).toBe(42161);
    expect(p.token.symbol).toBe("USDC");
    expect(p.token.decimals).toBe(6);
    expect(p.minDepositUsdc).toBe(5);
    expect(p.eip681).toContain("/transfer?address=");
    expect(p.addressOnly).toBe("ethereum:0x840Ba478a11d3631c01d1a9fb4f708b71C3dE121@42161");
  });

  it("threads the amount through when valid", () => {
    const p = buildDepositPreview(25);
    expect(p.amountUsdc).toBe(25);
    expect(p.eip681).toContain("uint256=25000000");
  });

  it("rejects amounts below the minimum at preview level too", () => {
    expect(() => buildDepositPreview(1)).toThrow(/below Hyperliquid's 5 USDC minimum/);
  });
});
