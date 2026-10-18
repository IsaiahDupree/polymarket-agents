/**
 * Unit tests for src/lib/factory/kinds.ts — the multi-kind factory's
 * env parsing + per-kind asset hint + slug generation.
 *
 * The multi-kind factory iterates over every genome kind every cycle.
 * If readTargetKinds drops valid kinds, swallows env overrides, or
 * blesses invalid ones, the factory silently stops covering strategies
 * the user expects to be in the training rotation. These tests pin the
 * behavior.
 */
import { describe, expect, it, vi } from "vitest";

import {
  readTargetKinds,
  assetForKind,
  kindSlug,
  MULTI_FACTORY_SKIP_KINDS,
} from "../../src/lib/factory/kinds";
import { GENOME_KINDS, type GenomeKind } from "../../src/lib/arena/genome";

// ---------------------------------------------------------------------------
// readTargetKinds

describe("readTargetKinds — default behavior", () => {
  it("returns every genome kind except the SKIP set", () => {
    const result = readTargetKinds({});
    const expected = GENOME_KINDS.filter((k) => !MULTI_FACTORY_SKIP_KINDS.has(k));
    expect(result).toEqual(expected);
  });

  it("excludes poly_short_binary_directional (owned by BTC-5m factory)", () => {
    const result = readTargetKinds({});
    expect(result).not.toContain("poly_short_binary_directional");
  });

  it("does not mutate the imported GENOME_KINDS array", () => {
    const before = [...GENOME_KINDS];
    readTargetKinds({});
    expect([...GENOME_KINDS]).toEqual(before);
  });

  it("returns the default when env value is whitespace-only", () => {
    const def = readTargetKinds({});
    expect(readTargetKinds({ FACTORY_MULTI_KINDS: "" })).toEqual(def);
    expect(readTargetKinds({ FACTORY_MULTI_KINDS: "   " })).toEqual(def);
    expect(readTargetKinds({ FACTORY_MULTI_KINDS: "\t\n" })).toEqual(def);
  });
});

