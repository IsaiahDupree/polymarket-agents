/**
 * GET /api/hyperliquid/deposit-status
 *
 * Polls Arbitrum for native-USDC Transfer events whose `to` field is the
 * Hyperliquid deposit address. Used by /deposit/hyperliquid to confirm
 * an outbound transaction landed on-chain.
 *
 * Query params:
 *   - lookbackBlocks: number — how far back to scan. Default 600 (≈ 10 min
 *                              on Arbitrum's ~1s block time, but the chain
 *                              actually averages ~0.25s so this is ~2.5 min
 *                              of wall time; conservative for "did my deposit
 *                              just land?" polling).
 *
 * Returns:
 *   {
 *     ok: true,
 *     fromBlock: bigint-as-string,
 *     toBlock: bigint-as-string,
 *     bridgeBalance: { atomic: string, usdc: number },
 *     inflows: Array<{ txHash, from, value: { atomic, usdc }, blockNumber, ageSec }>,
 *   }
 *
 * No mutating side effects. Public RPC fallback (publicnode.com) so this
 * works out of the box without ARBITRUM_RPC_URL set, though it's rate-limited.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { arbitrum } from "viem/chains";
import { HYPERLIQUID_DEPOSIT } from "@/lib/deposits/hyperliquid";

export const dynamic = "force-dynamic";

const USDC_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)",
]);

function client() {
  const rpcUrl = process.env.ARBITRUM_RPC_URL ?? "https://arbitrum.publicnode.com";
  return createPublicClient({ chain: arbitrum, transport: http(rpcUrl) });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const lookback = Math.min(
      Math.max(Number(url.searchParams.get("lookbackBlocks") ?? "600"), 10),
      5000,
    );

    const pub = client();
    const tip = await pub.getBlockNumber();
    const fromBlock = tip > BigInt(lookback) ? tip - BigInt(lookback) : 0n;

    const usdc = getAddress(HYPERLIQUID_DEPOSIT.token.address);
    const bridge = getAddress(HYPERLIQUID_DEPOSIT.bridgeAddress);

    const [logs, bal] = await Promise.all([
      pub.getLogs({
        address: usdc,
        event: USDC_ABI[0],
        args: { to: bridge },
        fromBlock,
        toBlock: tip,
      }),
      pub.readContract({
        address: usdc,
        abi: USDC_ABI,
        functionName: "balanceOf",
        args: [bridge],
      }),
    ]);

    // Resolve block timestamps in parallel so the UI can show "30s ago".
    const uniqBlocks = Array.from(new Set(logs.map((l) => l.blockNumber!)));
    const blockTimes = new Map<bigint, number>();
    await Promise.all(
      uniqBlocks.map(async (n) => {
        const b = await pub.getBlock({ blockNumber: n });
        blockTimes.set(n, Number(b.timestamp));
      }),
    );

    const now = Math.floor(Date.now() / 1000);
    const decimals = HYPERLIQUID_DEPOSIT.token.decimals;
    const div = 10 ** decimals;

    const inflows = logs
      .map((log) => {
        const ts = blockTimes.get(log.blockNumber!) ?? now;
        const atomic = (log.args.value ?? 0n).toString();
        return {
          txHash: log.transactionHash,
          from: log.args.from,
          value: { atomic, usdc: Number(log.args.value ?? 0n) / div },
          blockNumber: Number(log.blockNumber),
          timestamp: ts,
          ageSec: Math.max(0, now - ts),
        };
      })
      .sort((a, b) => b.blockNumber - a.blockNumber);

    return NextResponse.json({
      ok: true,
      fromBlock: fromBlock.toString(),
      toBlock: tip.toString(),
      bridge: bridge,
      bridgeBalance: {
        atomic: bal.toString(),
        usdc: Number(bal) / div,
      },
      inflows,
      scannedAtMs: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
