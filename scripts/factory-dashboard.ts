/**
 * factory-dashboard — live progress + ETA view for both factories.
 *
 * Pulls live stats from the SQLite DB + factory state file every
 * REFRESH_MS (default 5s). Renders:
 *
 *   - Distance to 90% win-rate target (progress bar)
 *   - Win-rate distribution across alive agents (histogram)
 *   - Top 5 agents leaderboard
 *   - Per-factory cycle ETAs (next fast / deep / champion)
 *   - Recent campaigns (last hour) with PnL
 *   - Linear projection of when current rate hits 90 % (if improving)
 *
 * Read-only — no DB writes, no side effects on the running factories.
 *
 * Usage:
 *   npm run factory:dashboard          # forever, 5s refresh, Ctrl-C to exit
 *   npm run factory:dashboard:once     # one render then exit (good for cron / sanity)
 */
import "./_env.ts";
import { resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import { db } from "../src/lib/db/client.ts";
import {
  readState, isAlive, formatDuration,
  type FactoryName,
} from "../src/lib/factory/state.ts";
import {
  winRateHistogram, topAgents, bestWinRate,
  progressBar, nextCycleEtaMs, formatEta, projectDaysToTarget,
  type AgentRow,
} from "../src/lib/factory/stats.ts";

const STATE_PATH = resolve("data/factory-state.json");
const REFRESH_MS = Number(process.env.FACTORY_DASHBOARD_REFRESH_MS ?? "5000");

// Match the gate defaults wired into graduation.ts / auto-promote.ts.
const TARGET_WIN_RATE = Number(process.env.GRADUATION_MIN_WIN_RATE ?? "0.90");
const MIN_TRADES_FOR_RANKING = Number(process.env.ARENA_MIN_TRADES_FOR_RANKING ?? "30");

const FACTORY_LABELS: Record<FactoryName, string> = {
  "btc-5m": "BTC 5m (poly_short_binary_directional)",
  multi:    "Multi-kind (12 strategies)",
};

// Match the cadence in worker-btc-5m-factory.ts / worker-multi-kind-factory.ts.
const FAST_INTERVAL_MS = 6 * 3_600_000;
const DEEP_INTERVAL_MS = 24 * 3_600_000;
const CHAMP_INTERVAL_MS = 24 * 3_600_000;

const ESC = "\x1b[";
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}90m`;
const GREEN = `${ESC}32m`;
const YELLOW = `${ESC}33m`;
const RED = `${ESC}31m`;
const CYAN = `${ESC}36m`;

function color(text: string, c: string): string {
  return `${c}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Data fetchers

function fetchAliveAgents(): AgentRow[] {
  // Pull the genome kind out of genome_json so the leaderboard can show
  // which strategy is producing the wins. SQLite JSON1 is available
  // because the rest of the codebase relies on json_extract elsewhere.
  return db().prepare(`
    SELECT id, name, trades_count, wins_count, realized_pnl_usd,
           COALESCE(json_extract(genome_json, '$.kind'), 'unknown') AS kind
      FROM paper_agents
     WHERE alive = 1
  `).all() as AgentRow[];
}

type CampaignRow = {
  name: string;
  kind: string;
  candidates_produced: number | null;
  best_pnl_usd: number | null;
  created_at: string;
};

function fetchRecentCampaigns(limit = 8): CampaignRow[] {
  // Anything created in the last 6h. The factories typically log a
  // fast cycle every 6h so we'll see the most recent one.
  return db().prepare(`
    SELECT name, kind, candidates_produced, best_pnl_usd, created_at
      FROM training_campaigns
     WHERE created_at >= datetime('now', '-6 hours')
     ORDER BY id DESC
     LIMIT ?
  `).all(limit) as CampaignRow[];
}

/** Last-run timestamp (ms) for a campaign-name LIKE prefix, or 0 if none. */
function lastCampaignAt(prefix: string): number {
  const row = db().prepare(`
    SELECT created_at FROM training_campaigns
     WHERE name LIKE ?
     ORDER BY id DESC LIMIT 1
  `).get(`${prefix}%`) as { created_at: string } | undefined;
  if (!row) return 0;
  return Date.parse(row.created_at.replace(" ", "T") + "Z");
}

/**
 * Best win rate ~24h ago, derived from the snapshot we cache between
 * dashboard runs. The snapshot lives in memory only — across process
 * restarts the projection just won't be available until enough time
 * passes. Acceptable trade-off for a UI-only feature.
 */
type HistoryPoint = { ts: number; best: number };
const historyRing: HistoryPoint[] = [];
const HISTORY_RETENTION_MS = 48 * 3_600_000;

