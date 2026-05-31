/**
 * Unit tests for src/lib/scanners/updown-discovery.ts — the pure helpers
 * that compute Polymarket slug → window-time mappings. The networked
 * `scanAndUpsertUpdownWindows` is exercised by integration tests; this
 * file pins the pure logic.
 */
import { describe, expect, it } from "vitest";

import {
  recurrenceStepSec,
  recurrenceToDurationKind,
  alignToWindow,
  computeUpdownSlug,
  planUpdownWindows,
  parseReferencePrice,
  type Recurrence,
} from "@/lib/scanners/updown-discovery";

// ---------------------------------------------------------------------------
// recurrenceStepSec

describe("recurrenceStepSec", () => {
  it("5m → 300 s", () => expect(recurrenceStepSec("5m")).toBe(300));
  it("15m → 900 s", () => expect(recurrenceStepSec("15m")).toBe(900));
  it("1h → 3600 s", () => expect(recurrenceStepSec("1h")).toBe(3600));
  it("4h → 14400 s", () => expect(recurrenceStepSec("4h")).toBe(14400));
});

// ---------------------------------------------------------------------------
// recurrenceToDurationKind

describe("recurrenceToDurationKind", () => {
  // Matches the duration_kind format the existing event-timing helpers
  // already parse: "5M" / "15M" / "1H" / "4H".
  it("maps short tags to duration_kind strings", () => {
    expect(recurrenceToDurationKind("5m")).toBe("5M");
    expect(recurrenceToDurationKind("15m")).toBe("15M");
    expect(recurrenceToDurationKind("1h")).toBe("1H");
    expect(recurrenceToDurationKind("4h")).toBe("4H");
  });
});

// ---------------------------------------------------------------------------
// alignToWindow

describe("alignToWindow", () => {
  it("floors to the previous 5-min boundary", () => {
    // 2026-05-30 22:03:17 UTC = 1748653397.
    // Previous 5-min boundary = 22:00:00 = 1748653200.
    expect(alignToWindow(1748653397, "5m")).toBe(1748653200);
  });

  it("returns the same timestamp when already on a boundary", () => {
    expect(alignToWindow(1748653200, "5m")).toBe(1748653200);
    expect(alignToWindow(1748653200, "15m")).toBe(1748653200);  // also a 15m boundary
  });

  it("floors 15m windows correctly", () => {
    // 22:07:30 → previous 15m boundary = 22:00:00.
    expect(alignToWindow(1748653650, "15m")).toBe(1748653200);
  });
});

// ---------------------------------------------------------------------------
// computeUpdownSlug

describe("computeUpdownSlug", () => {
  it("builds the expected Polymarket slug format", () => {
    expect(computeUpdownSlug("BTC", "5m", 1748653200)).toBe(
      "btc-updown-5m-1748653200",
    );
    expect(computeUpdownSlug("ETH", "15m", 1748653200)).toBe(
      "eth-updown-15m-1748653200",
    );
  });

  it("lowercases the asset", () => {
    expect(computeUpdownSlug("SOL" as never, "5m", 0)).toBe("sol-updown-5m-0");
  });
});

// ---------------------------------------------------------------------------
// planUpdownWindows

describe("planUpdownWindows", () => {
  it("default fetches lookback=1 + current + lookahead=3 = 5 per (asset, recurrence)", () => {
    const plans = planUpdownWindows({
      assets: ["BTC"],
      recurrences: ["5m"],
      nowSec: 1748653200,
    });
    expect(plans).toHaveLength(5);
    // Sorted by k = -1, 0, 1, 2, 3
    expect(plans[0].startTs).toBe(1748653200 - 300);
    expect(plans[1].startTs).toBe(1748653200);
    expect(plans[2].startTs).toBe(1748653200 + 300);
    expect(plans[3].startTs).toBe(1748653200 + 600);
    expect(plans[4].startTs).toBe(1748653200 + 900);
  });

  it("respects custom lookahead / lookback", () => {
    const plans = planUpdownWindows({
      assets: ["BTC"],
      recurrences: ["5m"],
      nowSec: 1748653200,
      lookahead: 0,
      lookback: 0,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].startTs).toBe(1748653200);
  });

  it("scales across multiple assets × recurrences", () => {
    const plans = planUpdownWindows({
      assets: ["BTC", "ETH", "SOL"],
      recurrences: ["5m", "15m"],
      nowSec: 1748653200,
      lookahead: 2,
      lookback: 1,
    });
    // 3 assets × 2 recurrences × 4 windows (lookback + 0 + 2) = 24
    expect(plans).toHaveLength(3 * 2 * 4);
  });

  it("sets endTs = startTs + step", () => {
    const plans = planUpdownWindows({
      assets: ["BTC"],
      recurrences: ["5m"],
      nowSec: 1748653200,
      lookahead: 0,
      lookback: 0,
    });
    expect(plans[0].endTs - plans[0].startTs).toBe(300);
  });

  it("attaches the canonical slug to each plan", () => {
    const plans = planUpdownWindows({
      assets: ["BTC"],
      recurrences: ["15m"],
      nowSec: 1748653200,
      lookahead: 0,
      lookback: 0,
    });
    expect(plans[0].slug).toBe("btc-updown-15m-1748653200");
  });
});

// ---------------------------------------------------------------------------
// parseReferencePrice

describe("parseReferencePrice", () => {
  it("extracts a comma-formatted $ price", () => {
    expect(parseReferencePrice("Will BTC be above $108,500 at 22:05 UTC?")).toBe(108500);
  });

  it("extracts a plain $ price without commas", () => {
    expect(parseReferencePrice("Will ETH close above $3500?")).toBe(3500);
  });

  it("handles decimal prices", () => {
    expect(parseReferencePrice("Will SOL close above $145.75?")).toBe(145.75);
  });

  it("returns undefined when no $ price is present", () => {
    expect(parseReferencePrice("Will BTC go up in the next 5 minutes?")).toBeUndefined();
    expect(parseReferencePrice("")).toBeUndefined();
  });

  it("returns the FIRST $ price when multiple are present", () => {
    // (e.g., "between $100,000 and $108,000" — pick the lower bound)
    expect(parseReferencePrice("BTC between $100,000 and $108,000")).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// Type-level sanity: Recurrence enum is exhaustive

describe("Recurrence type", () => {
  it("recurrenceStepSec covers every Recurrence variant", () => {
    const recs: Recurrence[] = ["5m", "15m", "1h", "4h"];
    for (const r of recs) {
      expect(recurrenceStepSec(r)).toBeGreaterThan(0);
      expect(recurrenceToDurationKind(r)).toMatch(/^[0-9]+[MH]$/);
    }
  });
});
