/**
 * worker:stake-promoter — auto-step entry_size_usd on proven winners.
 *
 * Implements the staged-stake ladder from
 * docs/prds/staged-stake-consistent-winner-2026-05-30.md:
 *
 *   Phase 1  $2  → Phase 2  $5   when ≥50 trades AND win% ≥ 94% (rolling 50)
 *   Phase 2  $5  → Phase 3  $10  when ≥150 trades AND win% ≥ 94% AND PnL > 0
 *   Phase 3  $10 → Phase 4  $20  when ≥300 trades AND win% ≥ 94% AND PnL ≥ $50
 *   Phase 4  $20 → real-money    eligible (operator manually flips ALLOW_TRADE=1)
 *
 * Win rate is computed over the last 50 closed exits (rolling), not lifetime.
 * This avoids an early lucky streak permanently inflating an agent's stats.
 *
 * Scans the consistent-winner cohort (v1 + v2 tags) every N hours. For each
 * child that cleared the threshold, mutates genome_json.params.entry_size_usd
 * to the next tier and emits a `stake-promoted` evolution event.
 *
 * NEVER auto-demotes — operator must manually intervene if win% drops post-promotion.
 *
 * Usage:
 *   npm run worker:stake-promoter             # forever, default 4h cadence
 *   npm run worker:stake-promoter -- --once   # single pass, then exit
 */
import "./_env.ts";
import { db } from "../src/lib/db/client.ts";
import { insertEvolutionEvent } from "../src/lib/db/queries.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const intervalHours = Math.max(0.5, Number(arg("interval-hours", "4")));
const runOnce = flag("once");

const COHORT_TAGS = ["consistent-winner-2026-05-30", "consistent-winner-v2-2026-05-30"];
const ROLLING_WINDOW = 50;
const MIN_WIN_RATE = 0.94;

type Phase = { from: number; to: number; minTrades: number; minPnl: number };
const PHASES: Phase[] = [
  { from: 2,  to: 5,  minTrades: 50,  minPnl: 0   },
  { from: 5,  to: 10, minTrades: 150, minPnl: 0   },
  { from: 10, to: 20, minTrades: 300, minPnl: 50  },
];

type CandidateRow = {
  id: number;
  name: string;
  introduced_by: string;
  genome_json: string;
  trades_count: number;
  wins_count: number;
  realized_pnl_usd: number;
};

function loadCandidates(): CandidateRow[] {
  const placeholders = COHORT_TAGS.map(() => "?").join(",");
  return db()
    .prepare(
      `SELECT id, name, introduced_by, genome_json, trades_count, wins_count, realized_pnl_usd
         FROM paper_agents
        WHERE alive = 1
          AND introduced_by IN (${placeholders})
        ORDER BY id`,
    )
    .all(...COHORT_TAGS) as CandidateRow[];
}

function rollingWinRate(agentId: number, window: number): { trades: number; wins: number; rate: number } {
  // Pull the last N CLOSED exit trades (intent='exit' is the row that has
  // realized_pnl_usd set; entries don't). win = realized_pnl_usd > 0.
  const rows = db()
    .prepare(
      `SELECT realized_pnl_usd FROM paper_trades
        WHERE paper_agent_id = ? AND intent = 'exit'
        ORDER BY id DESC LIMIT ?`,
    )
    .all(agentId, window) as Array<{ realized_pnl_usd: number | null }>;
  let trades = 0, wins = 0;
  for (const r of rows) {
    if (r.realized_pnl_usd == null) continue;
    trades += 1;
    if (r.realized_pnl_usd > 0) wins += 1;
  }
  return { trades, wins, rate: trades > 0 ? wins / trades : 0 };
}

function parseGenomeRaw(json: string): { kind: string; params: Record<string, unknown> } | null {
  try {
    const g = JSON.parse(json);
    if (typeof g?.kind !== "string" || typeof g?.params !== "object") return null;
    return { kind: g.kind, params: g.params };
  } catch {
    return null;
  }
}

