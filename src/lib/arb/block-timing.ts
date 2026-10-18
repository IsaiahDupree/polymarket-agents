/**
 * Block-timing telemetry for multi-leg trades — @0x_Discover article #1.
 *
 *   The 2-second window is not a bug. It's a structural feature. Polygon
 *   block time is 2 seconds. Everyone waits for the same blockchain. The
 *   edge comes from the 30 seconds before that — the detection-to-
 *   submission window where fast systems submit all legs in one block and
 *   slow systems are still reading the market.
 *
 * This module lets us MEASURE whether our legs landed same-block (the
 * article's "atomicity" goal) or split across blocks (the failure mode).
 * Without measurement we can't tell if our parallel-best-effort
 * `Promise.all` submission is actually atomic in practice.
 *
 * Pure analysis. The RPC fetch helper at the bottom is thin and uses the
 * codebase's existing viem patterns; it's the only place this module
 * touches the network.
 */

import { createPublicClient, http } from "viem";
import { polygon } from "viem/chains";

export type LegBlockInfo = {
  /** Per-leg label e.g. "YES" or "NO". */
  label: string;
  /** 0x-prefixed transaction hash. */
  txHash: string;
  /** Block number the tx landed in. */
  blockNumber: number;
  /** Block timestamp (unix seconds). */
  blockTimestamp?: number;
};

export type BlockTimingSummary = {
  /** All legs landed in the SAME block (the article's ideal). */
  sameBlock: boolean;
  /** Difference between max and min block numbers across legs. */
  maxSpreadBlocks: number;
  /** Difference between max and min block timestamps in seconds. */
  maxSpreadSeconds: number;
  /** Min block across legs. */
  minBlockNumber: number;
  /** Max block across legs. */
  maxBlockNumber: number;
  /** Number of legs analysed. */
  legCount: number;
  /** Per-leg detail, sorted by block number ascending. */
  legs: LegBlockInfo[];
};

/**
 * Pure: take a set of leg block infos, summarise atomicity.
 *
 * Edge cases:
 *   - Empty input: returns `{sameBlock: false, ...zeros, legs: []}`
 *   - Single leg: trivially same-block.
 *   - Missing timestamps: maxSpreadSeconds defaults to (maxSpreadBlocks × 2.1)
 *     since Polygon target block time is ~2.1 s.
 */
export function summarizeBlockTiming(legs: LegBlockInfo[]): BlockTimingSummary {
  if (legs.length === 0) {
    return {
      sameBlock: false,
      maxSpreadBlocks: 0,
      maxSpreadSeconds: 0,
      minBlockNumber: 0,
      maxBlockNumber: 0,
      legCount: 0,
      legs: [],
    };
  }
  const sorted = [...legs].sort((a, b) => a.blockNumber - b.blockNumber);
  const minBlock = sorted[0].blockNumber;
  const maxBlock = sorted[sorted.length - 1].blockNumber;
  const maxSpreadBlocks = maxBlock - minBlock;

  let maxSpreadSeconds = maxSpreadBlocks * 2.1;
  const timestamps = sorted.map((l) => l.blockTimestamp).filter((t): t is number => Number.isFinite(t));
  if (timestamps.length === sorted.length) {
    maxSpreadSeconds = Math.max(...timestamps) - Math.min(...timestamps);
  }

  return {
    sameBlock: maxSpreadBlocks === 0,
    maxSpreadBlocks,
    maxSpreadSeconds,
    minBlockNumber: minBlock,
    maxBlockNumber: maxBlock,
    legCount: sorted.length,
    legs: sorted,
  };
}

/**
 * Convenience: human-readable verdict. Returns a one-line summary suitable
 * for evolution_log row summary fields.
 *
 *   "atomic (1 block, 0s)"     — sameBlock
 *   "split: 2 blocks, ~4s"     — close but not same
 *   "split: 12 blocks, ~25s"   — slow, edge probably already eaten
 */
export function blockTimingVerdict(summary: BlockTimingSummary): string {
  if (summary.legCount === 0) return "no legs to time";
  if (summary.legCount === 1) return "single leg (trivially same-block)";
  if (summary.sameBlock) return `atomic (1 block, ${summary.maxSpreadSeconds.toFixed(1)}s spread)`;
  return `split: ${summary.maxSpreadBlocks + 1} blocks (${summary.maxSpreadSeconds.toFixed(1)}s spread)`;
}

// ────────────────────────────────────────────────────────── RPC helper

type RpcClient = {
  getTransactionReceipt: (args: { hash: `0x${string}` }) => Promise<{ blockNumber: bigint } | null>;
  getBlock: (args: { blockNumber: bigint }) => Promise<{ timestamp: bigint }>;
};

let cachedClient: RpcClient | null = null;
function rpcClient(): RpcClient {
  if (cachedClient) return cachedClient;
  const url = process.env.POLYGON_RPC_URL ?? process.env.ALCHEMY_RPC_URL ?? polygon.rpcUrls.default.http[0];
  cachedClient = createPublicClient({ chain: polygon, transport: http(url) }) as unknown as RpcClient;
  return cachedClient;
}

/**
 * Fetch block info for a set of tx hashes. Uses POLYGON_RPC_URL /
 * ALCHEMY_RPC_URL if set, otherwise viem's default polygon endpoint.
 *
 * Returns `null` for any tx that can't be resolved (not mined yet, bad
 * hash). Caller decides whether to retry — for the rollback path we just
 * skip telemetry when receipts aren't available.
 */
export async function fetchLegBlockInfo(
  legs: Array<{ label: string; txHash: string }>,
  injectedClient?: RpcClient,
): Promise<LegBlockInfo[]> {
  const c = injectedClient ?? rpcClient();
  const out: LegBlockInfo[] = [];
  for (const leg of legs) {
    if (!leg.txHash || !leg.txHash.startsWith("0x")) continue;
    try {
      const receipt = await c.getTransactionReceipt({ hash: leg.txHash as `0x${string}` });
      if (!receipt) continue;
      const block = await c.getBlock({ blockNumber: receipt.blockNumber });
      out.push({
        label: leg.label,
        txHash: leg.txHash,
        blockNumber: Number(receipt.blockNumber),
        blockTimestamp: Number(block.timestamp),
      });
    } catch {
      // Transient RPC failure — skip this leg; caller still gets partial timing.
    }
  }
  return out;
}

/** Reset cached client (tests only). */
export function _resetClientForTests(): void {
  cachedClient = null;
}
