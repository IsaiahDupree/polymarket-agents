import { describe, expect, it } from "vitest";
import {
  buildLeaderboardUrl,
  fetchWalletPnl,
  fetchManyWalletPnl,
  type LeaderboardEntry,
} from "@/lib/wallets/pnl-fetcher";

function mockFetch(entries: LeaderboardEntry[] | null, opts: { status?: number } = {}): typeof fetch {
  const status = opts.status ?? 200;
  return (async () =>
    new Response(JSON.stringify(entries ?? []), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("buildLeaderboardUrl", () => {
  it("includes the OVERALL/ALL/PNL category + userName param", () => {
    const url = buildLeaderboardUrl("kch123");
    expect(url).toContain("category=OVERALL");
    expect(url).toContain("timePeriod=ALL");
    expect(url).toContain("orderBy=PNL");
    expect(url).toContain("userName=kch123");
  });

  it("URL-encodes special characters in the handle", () => {
    const url = buildLeaderboardUrl("foo bar");
    expect(url).toContain("userName=foo+bar");
  });
});

describe("fetchWalletPnl — happy path", () => {
  it("returns ActualPnl when the API returns a single entry", async () => {
    const r = await fetchWalletPnl("kch123", {
      fetchImpl: mockFetch([
        {
          rank: "3",
          proxyWallet: "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee",
          userName: "kch123",
          vol: 292_669_000,
          pnl: 11_590_000,
        },
      ]),
    });
    expect(r).not.toBeNull();
    if (r) {
      expect(r.pnlUsd).toBe(11_590_000);
      expect(r.volUsd).toBe(292_669_000);
      expect(r.rank).toBe(3);
      expect(r.proxyWallet).toBe("0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee");
      expect(r.userName).toBe("kch123");
    }
  });

  it("handles rank as a number (not just a string)", async () => {
    const r = await fetchWalletPnl("x", {
      fetchImpl: mockFetch([{ rank: 7, proxyWallet: "0xabc", userName: "x", vol: 100, pnl: 10 }]),
    });
    expect(r?.rank).toBe(7);
  });
});

describe("fetchWalletPnl — null paths", () => {
  it("returns null on empty array (no matching handle)", async () => {
    const r = await fetchWalletPnl("ghost", { fetchImpl: mockFetch([]) });
    expect(r).toBeNull();
  });

  it("returns null on HTTP error", async () => {
    const r = await fetchWalletPnl("x", { fetchImpl: mockFetch(null, { status: 500 }) });
    expect(r).toBeNull();
  });

  it("returns null when proxyWallet is missing", async () => {
    const r = await fetchWalletPnl("x", {
      fetchImpl: mockFetch([{ userName: "x", vol: 100, pnl: 10 }]),
    });
    expect(r).toBeNull();
  });

  it("returns null when pnl is non-numeric (string)", async () => {
    // JSON.stringify drops NaN to null, so to test the "non-finite pnl" branch
    // we send a string that Number() can't parse.
    const r = await fetchWalletPnl("x", {
      fetchImpl: mockFetch([{ proxyWallet: "0xabc", userName: "x", vol: 100, pnl: "not-a-number" as any }]),
    });
    expect(r).toBeNull();
  });

  it("returns null when fetch throws", async () => {
    const throwingFetch = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    const r = await fetchWalletPnl("x", { fetchImpl: throwingFetch });
    expect(r).toBeNull();
  });
});

describe("fetchManyWalletPnl", () => {
  it("returns a Map keyed by handle, with null for failures", async () => {
    const responses: Record<string, LeaderboardEntry[]> = {
      kch123: [{ proxyWallet: "0xabc", userName: "kch123", vol: 1, pnl: 100 }],
      ghost: [],
      gatorr: [{ proxyWallet: "0xdef", userName: "gatorr", vol: 2, pnl: 200 }],
    };
    const mock: typeof fetch = (async (url: string) => {
      const handle = new URL(url as string).searchParams.get("userName") ?? "";
      const body = JSON.stringify(responses[handle] ?? []);
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await fetchManyWalletPnl(["kch123", "ghost", "gatorr"], {
      fetchImpl: mock,
      delayMs: 0, // skip the rate gate for the test
    });
    expect(result.size).toBe(3);
    expect(result.get("kch123")?.pnlUsd).toBe(100);
    expect(result.get("ghost")).toBeNull();
    expect(result.get("gatorr")?.pnlUsd).toBe(200);
  });
});
