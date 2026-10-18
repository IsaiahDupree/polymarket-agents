"use client";

/**
 * Form to kick off a new training campaign. POSTs to /api/arena/training-campaigns
 * and redirects to the detail page on success.
 */
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

const STRATEGY_KINDS = [
  "poly_short_binary_directional",
  "poly_binary_repricing",
  "poly_binary_arbitrage",
  "poly_late_window_scalp",
  "poly_consensus_follow",
  "poly_cross_market_zscore",
  "poly_fade_spike",
  "poly_breakout",
  "cb_momentum_burst",
  "cb_mean_reversion",
  "cb_breakout",
  "cb_orderbook_imbalance",
  "cb_trade_flow_burst",
  "llm_probability_oracle",
  "cross_venue_arb",
  "category_specialist",
  "wallet_copy_filtered",
] as const;

const ASSETS = ["", "BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "HYPE"];
const RANGE_PRESETS = [
  { label: "last 30d", days: 30 },
  { label: "last 90d", days: 90 },
  { label: "last 1y", days: 365 },
  { label: "last 2y", days: 730 },
];

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 16);
}
function isoNow(): string {
  return new Date().toISOString().slice(0, 16);
}

export function CampaignCreateForm() {
  const router = useRouter();
  const [name, setName] = useState<string>("");
  const [kind, setKind] = useState<string>("poly_binary_repricing");
  const [asset, setAsset] = useState<string>("BTC");
  const [from, setFrom] = useState<string>(isoDaysAgo(30));
  const [to, setTo] = useState<string>(isoNow());
  const [variants, setVariants] = useState<number>(50);
  const [autoSeed, setAutoSeed] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onPreset = (days: number) => {
    setFrom(isoDaysAgo(days));
    setTo(isoNow());
  };

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/arena/training-campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          kind,
          asset: asset || undefined,
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          variants,
          autoSeed,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.errors?.join(", ") ?? json.error ?? `HTTP ${res.status}`);
        setSubmitting(false);
        return;
      }
      router.push(`/arena/training-campaigns/${json.id}`);
    } catch (err) {
      setError((err as Error).message ?? String(err));
      setSubmitting(false);
    }
  }, [name, kind, asset, from, to, variants, autoSeed, router]);

  return (
    <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <h2 className="text-sm font-medium text-zinc-200">new campaign</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="repricing-BTC-90d-sweep"
            className="w-full px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">strategy kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="w-full px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200"
          >
            {STRATEGY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">asset filter (optional)</label>
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
            className="w-full px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200"
          >
            {ASSETS.map((a) => <option key={a} value={a}>{a || "any"}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">variants (1..1000)</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={variants}
            onChange={(e) => setVariants(Number(e.target.value) || 50)}
            className="w-full px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 tabular-nums"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">range from</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-1">range to</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full px-2 py-1 rounded border border-zinc-700 bg-zinc-900 text-zinc-200"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-500">presets:</span>
        {RANGE_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPreset(p.days)}
            className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700"
          >
            {p.label}
          </button>
        ))}
        <label className="ml-3 flex items-center gap-1.5 text-zinc-400">
          <input
            type="checkbox"
            checked={autoSeed}
            onChange={(e) => setAutoSeed(e.target.checked)}
          />
          auto-seed top 5 as paper_agents
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !name}
          className="px-3 py-1.5 rounded bg-accent-blue/20 text-accent-blue border border-accent-blue/40 hover:bg-accent-blue/30 disabled:opacity-30 disabled:cursor-not-allowed text-sm"
        >
          {submitting ? "starting…" : "start campaign"}
        </button>
        {error && <span className="text-xs text-accent-red">{error}</span>}
        <span className="text-[11px] text-zinc-500">
          worker runs in the background — page will redirect to the detail view where you can watch progress.
        </span>
      </div>
    </section>
  );
}
