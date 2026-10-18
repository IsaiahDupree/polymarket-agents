/**
 * Reconcile the 15 wallets cited in the @0x_Discover article against
 * Polymarket's actual leaderboard data.
 *
 *   npm run reconcile:0x-discover
 *
 * For each cited handle: fetch lifetime PnL from data-api, run the pure
 * reconciliation module, write evolution_log + a markdown report at
 * docs/research/0x-discover-reconciliation.md.
 *
 * Idempotent. Re-runs overwrite the markdown.
 */
import "./_env.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";
import { fetchManyWalletPnl } from "../src/lib/wallets/pnl-fetcher.ts";
import {
  reconcileWalletPnl,
  summarizeReconciliation,
  type ReconciliationVerdict,
} from "../src/lib/wallets/pnl-reconciliation.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const REPORT_PATH = resolve(REPO_ROOT, "docs/research/0x-discover-reconciliation.md");

/** The 15 handles cited in the article + their claimed PnLs. */
const CITED = [
  { handle: "kch123", claim: 12_000_000, articleLabel: "Latency arb · high frequency" },
  { handle: "RN1", claim: 7_400_000, articleLabel: "Market making · multi-market" },
  { handle: "Swisstony", claim: 5_900_000, articleLabel: "Oracle arbitrage · Chainlink" },
  { handle: "GamblingIsAllYouNeed", claim: 4_600_000, articleLabel: "News-driven · AI probability" },
  { handle: "DrPufferfish", claim: 3_400_000, articleLabel: "Combinatorial arb · multi-market" },
  { handle: "sovereign2013", claim: 3_400_000, articleLabel: "Latency arb · BTC/ETH contracts" },
  { handle: "0x2a2C53bD27", claim: 2_500_000, articleLabel: "Market rebalancing · systematic" },
  { handle: "Countryside", claim: 2_400_000, articleLabel: "Election markets · base rate" },
  { handle: "gatorr", claim: 2_300_000, articleLabel: "Latency arb · parallel execution" },
  { handle: "weflyhigh", claim: 1_800_000, articleLabel: "Multi-strategy · diversified" },
  { handle: "blindStaking", claim: 1_500_000, articleLabel: "Market making · liquidity provision" },
  { handle: "CharlieKirkEvans", claim: 1_200_000, articleLabel: "Political markets · news arb" },
  { handle: "JPMorgan101", claim: 1_100_000, articleLabel: "Institutional-style systematic" },
  { handle: "cigarettes", claim: 850_000, articleLabel: "High-frequency · short contracts" },
  { handle: "Sharky6999", claim: 813_000, articleLabel: "Latency arb · crypto contracts" },
];

