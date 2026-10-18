/**
 * /deposit/hyperliquid — QR + warnings for depositing USDC to Hyperliquid.
 *
 * Hyperliquid's USDC deposit goes to a specific bridge contract on Arbitrum.
 * The page renders the QR + a wall of warnings about the most expensive
 * mistakes (wrong network, USDC.e instead of native USDC, below min).
 */
import { HyperliquidDepositClient } from "./Client";
import { HYPERLIQUID_DEPOSIT } from "@/lib/deposits/hyperliquid";

export const dynamic = "force-dynamic";

export default async function HyperliquidDepositPage(props: {
  searchParams: Promise<{ amount?: string }>;
}) {
  const sp = await props.searchParams;
  const amountParam = sp.amount ? Number(sp.amount) : undefined;
  const initialAmount =
    amountParam != null && Number.isFinite(amountParam) && amountParam >= HYPERLIQUID_DEPOSIT.minDepositUsdc
      ? amountParam
      : HYPERLIQUID_DEPOSIT.minDepositUsdc;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Deposit USDC to Hyperliquid</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Send <strong>native USDC</strong> on <strong>Arbitrum One</strong> to the bridge address below.
          The QR encodes the recipient + token + chain so EIP-681-aware wallets (MetaMask, Rabby) auto-fill the Send screen.
        </p>
      </div>

      {/* The four big mistakes, prominent. */}
      <div className="card border-accent-red/40 bg-accent-red/5">
        <h2 className="card-title text-accent-red">⚠ Before you scan — the four expensive mistakes</h2>
        <ul className="text-xs text-zinc-200 space-y-2 mt-2 list-disc list-inside">
          <li>
            <strong>Wrong network</strong> — your wallet&apos;s Send screen MUST say{" "}
            <strong className="text-accent-amber">Arbitrum One</strong> (chain id 42161),
            not Ethereum, Base, Polygon, Optimism, or Solana.
            If you sent USDC on Base from the Coinbase Base App, Hyperliquid will NOT credit it
            and recovery is unlikely.
          </li>
          <li>
            <strong>Wrong USDC variant</strong> — must be{" "}
            <strong className="text-accent-amber">native USDC</strong> at{" "}
            <code className="text-[10px]">0xaf88…5831</code>,
            NOT USDC.e at <code className="text-[10px]">0xFF97…5CC8</code>. Hyperliquid rejects bridged USDC.e.
          </li>
          <li>
            <strong>Below minimum</strong> — Hyperliquid&apos;s minimum deposit is{" "}
            <strong className="text-accent-amber">5 USDC</strong>. Anything less stays at the bridge address
            without being credited to your account.
          </li>
          <li>
            <strong>Wrong recipient</strong> — verify the entire address character-by-character.
            Scan the QR if you can; if you type it, copy-paste from this page, never from a screenshot.
          </li>
        </ul>
      </div>

      <HyperliquidDepositClient initialAmount={initialAmount} />

      {/* Address-mismatch disclosure — see src/lib/deposits/hyperliquid.ts */}
      <div className="card border-accent-amber/40 bg-accent-amber/5">
        <h2 className="card-title text-accent-amber">⚠ Address verification status</h2>
        <p className="text-xs text-zinc-200 mt-2">
          The recipient above was copied from your Hyperliquid Deposit screen on 2026-06-05.
          It does <strong>not</strong> match Hyperliquid&apos;s publicly documented Bridge2 contract
          (<code className="text-[10px]">0x2df1c51e…f163df7</code>) and currently has no on-chain history.
          The most likely benign explanation is a per-user forwarder address that auto-sweeps to Bridge2,
          but that has not been independently verified.
        </p>
        <p className="text-xs text-zinc-200 mt-2">
          <strong>Before sending more than the 5 USDC minimum: do a 5 USDC test deposit and
          confirm Hyperliquid credits it within 2 minutes.</strong> If it doesn&apos;t, stop and re-verify the address.
        </p>
      </div>

      {/* Coinbase Base App-specific walkthrough (the route the user explicitly asked about). */}
      <div className="card border-accent-blue/30 bg-accent-blue/5">
        <h2 className="card-title text-accent-blue">Coinbase Base App → Hyperliquid (step by step)</h2>
        <p className="text-xs text-zinc-300 mt-2">
          The Coinbase Base App is a smart wallet on the <strong>Base</strong> network by default.
          Hyperliquid only accepts USDC on <strong>Arbitrum One</strong>. There are two ways through:
        </p>
        <div className="mt-3 space-y-3 text-xs text-zinc-200">
          <div>
            <div className="text-accent-green font-semibold">Path A — Cross-chain send from inside the Base App (preferred if available)</div>
            <ol className="list-decimal list-inside mt-1 space-y-0.5 text-zinc-300">
              <li>Open the Base App → tap <strong>Send</strong> → choose <strong>USDC</strong>.</li>
              <li>In the network/chain selector, pick <strong>Arbitrum</strong> (NOT Base, NOT Ethereum). If Arbitrum is not offered, use Path B.</li>
              <li>Paste the recipient address from the QR card above. Verify the first 6 + last 4 chars match.</li>
              <li>Enter amount: start with <strong>5 USDC exactly</strong> for the test deposit.</li>
              <li>On the review screen, confirm: <em>Network = Arbitrum, Token = USDC (native), Recipient matches</em>. Then send.</li>
            </ol>
          </div>
          <div>
            <div className="text-accent-amber font-semibold">Path B — Bridge Base→Arbitrum first, then send</div>
            <ol className="list-decimal list-inside mt-1 space-y-0.5 text-zinc-300">
              <li>From the Base App: bridge USDC from Base → Arbitrum using Across (across.to) or Stargate. ~5-10 min, &lt;$1 fee.</li>
              <li>Once native USDC lands on Arbitrum in the same wallet, open Send → USDC → Arbitrum → paste the recipient above.</li>
              <li>Send 5 USDC as the test, then larger amounts after Hyperliquid credits it.</li>
            </ol>
          </div>
          <div>
            <div className="text-accent-blue font-semibold">Path C (safest, lowest-friction) — main Coinbase app or coinbase.com</div>
            <ol className="list-decimal list-inside mt-1 space-y-0.5 text-zinc-300">
              <li>Open <strong>coinbase.com</strong> (or the main Coinbase app, not the Base App).</li>
              <li>Withdraw / Send → USDC → in the network dropdown pick <strong>Arbitrum</strong>.</li>
              <li>Paste the recipient. Coinbase&apos;s withdraw sends native USDC, so no bridging needed.</li>
              <li>Send 5 USDC first, wait for credit, then send the rest.</li>
            </ol>
          </div>
        </div>
        <p className="text-[10px] text-zinc-500 italic mt-3">
          If your Base App network dropdown only offers Base or Ethereum and you can&apos;t pick Arbitrum,
          do NOT send — that path will lose the funds. Use Path B or C instead.
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">After USDC lands</h2>
        <ol className="text-xs text-zinc-300 space-y-1 mt-2 list-decimal list-inside">
          <li>Hyperliquid credits the deposit to your account once the Arbitrum tx confirms (1-2 minutes).</li>
          <li>Open the Hyperliquid app → Portfolio → USDC tile flips to your deposited amount.</li>
          <li>If 10 minutes pass without credit, double-check the network + token (most common cause) on Arbiscan.</li>
        </ol>
      </div>
    </div>
  );
}
