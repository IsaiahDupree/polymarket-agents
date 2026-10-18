/**
 * Path C from atomic-multicall-plan.md: pre-signed transaction bundle
 * builder for Polygon MEV relays (Marlin's MEV-Boost-on-Polygon, Fast
 * Lane, or any future Polygon-native bundle endpoint).
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠️  HONEST CAVEAT (from the design plan):
 *
 *     Polygon's MEV relay ecosystem is much thinner than Ethereum's.
 *     Marlin's MEV-Boost-on-Polygon is in beta as of late 2025; coverage
 *     is patchy. This client is a SCAFFOLD — the API surface is here,
 *     plug in the relay you actually trust at deploy time.
 *
 *     Also: Path C alone DOES NOT solve the article's atomic-fill
 *     problem. Each tx still independently encodes its price bounds via
 *     the CTF Exchange's own fillOrder revert. The relay just guarantees
 *     simultaneous inclusion; it doesn't guarantee both fills succeed
 *     at the prices we wanted. For true atomicity Path A's contract is
 *     still the right answer.
 *
 *     Where Path C helps: REDUCING the same-block frequency penalty
 *     between detection and settlement (the article's "30-second
 *     detection-to-submission window") for cases where Path A's contract
 *     can't be used (e.g. cross-venue arbs that involve non-Polymarket
 *     legs).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Two responsibilities:
 *
 *   1. **buildBundle** — pure. Takes an array of pre-signed raw txs
 *      (hex strings), wraps them in the relay's expected JSON-RPC envelope.
 *      Returns the payload ready to POST.
 *
 *   2. **submitBundle** — async. POSTs the payload to MEV_RELAY_URL.
 *      Returns the relay's response. Honest about failure modes:
 *      missing env, network error, relay reject.
 */

export type RawSignedTx = `0x${string}`;

export type BundleSubmissionPayload = {
  jsonrpc: "2.0";
  method: "eth_sendBundle";
  id: number;
  params: [
    {
      /** Raw signed transactions in hex. */
      txs: RawSignedTx[];
      /** Target block number. Bundles land iff included in this block. */
      blockNumber: string; // hex-encoded
      /** Optional: max block to keep trying. */
      maxBlockNumber?: string;
      /** Optional: per-tx hashes the operator is OK if they fail. */
      revertingTxHashes?: string[];
    },
  ];
};

export type RelaySubmitResult =
  | { kind: "no_relay"; reason: string }
  | { kind: "dry_run"; reason: string; payload: BundleSubmissionPayload }
  | { kind: "submitted"; bundleHash: string; rawResponse: unknown }
  | { kind: "rejected"; reason: string };

/**
 * Pure: build the bundle payload.
 *
 * @param txs           Array of raw signed transactions (hex).
 * @param targetBlock   Block we want inclusion in. Operator computes this
 *                      from current block + sensible lookahead (e.g. +2).
 * @param maxBlock      Optional ceiling (defaults to targetBlock + 5).
 */
export function buildBundle(args: {
  txs: RawSignedTx[];
  targetBlock: bigint;
  maxBlock?: bigint;
  revertingTxHashes?: string[];
}): BundleSubmissionPayload {
  if (args.txs.length === 0) throw new Error("buildBundle: empty txs");
  for (const tx of args.txs) {
    if (!tx.startsWith("0x") || tx.length < 4) {
      throw new Error(`buildBundle: invalid raw tx ${tx.slice(0, 16)}…`);
    }
  }
  const maxBlock = args.maxBlock ?? args.targetBlock + 5n;
  if (maxBlock < args.targetBlock) {
    throw new Error(`buildBundle: maxBlock ${maxBlock} < targetBlock ${args.targetBlock}`);
  }
  return {
    jsonrpc: "2.0",
    method: "eth_sendBundle",
    id: 1,
    params: [
      {
        txs: args.txs,
        blockNumber: `0x${args.targetBlock.toString(16)}`,
        maxBlockNumber: `0x${maxBlock.toString(16)}`,
        ...(args.revertingTxHashes ? { revertingTxHashes: args.revertingTxHashes } : {}),
      },
    ],
  };
}

/**
 * Submit a bundle to a Polygon MEV relay.
 *
 * Env:
 *   - MEV_RELAY_URL    — full URL of the relay's eth_sendBundle endpoint
 *   - MEV_RELAY_LIVE   — "1" to actually POST; otherwise dry-run
 *
 * Tests inject the `fetchImpl` so we don't hit the real network.
 */
export async function submitBundle(args: {
  txs: RawSignedTx[];
  targetBlock: bigint;
  maxBlock?: bigint;
  revertingTxHashes?: string[];
  /** Caller supplies the fetch implementation. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}): Promise<RelaySubmitResult> {
  const url = process.env.MEV_RELAY_URL;
  if (!url) {
    return { kind: "no_relay", reason: "MEV_RELAY_URL not set" };
  }

  let payload: BundleSubmissionPayload;
  try {
    payload = buildBundle({
      txs: args.txs,
      targetBlock: args.targetBlock,
      maxBlock: args.maxBlock,
      revertingTxHashes: args.revertingTxHashes,
    });
  } catch (err) {
    return { kind: "rejected", reason: (err as Error).message };
  }

  if (process.env.MEV_RELAY_LIVE !== "1") {
    return { kind: "dry_run", reason: "MEV_RELAY_LIVE!=1", payload };
  }

  const f = args.fetchImpl ?? globalThis.fetch;
  if (!f) {
    return { kind: "rejected", reason: "no fetch implementation available" };
  }
  try {
    const resp = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      return { kind: "rejected", reason: `relay returned HTTP ${resp.status}: ${await safeText(resp)}` };
    }
    const data = (await resp.json()) as { result?: { bundleHash?: string }; error?: { message?: string } };
    if (data.error) {
      return { kind: "rejected", reason: `relay error: ${data.error.message ?? JSON.stringify(data.error)}` };
    }
    const bundleHash = data.result?.bundleHash ?? "unknown";
    return { kind: "submitted", bundleHash, rawResponse: data };
  } catch (err) {
    return { kind: "rejected", reason: (err as Error).message };
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 200);
  } catch {
    return "(response body unavailable)";
  }
}