function recordHistory(best: number, now = Date.now()): void {
  historyRing.push({ ts: now, best });
  // Trim anything older than 48h.
  const cutoff = now - HISTORY_RETENTION_MS;
  while (historyRing.length > 0 && historyRing[0].ts < cutoff) historyRing.shift();
}

function bestApproximatelyHoursAgo(hours: number, now = Date.now()): number | null {
  if (historyRing.length === 0) return null;
  const target = now - hours * 3_600_000;
  // Find the oldest point at or after `target`, fallback to the oldest entry.
  let chosen: HistoryPoint = historyRing[0];
  for (const p of historyRing) {
    if (p.ts <= target) chosen = p;
    else break;
  }
  return chosen.best;
}

// ---------------------------------------------------------------------------
// Renderer

function clearScreen(): void {
  process.stdout.write(`${ESC}2J${ESC}H`);
}

function divider(width = 76, char = "─"): string {
  return char.repeat(width);
}

function render(): void {
  const agents = fetchAliveAgents();
  const totalAlive = agents.length;
  const qualified = agents.filter((a) => a.trades_count >= MIN_TRADES_FOR_RANKING);
  const best = bestWinRate(agents, MIN_TRADES_FOR_RANKING);
  const histogram = winRateHistogram(agents, MIN_TRADES_FOR_RANKING);
  const leaderboard = topAgents(agents, 5, MIN_TRADES_FOR_RANKING);

  recordHistory(best);
  const best24hAgo = bestApproximatelyHoursAgo(24);
  const eta = best24hAgo !== null
    ? projectDaysToTarget(best, best24hAgo, 24, TARGET_WIN_RATE)
    : null;

  const state = readState(STATE_PATH);
  const campaigns = fetchRecentCampaigns(8);

  clearScreen();
  const now = new Date().toLocaleTimeString();
  console.log(`${BOLD}╔══ FACTORY DASHBOARD ${DIM}══ ${now} ══ refresh ${REFRESH_MS / 1000}s ══ Ctrl-C to exit ══${RESET}`);
  console.log("");

  // --- Goal progress -------------------------------------------------------
  const pctBest = (best * 100).toFixed(1).padStart(5);
  const pctTarget = (TARGET_WIN_RATE * 100).toFixed(0);
  const bar = progressBar(best, TARGET_WIN_RATE, 40);
  const barColor = best >= TARGET_WIN_RATE ? GREEN : best >= 0.6 ? YELLOW : RED;
  console.log(`  ${BOLD}GOAL${RESET}  ${pctTarget}%+ win rate  ·  current best ${color(`${pctBest}%`, BOLD)}`);
  console.log(`  ${color(bar, barColor)}  ${pctBest}% / ${pctTarget}%`);
  if (eta !== null && Number.isFinite(eta)) {
    const days = eta.toFixed(1);
    console.log(`  ${DIM}Δ last 24h: +${((best - (best24hAgo ?? 0)) * 100).toFixed(2)}pp · projected ETA at current rate: ~${days} days${RESET}`);
  } else if (best24hAgo === null) {
    console.log(`  ${DIM}Δ last 24h: (not enough history yet — projection available after dashboard runs for 24h+)${RESET}`);
  } else {
    console.log(`  ${DIM}Δ last 24h: no improvement detected (best stuck at ${(best * 100).toFixed(1)}%)${RESET}`);
  }
  console.log(`  ${DIM}qualifying agents (>=${MIN_TRADES_FOR_RANKING} trades): ${qualified.length} / ${totalAlive} alive${RESET}`);
  console.log("");

  // --- Histogram -----------------------------------------------------------
  console.log(`  ${BOLD}WIN RATE DISTRIBUTION${RESET}  ${DIM}(alive · >=${MIN_TRADES_FOR_RANKING} trades only)${RESET}`);
  const maxCount = Math.max(1, ...histogram.map((b) => b.count));
  for (const b of histogram) {
    const blocks = "█".repeat(Math.round((b.count / maxCount) * 30));
    const bc = b.lo >= 0.9 ? GREEN : b.lo >= 0.6 ? YELLOW : DIM;
    console.log(`    ${b.label}  ${color(blocks.padEnd(30), bc)}  ${b.count}`);
  }
  console.log("");

  // --- Leaderboard ---------------------------------------------------------
  console.log(`  ${BOLD}TOP 5 AGENTS${RESET}  ${DIM}(by win rate · qualifying only)${RESET}`);
  if (leaderboard.length === 0) {
    console.log(`    ${DIM}(no qualifying agents yet — running until first one clears the trade floor)${RESET}`);
  } else {
    for (const a of leaderboard) {
      const wrPct = (a.win_rate * 100).toFixed(1).padStart(5);
      const wc = a.win_rate >= 0.9 ? GREEN : a.win_rate >= 0.6 ? YELLOW : DIM;
      console.log(
        `    ${color(`${wrPct}%`, wc)}` +
        `  ${a.name.slice(0, 36).padEnd(36)}` +
        `  ${a.kind.slice(0, 22).padEnd(22)}` +
        `  ${BOLD}$${a.realized_pnl_usd.toFixed(2).padStart(8)}${RESET}` +
        `  ${DIM}n=${a.trades_count}${RESET}`,
      );
    }
  }
  console.log("");

  // --- Factories + cycle ETAs ---------------------------------------------
  console.log(`  ${BOLD}FACTORIES${RESET}`);
  for (const name of ["btc-5m", "multi"] as FactoryName[]) {
    const s = state.factories[name];
    const alive = isAlive(s.pid);
    const dot = alive ? color("●", GREEN) : s.desired === "running" ? color("✗", RED) : color("○", DIM);
    const status = alive
      ? color("RUNNING", GREEN)
      : s.desired === "running" ? color("DEAD (resume to restart)", RED) : color("stopped", DIM);
    const uptime = alive && s.startedAt ? formatDuration(Date.now() - Date.parse(s.startedAt)) : "—";
    console.log(`    ${dot} ${BOLD}${name.padEnd(8)}${RESET}  ${status}  ${DIM}pid=${s.pid ?? "-"} · up ${uptime} · restarts ${s.startCount}${RESET}`);
    console.log(`      ${DIM}${FACTORY_LABELS[name]}${RESET}`);

    if (name === "btc-5m") {
      const fastEta = nextCycleEtaMs(lastCampaignAt("btc-5m-fast-"), FAST_INTERVAL_MS);
      const deepEta = nextCycleEtaMs(lastCampaignAt("btc-5m-deep-"), DEEP_INTERVAL_MS);
      const champEta = nextCycleEtaMs(lastCampaignAt("btc-5m-champ-"), CHAMP_INTERVAL_MS);
      console.log(`      ${CYAN}next:${RESET} fast ${formatEta(fastEta)}  ·  deep ${formatEta(deepEta)}  ·  champ ${formatEta(champEta)}`);
    } else {
      // Multi-factory tracks per-kind. Show aggregate ETA = min across all
      // kinds (next kind to fire). The full breakdown would be too noisy.
      const allFast: number[] = [];
      const kinds = db().prepare(`
        SELECT DISTINCT substr(name, 4, instr(substr(name, 4), '-fast-') - 1) AS slug
          FROM training_campaigns
         WHERE name LIKE 'mk-%-fast-%'
      `).all() as Array<{ slug: string }>;
      for (const k of kinds) {
        allFast.push(nextCycleEtaMs(lastCampaignAt(`mk-${k.slug}-fast-`), FAST_INTERVAL_MS));
      }
      const minFast = allFast.length > 0 ? Math.min(...allFast) : FAST_INTERVAL_MS;
      console.log(`      ${CYAN}next:${RESET} ${kinds.length} kinds tracked · next fast in ${formatEta(minFast)}`);
    }
  }
  console.log("");

  // --- Recent campaigns ----------------------------------------------------
  console.log(`  ${BOLD}RECENT CAMPAIGNS${RESET}  ${DIM}(last 6h, latest first)${RESET}`);
  if (campaigns.length === 0) {
    console.log(`    ${DIM}(no campaigns in the last 6h)${RESET}`);
  } else {
    for (const c of campaigns) {
      const produced = c.candidates_produced ?? 0;
      const best = c.best_pnl_usd ?? 0;
      const bestColor = best > 0 ? GREEN : best < 0 ? RED : DIM;
      const when = c.created_at.replace(" ", "T") + "Z";
      const ageMin = Math.round((Date.now() - Date.parse(when)) / 60_000);
      console.log(
        `    ${DIM}${ageMin.toString().padStart(3)}m ago${RESET}` +
        `  ${c.name.slice(0, 38).padEnd(38)}` +
        `  ${DIM}${c.kind.slice(0, 22).padEnd(22)}${RESET}` +
        `  prod=${String(produced).padStart(2)}` +
        `  best=${color(`$${best.toFixed(2)}`, bestColor)}`,
      );
    }
  }
  console.log("");
  console.log(`  ${DIM}${divider()}${RESET}`);
}

// ---------------------------------------------------------------------------
// Main

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  process.on("SIGINT", () => {
    process.stdout.write("\n[dashboard] exiting (Ctrl-C)\n");
    process.exit(0);
  });
  render();
  if (once) return;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await wait(REFRESH_MS);
    try { render(); } catch (err) {
      console.error(`[dashboard] render error: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(`[dashboard] fatal: ${(err as Error).message}`);
  process.exitCode = 1;
});