function currentStake(genome: { params: Record<string, unknown> }): number {
  const v = Number(genome.params.entry_size_usd);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function findNextPhase(currentStakeUsd: number): Phase | null {
  return PHASES.find((p) => p.from === currentStakeUsd) ?? null;
}

function updateStake(agentId: number, genome: { kind: string; params: Record<string, unknown> }, newStake: number): void {
  const newParams = { ...genome.params, entry_size_usd: newStake };
  const newJson = JSON.stringify({ kind: genome.kind, params: newParams });
  db().prepare(`UPDATE paper_agents SET genome_json = ?, updated_at = datetime('now') WHERE id = ?`).run(newJson, agentId);
}

type PassResult = { scanned: number; eligible: number; promoted: number; promotions: Array<{ id: number; name: string; from: number; to: number; rolling: { trades: number; wins: number; rate: number }; lifetime_pnl: number }> };

function pass(): PassResult {
  const cands = loadCandidates();
  const promotions: PassResult["promotions"] = [];
  let eligible = 0;

  for (const row of cands) {
    const genome = parseGenomeRaw(row.genome_json);
    if (!genome) continue;
    const stake = currentStake(genome);
    const phase = findNextPhase(stake);
    if (!phase) continue;          // Already at top tier ($20) or off-ladder.

    // Rolling-window win rate is the actionable metric, not lifetime.
    const rolling = rollingWinRate(row.id, ROLLING_WINDOW);
    if (rolling.trades < ROLLING_WINDOW) continue;        // Not enough sample.
    if (row.trades_count < phase.minTrades) continue;     // Lifetime trade gate.
    if (row.realized_pnl_usd < phase.minPnl) continue;    // PnL floor.
    if (rolling.rate < MIN_WIN_RATE) continue;            // The hard 94% floor.

    eligible += 1;
    updateStake(row.id, genome, phase.to);
    promotions.push({
      id: row.id,
      name: row.name,
      from: phase.from,
      to: phase.to,
      rolling,
      lifetime_pnl: row.realized_pnl_usd,
    });

    insertEvolutionEvent({
      event_type: "stake-promoted",
      summary: `agent #${row.id} ${row.name.slice(0, 32)} stake $${phase.from} → $${phase.to} (rolling win=${(rolling.rate * 100).toFixed(1)}% over ${rolling.trades}, lifetime trades=${row.trades_count}, lifetime PnL=$${row.realized_pnl_usd.toFixed(2)})`,
      payload_json: JSON.stringify({
        agent_id: row.id,
        name: row.name,
        introduced_by: row.introduced_by,
        from_stake_usd: phase.from,
        to_stake_usd: phase.to,
        rolling_window: ROLLING_WINDOW,
        rolling_trades: rolling.trades,
        rolling_wins: rolling.wins,
        rolling_win_rate: rolling.rate,
        lifetime_trades: row.trades_count,
        lifetime_pnl_usd: row.realized_pnl_usd,
      }),
    });
  }

  return { scanned: cands.length, eligible, promoted: promotions.length, promotions };
}

function logPass(r: PassResult): void {
  const ts = new Date().toISOString().slice(11, 19);
  if (r.promoted === 0) {
    console.log(`[stake-promoter] ${ts} scanned=${r.scanned} eligible=0 promoted=0 (no agents cleared the 94% rolling-win-rate gate yet)`);
    return;
  }
  console.log(`[stake-promoter] ${ts} scanned=${r.scanned} promoted=${r.promoted}:`);
  for (const p of r.promotions) {
    console.log(`  → #${p.id} ${p.name}  $${p.from} → $${p.to}  rolling=${p.rolling.wins}/${p.rolling.trades} (${(p.rolling.rate * 100).toFixed(1)}%)  pnl=$${p.lifetime_pnl.toFixed(2)}`);
  }
}

console.log(`[stake-promoter] starting (interval=${intervalHours}h once=${runOnce} window=${ROLLING_WINDOW} min_win_rate=${MIN_WIN_RATE})`);
logPass(pass());

if (!runOnce) {
  setInterval(() => logPass(pass()), intervalHours * 3_600_000);
  process.on("SIGINT", () => { console.log("\n[stake-promoter] SIGINT — stopping"); process.exit(0); });
  process.on("unhandledRejection", (reason) => {
    console.error("[stake-promoter] unhandledRejection:", (reason as Error)?.message?.slice(0, 200) ?? reason);
  });
}
