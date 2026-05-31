/**
 * Unit tests for src/lib/arena/event-timing.ts — the pure helpers that
 * port the HFT latency/event-phase framework into the arena.
 */
import { describe, expect, it } from "vitest";

import {
  parseDurationMin,
  minToResolution,
  eventPhase,
  coinbaseTickAgeSec,
  matchesPhase,
  type EventPhase,
} from "@/lib/arena/event-timing";

// ---------------------------------------------------------------------------
// parseDurationMin

describe("parseDurationMin", () => {
  it("parses minute tags (5M, 15M, 30M)", () => {
    expect(parseDurationMin("5M")).toBe(5);
    expect(parseDurationMin("15M")).toBe(15);
    expect(parseDurationMin("30M")).toBe(30);
  });
  it("parses hour tags (1H, 4H)", () => {
    expect(parseDurationMin("1H")).toBe(60);
    expect(parseDurationMin("4H")).toBe(240);
  });
  it("is case-insensitive", () => {
    expect(parseDurationMin("5m")).toBe(5);
    expect(parseDurationMin("1h")).toBe(60);
  });
  it("tolerates whitespace", () => {
    expect(parseDurationMin("  5M  ")).toBe(5);
  });
  it("returns null for unknown / invalid", () => {
    expect(parseDurationMin(null)).toBeNull();
    expect(parseDurationMin(undefined)).toBeNull();
    expect(parseDurationMin("")).toBeNull();
    expect(parseDurationMin("5")).toBeNull();
    expect(parseDurationMin("5D")).toBeNull();
    expect(parseDurationMin("-5M")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// minToResolution

describe("minToResolution", () => {
  it("returns positive minutes until expiry", () => {
    const now = "2026-05-30T20:00:00Z";
    const expiry = "2026-05-30T20:05:00Z";
    expect(minToResolution(expiry, now)).toBeCloseTo(5, 6);
  });
  it("returns negative when expiry has passed", () => {
    const now = "2026-05-30T20:10:00Z";
    const expiry = "2026-05-30T20:05:00Z";
    expect(minToResolution(expiry, now)).toBeCloseTo(-5, 6);
  });
  it("returns null for missing / invalid input", () => {
    const now = "2026-05-30T20:00:00Z";
    expect(minToResolution(null, now)).toBeNull();
    expect(minToResolution(undefined, now)).toBeNull();
    expect(minToResolution("not-a-date", now)).toBeNull();
    expect(minToResolution("2026-05-30T20:00:00Z", "not-a-date")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// eventPhase

const cutoffMin = 3;  // standard Polymarket cutoff zone

describe("eventPhase", () => {
  it("'opening' for first quarter of window", () => {
    // 5-min window. Now is 1 min in (20 % elapsed). 4 min to expiry.
    const phase = eventPhase({
      expiryIso: "2026-05-30T20:05:00Z",
      durationMin: 5,
      now: "2026-05-30T20:01:00Z",
      cutoffMin,
    });
    expect(phase).toBe("opening");
  });

  it("'mid-window' for middle half", () => {
    // 5-min window. Now is 2.5 min in (50 % elapsed). 2.5 min to expiry.
    // BUT: 2.5 min < cutoff (3 min) → should classify as post-cutoff.
    // Use a 15-min window so we land cleanly in mid.
    const phase = eventPhase({
      expiryIso: "2026-05-30T20:15:00Z",
      durationMin: 15,
      now: "2026-05-30T20:07:30Z",
      cutoffMin,
    });
    expect(phase).toBe("mid-window");
  });

  it("'late-window' for closing quarter but pre-cutoff", () => {
    // 15-min window, 12 min elapsed (80 % through, > 0.75 threshold),
    // 3 min to expiry — wait, equals cutoff. Use 3.5 min to expiry so
    // minToResolution > cutoff. 11.5 min elapsed = 76.6 % → late-window.
    const phase = eventPhase({
      expiryIso: "2026-05-30T20:15:00Z",
      durationMin: 15,
      now: "2026-05-30T20:11:30Z",
      cutoffMin,
    });
    expect(phase).toBe("late-window");
  });

  it("'post-cutoff' when minToResolution <= cutoff", () => {
    // 5-min window, 3 min elapsed, 2 min to expiry → post-cutoff (2 <= 3).
    const phase = eventPhase({
      expiryIso: "2026-05-30T20:05:00Z",
      durationMin: 5,
      now: "2026-05-30T20:03:00Z",
      cutoffMin,
    });
    expect(phase).toBe("post-cutoff");
  });

  it("'resolved' when expiry has passed", () => {
    const phase = eventPhase({
      expiryIso: "2026-05-30T20:05:00Z",
      durationMin: 5,
      now: "2026-05-30T20:10:00Z",
      cutoffMin,
    });
    expect(phase).toBe("resolved");
  });

  it("'pre-window' when now is before window-open", () => {
    // 5-min window. Now is 6 min BEFORE expiry → minToResolution = 6,
    // elapsed = duration - 6 = -1 < 0 → pre-window.
    const phase = eventPhase({
      expiryIso: "2026-05-30T20:05:00Z",
      durationMin: 5,
      now: "2026-05-30T19:59:00Z",
      cutoffMin,
    });
    expect(phase).toBe("pre-window");
  });

  it("'unknown' when expiry or duration is missing", () => {
    expect(eventPhase({ expiryIso: null, durationMin: 5, now: "2026-05-30T20:00:00Z", cutoffMin })).toBe("unknown");
    // Even with valid expiry, missing duration → can't compute elapsed fraction.
    // But if expiry is past or in cutoff, those branches fire first.
    expect(eventPhase({ expiryIso: "2026-05-30T21:00:00Z", durationMin: null, now: "2026-05-30T20:00:00Z", cutoffMin })).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// coinbaseTickAgeSec

describe("coinbaseTickAgeSec", () => {
  it("returns age in seconds", () => {
    const tickSec = Date.UTC(2026, 4, 30, 20, 0, 0) / 1000;
    const now = "2026-05-30T20:00:30Z";
    expect(coinbaseTickAgeSec(tickSec, now)).toBeCloseTo(30, 5);
  });
  it("returns null for missing inputs", () => {
    expect(coinbaseTickAgeSec(null, "2026-05-30T20:00:00Z")).toBeNull();
    expect(coinbaseTickAgeSec(undefined, "2026-05-30T20:00:00Z")).toBeNull();
    expect(coinbaseTickAgeSec(123, "not-a-date")).toBeNull();
  });
  it("returns negative if tick is in the future (clock skew)", () => {
    const tickSec = Date.UTC(2026, 4, 30, 20, 0, 30) / 1000;
    const now = "2026-05-30T20:00:00Z";
    expect(coinbaseTickAgeSec(tickSec, now)).toBeCloseTo(-30, 5);
  });
});

// ---------------------------------------------------------------------------
// matchesPhase

describe("matchesPhase", () => {
  const tradeable: EventPhase[] = ["opening", "mid-window", "late-window"];
  const blocked:   EventPhase[] = ["pre-window", "post-cutoff", "resolved", "unknown"];

  it("filter='any' admits every phase", () => {
    for (const p of [...tradeable, ...blocked]) {
      expect(matchesPhase(p, "any")).toBe(true);
    }
  });

  it("non-'any' filters always block resolved/post-cutoff/pre-window/unknown", () => {
    for (const filter of ["opening", "mid-window", "late-window", "mid-or-late", "tradeable"] as const) {
      for (const p of blocked) {
        expect(matchesPhase(p, filter)).toBe(false);
      }
    }
  });

  it("single-phase filters only admit that phase", () => {
    expect(matchesPhase("opening", "opening")).toBe(true);
    expect(matchesPhase("mid-window", "opening")).toBe(false);
    expect(matchesPhase("late-window", "opening")).toBe(false);
  });

  it("'mid-or-late' admits mid + late", () => {
    expect(matchesPhase("opening", "mid-or-late")).toBe(false);
    expect(matchesPhase("mid-window", "mid-or-late")).toBe(true);
    expect(matchesPhase("late-window", "mid-or-late")).toBe(true);
  });

  it("'tradeable' admits all three tradeable phases", () => {
    for (const p of tradeable) {
      expect(matchesPhase(p, "tradeable")).toBe(true);
    }
  });
});