describe("readTargetKinds — env override", () => {
  it("returns exactly the kinds listed in FACTORY_MULTI_KINDS", () => {
    const result = readTargetKinds({
      FACTORY_MULTI_KINDS: "cb_breakout,cb_mean_reversion",
    });
    expect(result).toEqual(["cb_breakout", "cb_mean_reversion"]);
  });

  it("trims whitespace around each kind", () => {
    const result = readTargetKinds({
      FACTORY_MULTI_KINDS: "  cb_breakout ,\tcb_mean_reversion\n",
    });
    expect(result).toEqual(["cb_breakout", "cb_mean_reversion"]);
  });

  it("preserves the order specified by the operator", () => {
    // Order matters for `worker-multi-kind-factory.ts` which iterates
    // the list — operators may put fastest-converging kinds first.
    const result = readTargetKinds({
      FACTORY_MULTI_KINDS: "multi_strategy,polymarket_market_maker,cb_breakout",
    });
    expect(result).toEqual([
      "multi_strategy",
      "polymarket_market_maker",
      "cb_breakout",
    ]);
  });

  it("deduplicates repeated kinds", () => {
    const result = readTargetKinds({
      FACTORY_MULTI_KINDS: "cb_breakout,cb_breakout,cb_breakout",
    });
    expect(result).toEqual(["cb_breakout"]);
  });

  it("allows the operator to include poly_short_binary_directional explicitly", () => {
    // The skip list only filters the DEFAULT. An explicit env override
    // bypasses it — if the operator has stopped the BTC-5m factory and
    // wants this factory to cover that kind too, they can.
    const result = readTargetKinds({
      FACTORY_MULTI_KINDS: "poly_short_binary_directional",
    });
    expect(result).toEqual(["poly_short_binary_directional"]);
  });

  it("drops unknown kinds and warns via the supplied logger", () => {
    const warn = vi.fn();
    const result = readTargetKinds(
      { FACTORY_MULTI_KINDS: "cb_breakout,bogus_kind,cb_mean_reversion" },
      warn,
    );
    expect(result).toEqual(["cb_breakout", "cb_mean_reversion"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("bogus_kind");
  });

  it("returns an empty list when every requested kind is invalid (operator must fix env)", () => {
    const warn = vi.fn();
    // Distinct from parseTargets which falls back to defaults — for the
    // factory, if the operator explicitly typed a list and got it ALL
    // wrong, silently running every kind would be a worse surprise than
    // running none. Better to halt and surface the warning loudly.
    const result = readTargetKinds(
      { FACTORY_MULTI_KINDS: "foo,bar,baz" },
      warn,
    );
    expect(result).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// assetForKind

describe("assetForKind", () => {
  it("returns BTC for poly_fade_spike and poly_breakout (Polymarket binaries)", () => {
    expect(assetForKind("poly_fade_spike")).toBe("BTC");
    expect(assetForKind("poly_breakout")).toBe("BTC");
  });

  it("returns undefined for cb_* kinds (genome-level multi-asset breadth)", () => {
    // cb_* genomes have product_id ∈ {BTC,ETH,SOL} so randomGenome
    // picks per-variant. Forcing asset at the campaign level would
    // collapse that breadth.
    expect(assetForKind("cb_breakout")).toBeUndefined();
    expect(assetForKind("cb_mean_reversion")).toBeUndefined();
    expect(assetForKind("cb_momentum_burst")).toBeUndefined();
  });

  it("returns undefined for asset-agnostic kinds", () => {
    expect(assetForKind("polymarket_market_maker")).toBeUndefined();
    expect(assetForKind("llm_probability_oracle")).toBeUndefined();
    expect(assetForKind("random_walk_baseline")).toBeUndefined();
    expect(assetForKind("wallet_copy_filtered")).toBeUndefined();
    expect(assetForKind("category_specialist")).toBeUndefined();
    expect(assetForKind("cross_venue_arb")).toBeUndefined();
    expect(assetForKind("multi_strategy")).toBeUndefined();
  });

  it("has a defined return value for every kind in GENOME_KINDS", () => {
    // Guards against a future kind being added to genome.ts but
    // forgotten here. Either BTC or undefined is acceptable — what we
    // disallow is the function throwing or returning something weird.
    for (const kind of GENOME_KINDS) {
      const result = assetForKind(kind as GenomeKind);
      expect(result === undefined || typeof result === "string").toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// kindSlug

describe("kindSlug", () => {
  it("strips underscores and digits, takes first 12 alphas", () => {
    expect(kindSlug("poly_fade_spike")).toBe("polyfadespik");
    expect(kindSlug("cb_mean_reversion")).toBe("cbmeanrevers");
    expect(kindSlug("polymarket_market_maker")).toBe("polymarketma");
  });

  it("is stable / deterministic", () => {
    // Used in SQL LIKE prefixes for per-kind cadence queries. If the
    // slug isn't deterministic, the worker can't find prior runs and
    // will fire campaigns every cycle regardless of cadence.
    expect(kindSlug("cb_breakout")).toBe(kindSlug("cb_breakout"));
  });

  it("produces unique slugs for the 12 default multi-kind factory kinds", () => {
    const seen = new Set<string>();
    const kinds = GENOME_KINDS.filter((k) => !MULTI_FACTORY_SKIP_KINDS.has(k));
    for (const k of kinds) {
      const slug = kindSlug(k);
      expect(seen.has(slug)).toBe(false);
      seen.add(slug);
    }
    expect(seen.size).toBe(kinds.length);
  });

  it("handles short kinds without truncation", () => {
    expect(kindSlug("abc")).toBe("abc");
    expect(kindSlug("")).toBe("");
  });

  it("strips digits and non-alpha characters", () => {
    expect(kindSlug("v2_some_kind3")).toBe("vsomekind");
  });
});
