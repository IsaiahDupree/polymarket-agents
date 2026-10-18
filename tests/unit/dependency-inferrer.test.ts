import { describe, expect, it } from "vitest";
import {
  inferDependency,
  dependencyInfererAvailable,
} from "@/lib/agents/dependency-inferrer";

describe("dependencyInfererAvailable", () => {
  it("returns a boolean", () => {
    expect(typeof dependencyInfererAvailable()).toBe("boolean");
  });
});

describe("inferDependency", () => {
  it("returns null when auth unavailable, or a verdict when live (host-env dependent)", async () => {
    const a = {
      id: "cond-trump-pa",
      question: "Will Trump win Pennsylvania?",
      yesId: "tok-trump-yes",
      noId: "tok-trump-no",
    };
    const b = {
      id: "cond-rep5-pa",
      question: "Will Republicans win PA by 5+ points?",
      yesId: "tok-rep5-yes",
      noId: "tok-rep5-no",
    };
    if (!dependencyInfererAvailable()) {
      const r = await inferDependency(a, b);
      expect(r).toBeNull();
    } else if (process.env.RUN_LIVE_LLM_TESTS === "1") {
      const r = await inferDependency(a, b);
      expect(r).not.toBeNull();
      if (r) {
        expect(["independent", "implies", "mutually_exclusive", "uncertain"]).toContain(r.relation);
        expect(["high", "medium", "low"]).toContain(r.confidence);
        for (const c of r.constraints) {
          // All ids in any constraint must reference one of the inputs.
          for (const id of [...c.ifTrue, ...c.thenTrue]) {
            expect([a.yesId, a.noId, b.yesId, b.noId]).toContain(id);
          }
        }
      }
    } else {
      // Default test path with auth available but no opt-in to burn tokens:
      // just confirm the function returns a Promise.
      const p = inferDependency(a, b);
      expect(p).toBeInstanceOf(Promise);
    }
  });
});
