"use client";

/**
 * Polished /deposit/hyperliquid frontend.
 *
 * Sections, top to bottom:
 *   1. Verification badges (Network / Token / Bridge address) — the three
 *      things that, if wrong, lose the money.
 *   2. Hero QR — large, scannable from across the room, with a built-in
 *      "App didn't recognize it?" fallback to address-only.
 *   3. Address + chunked display + copy + checksum.
 *   4. Amount preset chips ($5, $25, $100, $500) + custom input.
 *   5. Wallet deep-link buttons — open the prefilled send screen in the
 *      user's wallet without scanning.
 *   6. Watch-for-arrival panel — polls /api/hyperliquid/deposit-status every
 *      5s once armed, surfaces any incoming USDC Transfer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  HYPERLIQUID_DEPOSIT,
  buildDepositPreview,
} from "@/lib/deposits/hyperliquid";

const PRESETS = [5, 25, 100, 500] as const;

type Inflow = {
  txHash: string;
  from: string;
  value: { atomic: string; usdc: number };
  blockNumber: number;
  timestamp: number;
  ageSec: number;
};

type StatusResp = {
  ok: boolean;
  fromBlock?: string;
  toBlock?: string;
  bridge?: string;
  bridgeBalance?: { atomic: string; usdc: number };
  inflows?: Inflow[];
  scannedAtMs?: number;
  error?: string;
};

export function HyperliquidDepositClient({ initialAmount }: { initialAmount: number }) {
  const [amount, setAmount] = useState(String(initialAmount));
  const [eip681Svg, setEip681Svg] = useState<string | null>(null);
  const [addressSvg, setAddressSvg] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [copied, setCopied] = useState<"address" | "uri" | null>(null);

  const [watching, setWatching] = useState(false);
  const [status, setStatus] = useState<StatusResp | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  const parsed = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n)) return { valid: false as const, n: null as null, reason: "Not a number" };
    if (n < HYPERLIQUID_DEPOSIT.minDepositUsdc) {
      return { valid: false as const, n, reason: `Below ${HYPERLIQUID_DEPOSIT.minDepositUsdc} USDC minimum` };
    }
    return { valid: true as const, n };
  }, [amount]);

  const preview = useMemo(
    () => buildDepositPreview(parsed.valid ? parsed.n : undefined),
    [parsed],
  );

  useEffect(() => {
    QRCode.toString(preview.eip681, { type: "svg", margin: 1, width: 420, errorCorrectionLevel: "M" })
      .then(setEip681Svg)
      .catch(() => setEip681Svg(null));
    QRCode.toString(preview.addressOnly, { type: "svg", margin: 1, width: 420, errorCorrectionLevel: "M" })
      .then(setAddressSvg)
      .catch(() => setAddressSvg(null));
  }, [preview.eip681, preview.addressOnly]);

  const copy = useCallback(async (text: string, what: "address" | "uri") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }, []);

  // Poll deposit-status every 5s when armed.
  useEffect(() => {
    if (!watching) return;
    let cancelled = false;
    async function poll() {
      try {
        const r = await fetch("/api/hyperliquid/deposit-status?lookbackBlocks=900", { cache: "no-store" });
        const j = (await r.json()) as StatusResp;
        if (cancelled) return;
        setStatus(j);
        setStatusErr(j.ok ? null : (j.error ?? "Unknown error"));
        setLastChecked(Date.now());
      } catch (e: unknown) {
        if (cancelled) return;
        setStatusErr(e instanceof Error ? e.message : String(e));
        setLastChecked(Date.now());
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [watching]);

  const activeSvg = showFallback ? addressSvg : eip681Svg;
  const activeUri = showFallback ? preview.addressOnly : preview.eip681;

  const addr = preview.recipient;
  const addrChunks = [addr.slice(0, 6), addr.slice(6, 14), addr.slice(14, 28), addr.slice(28, 38), addr.slice(38)];

  return (
    <div className="space-y-5">
      {/* Verification badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Badge
          label="Network"
          value={`${preview.network}`}
          subValue={`chain id ${preview.chainId}`}
          tone="green"
        />
        <Badge
          label="Token"
          value={`Native USDC`}
          subValue={`${preview.token.address.slice(0, 6)}…${preview.token.address.slice(-4)} · ${preview.token.decimals} dec`}
          tone="green"
        />
        <Badge
          label="Minimum"
          value={`${preview.minDepositUsdc} USDC`}
          subValue="below this is lost"
          tone="amber"
        />
      </div>

      {/* Hero QR */}
      <div className="card border-accent-green/40 bg-accent-green/5">
        <div className="flex items-center justify-between">
          <h3 className="card-title text-accent-green">Scan from your wallet</h3>
          <button
            onClick={() => setShowFallback(!showFallback)}
            className="text-[10px] text-accent-blue hover:underline"
          >
            {showFallback ? "← EIP-681 (token-aware)" : "Wallet didn't recognize? → Address-only QR"}
          </button>
        </div>
        <div className="mt-4 flex flex-col md:flex-row items-center md:items-start gap-6">
          <div className="bg-white rounded-lg p-4 shadow-md shrink-0">
            {activeSvg ? (
              <div className="w-[320px] h-[320px] [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: activeSvg }} />
            ) : (
              <div className="w-[320px] h-[320px] flex items-center justify-center text-zinc-500 text-sm">
                Generating QR…
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3 text-xs w-full">
            <div>
              <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Recipient (Hyperliquid bridge)</div>
              <div className="font-mono text-zinc-100 text-sm break-all leading-relaxed">
                <span className="text-accent-green">{addrChunks[0]}</span>
                <span>{addrChunks[1]}</span>
                <span className="text-zinc-500">{addrChunks[2]}</span>
                <span>{addrChunks[3]}</span>
                <span className="text-accent-green">{addrChunks[4]}</span>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => copy(addr, "address")}
                  className="text-[11px] bg-ink-800 hover:bg-ink-700 border border-ink-700 rounded px-2 py-1 text-zinc-200"
                >
                  {copied === "address" ? "✓ Address copied" : "Copy address"}
                </button>
                <a
                  href={`https://arbiscan.io/address/${addr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] bg-ink-800 hover:bg-ink-700 border border-ink-700 rounded px-2 py-1 text-zinc-200"
                >
                  View on Arbiscan ↗
                </a>
              </div>
            </div>
            <div>
              <div className="text-zinc-500 text-[10px] uppercase tracking-wider">Amount pre-filled</div>
              <div className="text-zinc-100 text-sm">
                {parsed.valid
                  ? `${parsed.n} USDC (${(parsed.n * 10 ** preview.token.decimals).toLocaleString()} atomic units)`
                  : <span className="text-accent-amber">none — enter in wallet</span>}
              </div>
            </div>
            <details className="text-zinc-500 text-[10px]">
              <summary className="cursor-pointer hover:text-zinc-300">Show raw URI ({showFallback ? "address-only" : "EIP-681"})</summary>
              <div className="mt-1 font-mono break-all bg-ink-900 p-2 rounded text-zinc-300">{activeUri}</div>
              <button
                onClick={() => copy(activeUri, "uri")}
                className="mt-1 text-accent-blue hover:underline"
              >
                {copied === "uri" ? "✓ copied" : "Copy URI"}
              </button>
            </details>
          </div>
        </div>
      </div>

      {/* Amount + presets */}
      <div className="card">
        <h3 className="card-title">Amount</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const active = parsed.valid && parsed.n === p;
            return (
              <button
                key={p}
                onClick={() => setAmount(String(p))}
                className={`text-xs rounded-full px-3 py-1.5 border transition-colors ${
                  active
                    ? "bg-accent-blue/20 border-accent-blue/60 text-accent-blue"
                    : "bg-ink-800 border-ink-700 text-zinc-300 hover:border-ink-600"
                }`}
              >
                ${p} USDC
              </button>
            );
          })}
          <label className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">custom</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.trim())}
              placeholder={`Min ${HYPERLIQUID_DEPOSIT.minDepositUsdc}`}
              inputMode="decimal"
              className="bg-ink-900 border border-ink-700 rounded px-2 py-1 text-zinc-200 font-mono text-xs w-28 focus:outline-none focus:border-accent-blue/60"
            />
          </label>
        </div>
        {!parsed.valid && parsed.reason && (
          <div className="mt-2 text-[10px] text-accent-amber">
            {parsed.reason} — the QR will only encode the address, no amount.
          </div>
        )}
      </div>

      {/* Wallet deep-links */}
      <div className="card">
        <h3 className="card-title">Open in wallet</h3>
        <p className="text-[10px] text-zinc-500 mt-1">
          These open the wallet&apos;s prefilled Send screen. Confirm network = Arbitrum + token = native USDC before signing.
        </p>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
          <WalletButton
            label="MetaMask"
            href={`https://metamask.app.link/send/${preview.token.address}@${preview.chainId}/transfer?address=${addr}${parsed.valid ? `&uint256=${BigInt(Math.floor(parsed.n * 10 ** preview.token.decimals))}` : ""}`}
          />
          <WalletButton
            label="Rabby"
            href={`rabby://send?to=${addr}&chain=arbitrum&token=${preview.token.address}${parsed.valid ? `&amount=${parsed.n}` : ""}`}
          />
          <WalletButton
            label="Coinbase Wallet"
            href={`https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(activeUri)}`}
          />
          <WalletButton
            label="Generic EIP-681"
            href={activeUri}
          />
        </div>
      </div>

      {/* Watch-for-arrival */}
      <div className={`card ${watching ? "border-accent-blue/40 bg-accent-blue/5" : ""}`}>
        <div className="flex items-center justify-between">
          <h3 className="card-title">After you send: watch for arrival</h3>
          <button
            onClick={() => {
              setWatching(!watching);
              if (!watching) { setStatus(null); setStatusErr(null); setLastChecked(null); }
            }}
            className={`text-xs rounded px-3 py-1 border ${
              watching
                ? "bg-accent-red/20 border-accent-red/40 text-accent-red"
                : "bg-accent-blue/20 border-accent-blue/40 text-accent-blue"
            }`}
          >
            {watching ? "Stop watching" : "Start watching"}
          </button>
        </div>
        {watching && (
          <div className="mt-3 space-y-2">
            <div className="text-[10px] text-zinc-500">
              Polling Arbitrum every 5s for USDC Transfers to {addr.slice(0, 6)}…{addr.slice(-4)}.
              {lastChecked && <> Last check: {new Date(lastChecked).toLocaleTimeString()}.</>}
            </div>
            {statusErr && (
              <div className="text-[11px] text-accent-red bg-accent-red/10 border border-accent-red/30 rounded px-2 py-1">
                RPC error: {statusErr}
              </div>
            )}
            {status?.ok && status.inflows && (
              <div>
                {status.inflows.length === 0 ? (
                  <div className="text-[11px] text-zinc-400 italic">
                    No USDC transfers to the bridge in the last ~{Math.round((Number(status.toBlock) - Number(status.fromBlock)) * 0.25 / 60)} minutes.
                    Send your transaction, then wait — it should appear within ~30 seconds of confirmation.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {status.inflows.slice(0, 8).map((flow) => (
                      <div key={flow.txHash} className="font-mono text-[11px] bg-ink-900 border border-ink-700 rounded p-2 flex items-center justify-between gap-2">
                        <span className="text-accent-green shrink-0">+{flow.value.usdc.toFixed(2)} USDC</span>
                        <span className="text-zinc-500 truncate">from {flow.from.slice(0, 6)}…{flow.from.slice(-4)}</span>
                        <span className="text-zinc-400 shrink-0">{flow.ageSec}s ago</span>
                        <a
                          href={`https://arbiscan.io/tx/${flow.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent-blue hover:underline shrink-0"
                        >
                          tx ↗
                        </a>
                      </div>
                    ))}
                    <div className="text-[10px] text-zinc-500 mt-2">
                      Look for an inflow with your sending wallet&apos;s address as the source. Once it appears,
                      Hyperliquid should credit your account within ~1 minute.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ label, value, subValue, tone }: { label: string; value: string; subValue: string; tone: "green" | "amber" }) {
  const cls = tone === "green"
    ? "border-accent-green/40 bg-accent-green/5"
    : "border-accent-amber/40 bg-accent-amber/5";
  const valueCls = tone === "green" ? "text-accent-green" : "text-accent-amber";
  return (
    <div className={`card ${cls}`}>
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-medium ${valueCls} mt-0.5`}>{value}</div>
      <div className="text-[10px] text-zinc-500 mt-0.5">{subValue}</div>
    </div>
  );
}

function WalletButton({ label, href }: { label: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-xs bg-ink-800 hover:bg-ink-700 border border-ink-700 hover:border-accent-blue/40 rounded px-3 py-2 text-zinc-200 text-center transition-colors"
    >
      {label}
    </a>
  );
}