console.log(`[reconcile-0x-discover] fetching PnL for ${CITED.length} wallets...`);
const handles = CITED.map((c) => c.handle);
const t0 = Date.now();
const actuals = await fetchManyWalletPnl(handles);
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[reconcile-0x-discover] fetched in ${elapsed}s`);

const verdicts: ReconciliationVerdict[] = CITED.map((c) => {
  const actual = actuals.get(c.handle) ?? null;
  return reconcileWalletPnl({
    handle: c.handle,
    claimedUsd: c.claim,
    actual,
  });
});

const summary = summarizeReconciliation(verdicts);

// Console output — quick sanity check.
console.log("");
console.log("===========================================================");
console.log(`Total wallets:      ${summary.totalWallets}`);
console.log(`Claim supported:    ${summary.claimSupported}`);
console.log(`Claim inflated:     ${summary.claimInflated}`);
console.log(`Claim understated:  ${summary.claimUnderstated}`);
console.log(`Wallet not found:   ${summary.walletNotFound}`);
console.log(`Total claimed:      $${summary.totalClaimedUsd.toLocaleString()}`);
console.log(`Total actual:       $${summary.totalActualUsd.toLocaleString()}`);
if (summary.aggregateRatio != null) {
  console.log(`Aggregate ratio:    ${summary.aggregateRatio.toFixed(3)} (actual / claimed across resolved)`);
}
console.log("===========================================================");
console.log("");

for (const v of verdicts) {
  const icon =
    v.outcome === "claim_supported" ? "✓" :
    v.outcome === "claim_inflated" ? "↓" :
    v.outcome === "claim_understated" ? "↑" :
    v.outcome === "wallet_not_found" ? "?" : "-";
  const actualStr = v.actual ? `$${(v.actual.pnlUsd / 1_000_000).toFixed(2)}M` : "—";
  const deltaStr = v.deltaPct != null ? `${v.deltaPct >= 0 ? "+" : ""}${v.deltaPct.toFixed(1)}%` : "—";
  console.log(
    `  ${icon}  ${v.handle.padEnd(22)}  claim $${(v.claimedUsd / 1_000_000).toFixed(2)}M  →  actual ${actualStr.padStart(7)}  (${deltaStr.padStart(7)})  [${v.outcome}]`,
  );
}

// Write markdown report.
const md = buildMarkdown(verdicts, summary);
mkdirSync(dirname(REPORT_PATH), { recursive: true });
writeFileSync(REPORT_PATH, md, "utf8");
console.log(`\n[reconcile-0x-discover] wrote report to ${REPORT_PATH}`);

// Write evolution_log row for the audit trail.
insertEvolutionEvent({
  event_type: "wallet-pnl-reconciliation",
  summary:
    `0x_Discover 15-bot reconciliation: ${summary.claimSupported} supported, ` +
    `${summary.claimInflated} inflated, ${summary.claimUnderstated} understated, ` +
    `${summary.walletNotFound} not found, aggregate ratio ${summary.aggregateRatio?.toFixed(3) ?? "n/a"}`,
  payload_json: JSON.stringify({ article: "0x_Discover $40M roadmap", verdicts, summary }),
});

// Also persist a quick column on tracked_wallets for surfacing in /tracked UI.
const handle = db();
const updateStmt = handle.prepare(
  `UPDATE tracked_wallets SET note = COALESCE(note, '') || ' · reconciliation: ' || ? WHERE handle = ?`,
);
for (const v of verdicts) {
  updateStmt.run(`${v.outcome} (delta ${v.deltaPct?.toFixed(1) ?? "n/a"}%)`, v.handle);
}

console.log("[reconcile-0x-discover] done.");

// ────────────────────────────────────────────────────────────────────────

function buildMarkdown(
  verdicts: ReconciliationVerdict[],
  summary: ReturnType<typeof summarizeReconciliation>,
): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push("---");
  lines.push("title: \"0x_Discover article — 15 cited wallets reconciled vs Polymarket data\"");
  lines.push("type: reconciliation-report");
  lines.push(`generated: ${now.slice(0, 10)}`);
  lines.push("source_article: docs/research/articles/0x_discover-polymarket-40m-arb.md");
  lines.push("data_source: \"https://data-api.polymarket.com/v1/leaderboard\"");
  lines.push("---");
  lines.push("");
  lines.push("# 0x_Discover article — 15 cited wallets reconciliation");
  lines.push("");
  lines.push(`Generated ${now}. Re-run via \`npm run reconcile:0x-discover\`.`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Outcome | Count |");
  lines.push("|---|---:|");
  lines.push(`| ✓ Claim supported (within ±15%) | **${summary.claimSupported}** |`);
  lines.push(`| ↓ Claim inflated (actual < claim − 15%) | **${summary.claimInflated}** |`);
  lines.push(`| ↑ Claim understated (actual > claim + 15%) | **${summary.claimUnderstated}** |`);
  lines.push(`| ? Wallet not found / no leaderboard match | **${summary.walletNotFound}** |`);
  lines.push(`| **Total** | **${summary.totalWallets}** |`);
  lines.push("");
  lines.push(`**Total claimed PnL** (article): \`$${summary.totalClaimedUsd.toLocaleString()}\``);
  lines.push(`**Total actual PnL** (leaderboard, resolved wallets only): \`$${summary.totalActualUsd.toLocaleString()}\``);
  if (summary.aggregateRatio != null) {
    lines.push(`**Aggregate ratio** (actual / claimed): \`${summary.aggregateRatio.toFixed(3)}\``);
    const pctOff = (1 - summary.aggregateRatio) * 100;
    if (Math.abs(pctOff) > 5) {
      lines.push(
        `  → The article's aggregate is ${pctOff > 0 ? "inflated" : "understated"} by ${Math.abs(pctOff).toFixed(1)}% vs current leaderboard.`,
      );
    } else {
      lines.push("  → The article's aggregate matches current leaderboard within 5%.");
    }
  }
  lines.push("");
  lines.push("## Per-wallet breakdown");
  lines.push("");
  lines.push("| # | Handle | Article claim | Actual PnL | Vol | Rank | Δ% | Outcome |");
  lines.push("|---:|---|---:|---:|---:|---:|---:|---|");
  verdicts.forEach((v, i) => {
    const claim = `$${(v.claimedUsd / 1_000_000).toFixed(2)}M`;
    const actual = v.actual ? `$${(v.actual.pnlUsd / 1_000_000).toFixed(2)}M` : "—";
    const vol = v.actual ? `$${(v.actual.volUsd / 1_000_000).toFixed(1)}M` : "—";
    const rank = v.actual?.rank != null ? `#${v.actual.rank}` : "—";
    const delta = v.deltaPct != null ? `${v.deltaPct >= 0 ? "+" : ""}${v.deltaPct.toFixed(1)}%` : "—";
    const icon =
      v.outcome === "claim_supported" ? "✓ supported" :
      v.outcome === "claim_inflated" ? "↓ inflated" :
      v.outcome === "claim_understated" ? "↑ understated" :
      v.outcome === "wallet_not_found" ? "? not found" : v.outcome;
    lines.push(`| ${i + 1} | \`${v.handle}\` | ${claim} | ${actual} | ${vol} | ${rank} | ${delta} | ${icon} |`);
  });
  lines.push("");
  lines.push("## Per-wallet rationale");
  lines.push("");
  for (const v of verdicts) {
    lines.push(`### ${v.handle}`);
    lines.push("");
    lines.push(`- ${v.rationale}`);
    if (v.actual) {
      lines.push(`- ProxyWallet: \`${v.actual.proxyWallet}\``);
      lines.push(`- userName as returned by leaderboard: \`${v.actual.userName}\``);
    }
    lines.push("");
  }
  lines.push("## Caveats");
  lines.push("");
  lines.push(
    "- The leaderboard returns LIFETIME PnL as of the query time. The article was published 2026-04-17; some wallets may have continued earning or drawn down since.",
  );
  lines.push(
    "- Handle collisions: if multiple wallets use the same userName, the leaderboard returns the highest-ranked one. The runner trusts this; if a cited bot is shadowed by a more prolific same-name wallet, the reconciliation will be misleading. Spot-check the proxyWallet against on-chain trades for any wallet where the verdict surprises you.",
  );
  lines.push(
    "- `0x2a2C53bD27` was truncated in the article; the resolver matched to a longer wallet that may or may not be the intended one. Flagged separately if the rationale notes this.",
  );
  lines.push(
    "- Polymarket's data API tolerance was not verified — the leaderboard `pnl` field may double-count fees or omit certain bonuses. For audit-grade numbers, cross-check via on-chain trades.",
  );
  return lines.join("\n");
}
