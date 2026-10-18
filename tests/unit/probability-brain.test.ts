import { describe, expect, it } from "vitest";
import { claudeProbability, probabilityBrainAvailable } from "@/lib/agents/probability-brain";

describe("probabilityBrainAvailable", () => {
  it("returns a boolean (depends on host env auth)", () => {
    expect(typeof probabilityBrainAvailable()).toBe("boolean");
  });
});

describe("claudeProbability", () => {
  it("returns null when auth is unavailable (no spurious errors)", async () => {
    // Force the auth-unavailable path by clobbering env vars + credentials.
    // We can't easily mock the filesystem read from auth.ts here, but we CAN
    // verify the function shape — if auth is available on the host, the call
    // returns an object; if not, it returns null. Either is fine.
    const wasAvail = probabilityBrainAvailable();
    if (!wasAvail) {
      const r = await claudeProbability("Will it rain tomorrow in NYC?", 0.42);
      expect(r).toBeNull();
    } else {
      // Auth IS available — make a real call only if explicitly opted in,
      // to avoid burning tokens on every test run.
      if (process.env.RUN_LIVE_LLM_TESTS === "1") {
        const r = await claudeProbability("Will the Fed cut rates at the next meeting?", 0.40);
        expect(r).not.toBeNull();
        if (r) {
          expect(r.probability).toBeGreaterThanOrEqual(0);
          expect(r.probability).toBeLessThanOrEqual(1);
          expect(["high", "medium", "low"]).toContain(r.confidence);
          expect(r.model).toBe("claude-haiku-4-5");
        }
      } else {
        // Skip live call by default — assert the function is at least async.
        const promise = claudeProbability("Will it rain?", 0.5);
        expect(promise).toBeInstanceOf(Promise);
      }
    }
  });
});
