/**
 * Polymarket leaderboard PnL fetcher.
 *
 * The /v1/leaderboard endpoint with `userName=<handle>` returns the
 * canonical lifetime PnL + volume for any wallet with a public profile.
 * This module wraps the raw fetch with a typed result + injectable
 * `fetchImpl` for tests.
 */
import type { ActualPnl } from "./pnl-reconciliation";

export type LeaderboardEntry = {
  rank?: string | number;
  proxyWallet?: string;
  userName?: string;
  xUsername?: string;
  verifiedBadge?: boolean;
  vol?: number;
  pnl?: number;
  profileImage?: string;
};

const DATA_API = "https://data-api.polymarket.com";

/**
 * Build the leaderboard query URL. Exported for testing.
 */
export function buildLeaderboardUrl(handle: string): string {
  const qs = new URLSearchParams({
    category: "OVERALL",
    timePeriod: "ALL",
    orderBy: "PNL",
    limit: "1",
    userName: handle,
  });
  return `${DATA_API}/v1/leaderboard?${qs}`;
}

/**
 * Fetch lifetime PnL for a single handle.
 *
 * Returns `null` when:
 *   - HTTP error
 *   - Empty result set (no match for the handle)
 *   - Result is malformed
 *
 * The runner script translates `null` → "wallet_not_found" verdict.
 */
export async function fetchWalletPnl(
  handle: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<ActualPnl | null> {
  const f = opts.fetchImpl ?? globalThis.fetch;
  if (!f) throw new Error("fetchWalletPnl: no fetch implementation available");

  try {
    const resp = await f(buildLeaderboardUrl(handle));
    if (!resp.ok) return null;
    const data = (await resp.json()) as LeaderboardEntry[];
    if (!Array.isArray(data) || data.length === 0) return null;
    const entry = data[0];
    const pnlUsd = Number(entry.pnl);
    const volUsd = Number(entry.vol);
    const proxyWallet = String(entry.proxyWallet ?? "");
    const userName = String(entry.userName ?? handle);
    if (!Number.isFinite(pnlUsd) || !Number.isFinite(volUsd) || !proxyWallet) {
      return null;
    }
    const rankRaw = entry.rank;
    const rank = rankRaw != null ? Number(rankRaw) : undefined;
    return {
      pnlUsd,
      volUsd,
      rank: Number.isFinite(rank) ? rank : undefined,
      proxyWallet,
      userName,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch PnL for many handles in parallel, with a per-call rate gate to
 * stay polite with the data API. Returns a Map<handle, ActualPnl | null>.
 *
 * `delayMs` is applied between batches; default 100ms between starts of
 * each fetch keeps us well under any reasonable rate limit while still
 * finishing 15 wallets in < 2 seconds.
 */
export async function fetchManyWalletPnl(
  handles: string[],
  opts: { fetchImpl?: typeof fetch; delayMs?: number } = {},
): Promise<Map<string, ActualPnl | null>> {
  const delay = opts.delayMs ?? 100;
  const out = new Map<string, ActualPnl | null>();
  for (const handle of handles) {
    out.set(handle, await fetchWalletPnl(handle, { fetchImpl: opts.fetchImpl }));
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
  }
  return out;
}
