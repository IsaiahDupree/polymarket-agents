/**
 * Hyperliquid deposit URI builder.
 *
 * Hyperliquid's USDC deposit accepts:
 *   - Network:  Arbitrum One (chain id 42161)
 *   - Token:    native USDC at 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
 *               (NOT USDC.e at 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8)
 *   - Min:      5 USDC
 *
 * The deposit address below was copied from the user's Hyperliquid
 * Deposit screen (asset=USDC, network=Arbitrum, session for
 * isaiahdupree33@gmail.com) on 2026-06-05.
 *
 * ⚠ IMPORTANT — this address (0x840Ba47…2eAc) does NOT match Hyperliquid's
 * publicly documented Bridge2 contract on Arbitrum
 * (0x2df1c51e09aecf9cacb7bc98cb1742757f163df7). At time of writing, the
 * Hyperliquid docs say a single shared bridge is used, but this address
 * looks like a per-user forwarder (zero on-chain history, account-specific
 * display in the UI). It has NOT been verified independently against
 * on-chain activity or Hyperliquid official documentation.
 *
 * Before sending non-trivial amounts, the cheapest verification is a 5 USDC
 * test deposit (the bridge minimum). If Hyperliquid credits it within ~2
 * minutes, the address is real. If not, do not send more.
 *
 * If you confirm the canonical Bridge2 address instead, swap the literal
 * here and the matching expectation in
 * tests/unit/hyperliquid-deposit.test.ts.
 *
 * Pure functions only — no I/O. The page uses these to build the QR's URI
 * + the address-only fallback URI.
 */

export const HYPERLIQUID_DEPOSIT = Object.freeze({
  bridgeAddress: "0x840Ba478a11d3631c01d1a9fb4f708b71C3dE121" as const,
  chainId: 42161 as const,
  chainName: "Arbitrum One" as const,
  token: Object.freeze({
    address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const,
    symbol: "USDC" as const,
    decimals: 6 as const,
    description: "native USDC on Arbitrum (NOT USDC.e)",
  }),
  minDepositUsdc: 5 as const,
  /** What CANNOT be sent (used in the warning UI). */
  rejected: Object.freeze({
    usdcDotE: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    otherNetworks: ["Ethereum", "Base", "Polygon", "Optimism", "Solana"],
  }),
});

/**
 * EIP-681 ERC-20 transfer URI.
 *
 * Format: `ethereum:<token>@<chain>/transfer?address=<recipient>&uint256=<amount>`
 *
 * Wallet apps that understand EIP-681 (MetaMask, Rabby) auto-fill the
 * Send screen from the URI. Wallets that don't understand it fall back
 * to scanning just the address; that's what `addressOnlyUri` is for.
 *
 * @param amountUsdc Optional. Number of USDC to pre-fill (>= min). Omit to
 *   let the user enter the amount manually in their wallet.
 */
export function buildEip681Uri(amountUsdc?: number): string {
  const { bridgeAddress, chainId, token, minDepositUsdc } = HYPERLIQUID_DEPOSIT;
  let qs = `address=${bridgeAddress}`;
  if (amountUsdc != null) {
    if (!Number.isFinite(amountUsdc)) {
      throw new Error(`buildEip681Uri: amountUsdc must be a finite number, got ${amountUsdc}`);
    }
    if (amountUsdc < minDepositUsdc) {
      throw new Error(`buildEip681Uri: amount ${amountUsdc} USDC is below Hyperliquid's ${minDepositUsdc} USDC minimum`);
    }
    // 6 decimals → multiply by 10^6 and floor to integer atomic units.
    const atomic = BigInt(Math.floor(amountUsdc * 10 ** token.decimals));
    qs += `&uint256=${atomic.toString()}`;
  }
  return `ethereum:${token.address}@${chainId}/transfer?${qs}`;
}

/**
 * Address-only fallback URI (`ethereum:<recipient>@<chain>`). This is what
 * wallets that don't understand EIP-681's `/transfer` endpoint will accept.
 *
 * The user still has to manually:
 *   - select USDC as the token (NOT USDC.e)
 *   - select Arbitrum as the network
 *   - enter the amount
 *
 * That's where the on-page warnings save them.
 */
export function buildAddressOnlyUri(): string {
  const { bridgeAddress, chainId } = HYPERLIQUID_DEPOSIT;
  return `ethereum:${bridgeAddress}@${chainId}`;
}

/**
 * Convenience: both URIs at once + the human-readable preview a UI can
 * surface alongside the QR.
 */
export type DepositPreview = {
  eip681: string;
  addressOnly: string;
  recipient: string;
  network: string;
  chainId: number;
  token: {
    address: string;
    symbol: string;
    decimals: number;
  };
  amountUsdc: number | null;
  minDepositUsdc: number;
};

export function buildDepositPreview(amountUsdc?: number): DepositPreview {
  return {
    eip681: buildEip681Uri(amountUsdc),
    addressOnly: buildAddressOnlyUri(),
    recipient: HYPERLIQUID_DEPOSIT.bridgeAddress,
    network: HYPERLIQUID_DEPOSIT.chainName,
    chainId: HYPERLIQUID_DEPOSIT.chainId,
    token: {
      address: HYPERLIQUID_DEPOSIT.token.address,
      symbol: HYPERLIQUID_DEPOSIT.token.symbol,
      decimals: HYPERLIQUID_DEPOSIT.token.decimals,
    },
    amountUsdc: amountUsdc ?? null,
    minDepositUsdc: HYPERLIQUID_DEPOSIT.minDepositUsdc,
  };
}
