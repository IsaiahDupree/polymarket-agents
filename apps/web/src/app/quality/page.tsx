import { AutoRefresh } from "@/components/AutoRefresh";
import { db } from "@/lib/db/client";
import {
  decideKindAssetEligibility,
  readThresholdsFromEnv,
  type KindAssetPerformance,
} from "@/lib/arena/dynamic-eligibility";

export const dynamic = "force-dynamic";

type OverfitRow = {
  id: number;
  ts_iso: string;
  scope: string;
  n_agents: number;
  n_trades: number;
  pbo: number | null;
  dsr: number | null;
  median_oos: number | null;
  hardened: number;
};
type CacheSourceRow = {
  source: string;
  total_rows: number;
  rows_24h: number;
  bytes_total: number;
};
type KindAssetRow = {
  kind: string;
  asset: string;
  trades_in_window: number;
  realized_pnl_in_window: number;
};

const ELIGIBILITY_WINDOW_DAYS = Number(process.env.ARENA_ELIGIBILITY_WINDOW_DAYS ?? "14");

function fmt(n: number | null | undefined, digits = 3): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Number(n).toFixed(digits);
}
function fmtBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtAge(iso: string): string {
  const ageSec = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (ageSec < 60) return `${Math.round(ageSec)}s ago`;
  if (ageSec < 3600) return `${Math.round(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `${(ageSec / 3600).toFixed(1)}h ago`;
  return `${(ageSec / 86400).toFixed(1)}d ago`;
}

function loadVerdicts(): OverfitRow[] {
  return db().prepare(`
    SELECT id, ts_iso, scope, n_agents, n_trades, pbo, dsr, median_oos, hardened
      FROM overfit_verdicts
     WHERE scope = 'global'
     ORDER BY id DESC
     LIMIT 14
  `).all() as OverfitRow[];
}

function loadCacheStats(): CacheSourceRow[] {
  return db().prepare(`
    SELECT
      source,
      COUNT(*)                                                                AS total_rows,
      SUM(CASE WHEN fetched_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END) AS rows_24h,
      COALESCE(SUM(response_size_bytes), 0)                                   AS bytes_total
    FROM api_call_cache
   GROUP BY source
   ORDER BY total_rows DESC
  `).all() as CacheSourceRow[];
}

function loadKindAssetPerf(): KindAssetPerformance[] {
  const cutoffIso = new Date(Date.now() - ELIGIBILITY_WINDOW_DAYS * 86_400_000).toISOString();
  // paper_trades doesn't carry kind directly; join through paper_agents.
  // asset is parsed from the symbol — for crypto binaries, symbol is "<asset>-updown-<recurrence>-<ts>".
  const rows = db().prepare(`
    SELECT
      COALESCE(json_extract(pa.genome_json, '$.kind'), 'unknown') AS kind,
      CASE
        WHEN pt.symbol LIKE 'btc-%'  OR pt.symbol LIKE 'BTC-%'  THEN 'BTC'
        WHEN pt.symbol LIKE 'eth-%'  OR pt.symbol LIKE 'ETH-%'  THEN 'ETH'
        WHEN pt.symbol LIKE 'sol-%'  OR pt.symbol LIKE 'SOL-%'  THEN 'SOL'
        WHEN pt.symbol LIKE 'xrp-%'  OR pt.symbol LIKE 'XRP-%'  THEN 'XRP'
        WHEN pt.symbol LIKE 'doge-%' OR pt.symbol LIKE 'DOGE-%' THEN 'DOGE'
        ELSE 'any'
      END                                                       AS asset,
      COUNT(*)                                                  AS trades_in_window,
      COALESCE(SUM(pt.realized_pnl_usd), 0)                     AS realized_pnl_in_window
    FROM paper_trades pt
    JOIN paper_agents pa ON pa.id = pt.paper_agent_id
   WHERE pt.tick_at >= ?
     AND pt.realized_pnl_usd IS NOT NULL
   GROUP BY kind, asset
   ORDER BY realized_pnl_in_window ASC
  `).all(cutoffIso) as KindAssetRow[];

  return rows.map((r) => ({
    kind: r.kind,
    asset: r.asset,
    trades_in_window: r.trades_in_window,
    realized_pnl_in_window: r.realized_pnl_in_window,
  }));
}

export default async function QualityPage() {
  const verdicts = loadVerdicts();
  const latest = verdicts[0] ?? null;
  const cacheStats = loadCacheStats();
  const totalCacheRows = cacheStats.reduce((acc, r) => acc + r.total_rows, 0);
  const totalCacheBytes = cacheStats.reduce((acc, r) => acc + (r.bytes_total ?? 0), 0);
  const totalRows24h = cacheStats.reduce((acc, r) => acc + r.rows_24h, 0);

  const perf = loadKindAssetPerf();
  const thresholds = readThresholdsFromEnv(process.env);
  const decisions = decideKindAssetEligibility(perf, thresholds);
  const blacklist = decisions.filter((d) => !d.eligible);
  const eligible = decisions.filter((d) => d.eligible);

  return (
    <div className="space-y-6">
      <AutoRefresh label="quality" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Quality & data integrity</h1>
        <p className="text-zinc-400 text-sm mt-1">
          Are the agents actually any good? Is the cache filling? Which (kind, asset) slices are blocked from auto-promotion?
        </p>
      </div>

      {/* ── Overfit verdict ─────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="card-title">Latest overfit verdict</h2>
        {latest === null ? (
          <p className="text-sm text-zinc-400">
            No verdict recorded yet. Run <code>npm run audit:overfit</code> to compute one.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-baseline gap-4">
              <div className={`text-3xl font-bold ${latest.hardened ? "text-accent-green" : "text-accent-red"}`}>
                {latest.hardened ? "HARDENED ✓" : "NOT HARDENED ✗"}
              </div>
              <div className="text-xs text-zinc-500">
                cohort {latest.n_agents} agents · {fmtAge(latest.ts_iso)} · scope <code>{latest.scope}</code>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Metric label="PBO" value={fmt(latest.pbo)} hint="< 0.30 pass" pass={(latest.pbo ?? 1) < 0.30} />
              <Metric label="DSR" value={fmt(latest.dsr)} hint="> 0.95 pass" pass={(latest.dsr ?? 0) > 0.95} />
              <Metric label="median OOS" value={fmt(latest.median_oos)} hint="> 0 pass" pass={(latest.median_oos ?? 0) > 0} />
            </div>
            {!latest.hardened && (
              <p className="text-xs text-zinc-400 leading-relaxed">
                Composite gate not met. <code>ARENA_REQUIRE_HARDENED_FOR_PROMOTION=1</code> in env will block live promotion until this passes.
                Meaning: the apparent edge from these agents could be a multiple-testing artifact (López de Prado PBO) or insufficient
                walk-forward stability — wait for more data before promoting to real money.
              </p>
            )}
            {verdicts.length > 1 && (
              <div>
                <p className="text-xs text-zinc-500 mb-1">Recent verdict history</p>
                <table className="w-full text-xs">
                  <thead className="text-zinc-500">
                    <tr><th className="text-left">when</th><th className="text-right">PBO</th><th className="text-right">DSR</th><th className="text-right">medOOS</th><th className="text-right">N</th><th className="text-right">verdict</th></tr>
                  </thead>
                  <tbody>
                    {verdicts.map((v) => (
                      <tr key={v.id} className="border-t border-ink-800">
                        <td>{fmtAge(v.ts_iso)}</td>
                        <td className="text-right">{fmt(v.pbo)}</td>
                        <td className="text-right">{fmt(v.dsr)}</td>
                        <td className="text-right">{fmt(v.median_oos)}</td>
                        <td className="text-right">{v.n_agents}</td>
                        <td className={`text-right ${v.hardened ? "text-accent-green" : "text-accent-red"}`}>
                          {v.hardened ? "✓" : "✗"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Cache stats ─────────────────────────────────────────────────── */}
      <section className="card">
        <h2 className="card-title">API call cache</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Every Polymarket response is stored to <code>api_call_cache</code> — Polymarket itself doesn't preserve
          history, so this is our private archive for backtesting.
        </p>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Metric label="rows" value={totalCacheRows.toLocaleString()} hint="total snapshots" />
          <Metric label="last 24h" value={totalRows24h.toLocaleString()} hint="recent writes" />
          <Metric label="storage" value={fmtBytes(totalCacheBytes)} hint="response body bytes" />
        </div>
        {cacheStats.length === 0 ? (
          <p className="text-sm text-zinc-400">Cache is empty. Start <code>npm run worker:updown-discovery</code> to populate it.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-zinc-500"><tr><th className="text-left">source</th><th className="text-right">total</th><th className="text-right">24h</th><th className="text-right">bytes</th></tr></thead>
            <tbody>
              {cacheStats.map((r) => (
                <tr key={r.source} className="border-t border-ink-800">
                  <td><code>{r.source}</code></td>
                  <td className="text-right">{r.total_rows.toLocaleString()}</td>
                  <td className="text-right">{r.rows_24h.toLocaleString()}</td>
                  <td className="text-right">{fmtBytes(r.bytes_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Per-(kind, asset) blacklist ─────────────────────────────────── */}
      <section className="card">
        <h2 className="card-title">
          Per-(kind, asset) eligibility
          <span className="text-xs text-zinc-500 font-normal ml-2">window {ELIGIBILITY_WINDOW_DAYS}d</span>
        </h2>
        <p className="text-xs text-zinc-500 mb-3">
          Hermes-style blacklist: a (kind, asset) slice is disabled when realized PnL in the window goes negative
          past the grace period. A slice being on the BLOCKED list does NOT halt the strategy — it just stops new
          auto-promotions to live for that slice.
        </p>
        {decisions.length === 0 ? (
          <p className="text-sm text-zinc-400">No paper trades in the window — nothing to evaluate.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Eligible ({eligible.length})</p>
              <table className="w-full text-xs">
                <thead className="text-zinc-500"><tr><th className="text-left">kind</th><th className="text-left">asset</th><th className="text-right">N</th><th className="text-right">PnL</th><th>reason</th></tr></thead>
                <tbody>
                  {eligible.map((d) => (
                    <tr key={`${d.kind}::${d.asset}`} className="border-t border-ink-800">
                      <td><code>{d.kind}</code></td>
                      <td className="text-accent-green">{d.asset}</td>
                      <td className="text-right">{d.trades_in_window}</td>
                      <td className="text-right">{fmt(d.realized_pnl_in_window, 2)}</td>
                      <td className="text-zinc-500">{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Blocked ({blacklist.length})</p>
              <table className="w-full text-xs">
                <thead className="text-zinc-500"><tr><th className="text-left">kind</th><th className="text-left">asset</th><th className="text-right">N</th><th className="text-right">PnL</th><th>reason</th></tr></thead>
                <tbody>
                  {blacklist.map((d) => (
                    <tr key={`${d.kind}::${d.asset}`} className="border-t border-ink-800">
                      <td><code>{d.kind}</code></td>
                      <td className="text-accent-red">{d.asset}</td>
                      <td className="text-right">{d.trades_in_window}</td>
                      <td className="text-right">{fmt(d.realized_pnl_in_window, 2)}</td>
                      <td className="text-zinc-500">{d.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, hint, pass }: { label: string; value: string; hint?: string; pass?: boolean }) {
  const color = pass === undefined ? "" : pass ? "text-accent-green" : "text-accent-red";
  return (
    <div className="rounded border border-ink-800 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
      {hint && <div className="text-xs text-zinc-600 mt-1">{hint}</div>}
    </div>
  );
}
