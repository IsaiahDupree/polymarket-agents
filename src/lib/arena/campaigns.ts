/**
 * Training campaigns — produce many agent candidates at once.
 *
 * A campaign generates N variants of a target genome kind, backtests each
 * over a historical window, and inserts the top-K as paper_agents tagged
 * with `introduced_by='campaign-<id>'`. The factory output.
 *
 * Variant generation has two modes:
 *   - Random: N fresh genomes of the target kind (via randomGenome())
 *   - Sweep (when base_agent_id is set): N perturbations of that agent's genome
 *
 * Workers run synchronously inside runCampaign(). For UI integration, the
 * API endpoint fires this as a non-awaited promise so the HTTP request
 * returns immediately with the campaign id. Caller polls GET to check
 * status + read candidates.
 */
import { db } from "@/lib/db/client";
import {
  GENOME_KINDS,
  parseGenome,
  randomGenome,
  serializeGenome,
  type Genome,
  type GenomeKind,
} from "./genome";
import { simulateAgentReplay } from "./training";
import { insertPaperAgent, markElite } from "./db";
import { graduateCandidate } from "./graduation";

export type CampaignRow = {
  id: number;
  name: string;
  kind: string;
  asset_filter: string | null;
  from_iso: string;
  to_iso: string;
  variants: number;
  per_pct: number;
  base_agent_id: number | null;
  status: string;
  candidates_produced: number;
  best_candidate_id: number | null;
  best_pnl_usd: number | null;
  best_fitness: number | null;
  charter: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
};

export type CandidateRow = {
  id: number;
  campaign_id: number;
  rank: number;
  genome_json: string;
  pnl_usd: number;
  pnl_pct: number;
  trades_count: number;
  wins_count: number;
  max_dd_pct: number;
  fitness: number;
  paper_agent_id: number | null;
  notes: string | null;
  created_at: string;
};

export type CreateCampaignInput = {
  name: string;
  kind: GenomeKind;
  assetFilter?: string;       // 'BTC' | 'ETH' | etc.
  fromIso: string;
  toIso: string;
  variants: number;            // 1..1000
  perPct?: number;             // sweep mode
  baseAgentId?: number;        // sweep mode anchor
  charter?: string;
  topKToSeed?: number;         // how many of the top candidates become paper_agents (default 0 = none)
  autoSeed?: boolean;          // shortcut: seed top 5
};

/** Insert the campaign row in `queued` state, return its id. */
export function createCampaign(input: CreateCampaignInput): number {
  if (input.variants < 1 || input.variants > 1000) {
    throw new Error(`variants must be 1..1000 (got ${input.variants})`);
  }
  if (!GENOME_KINDS.includes(input.kind)) {
    throw new Error(`unknown kind=${input.kind}`);
  }
  const result = db()
    .prepare(
      `INSERT INTO training_campaigns
         (name, kind, asset_filter, from_iso, to_iso, variants, per_pct,
          base_agent_id, status, charter)
       VALUES (@name, @kind, @asset_filter, @from_iso, @to_iso, @variants, @per_pct,
               @base_agent_id, 'queued', @charter)`,
    )
    .run({
      name: input.name,
      kind: input.kind,
      asset_filter: input.assetFilter ?? null,
      from_iso: input.fromIso,
      to_iso: input.toIso,
      variants: input.variants,
      per_pct: input.perPct ?? 0.20,
      base_agent_id: input.baseAgentId ?? null,
      charter: input.charter ?? null,
    });
  return Number(result.lastInsertRowid);
}

/**
 * Execute the campaign synchronously: generate variants, backtest each,
 * insert candidates, update campaign status. Safe to call inside a
 * fire-and-forget promise from an HTTP handler.
 *
 * `topKToSeed` (or `autoSeed=true` shortcut for 5) controls how many
 * top-ranked candidates get materialized as paper_agents rows so the operator
 * can find them on /arena/high-pnl-agents.
 */
export function runCampaign(campaignId: number, topKToSeed = 0): void {
  const handle = db();
  const row = handle
    .prepare(`SELECT * FROM training_campaigns WHERE id = ?`)
    .get(campaignId) as CampaignRow | undefined;
  if (!row) throw new Error(`campaign ${campaignId} not found`);
  if (row.status !== "queued" && row.status !== "failed") {
    throw new Error(`campaign ${campaignId} status=${row.status}; cannot run`);
  }

  handle
    .prepare(`UPDATE training_campaigns SET status = 'running', started_at = datetime('now') WHERE id = ?`)
    .run(campaignId);

  try {
    // Build variant genomes.
    const variants: Genome[] = [];
    const rng = Math.random;
    if (row.base_agent_id != null) {
      // Sweep mode: ±per_pct on each numeric param of base agent's genome.
      const base = handle
        .prepare(`SELECT genome_json FROM paper_agents WHERE id = ?`)
        .get(row.base_agent_id) as { genome_json: string } | undefined;
      if (!base) throw new Error(`base_agent_id=${row.base_agent_id} not found`);
      const baseGenome = parseGenome(base.genome_json);
      variants.push(...generateSweepVariants(baseGenome, row.variants, row.per_pct, rng));
    } else {
      // Random mode: N fresh genomes of this kind.
      for (let i = 0; i < row.variants; i++) {
        variants.push(randomGenome(rng, row.kind as GenomeKind));
      }
    }

    // Backtest each. We use the first existing agent of this kind as a
    // genome carrier — simulateAgentReplay needs an agent_id to load
    // baseline metadata (cash_usd_start, name, etc.), then overrides the
    // genome. If no such agent exists, fall back to agent_id=1 (any alive).
    const carrier = pickCarrierAgent(row.kind);
    if (!carrier) throw new Error(`no carrier agent available to host backtests`);

    // Consistent-winner override: when CAMPAIGN_FORCE_ENTRY_SIZE_USD is set,
    // clamp every variant's entry_size_usd to that value before backtesting.
    // The user has burned $2-stake / $0.30-target / 5-min-binary as THE
    // operating profile (see docs/prds/consistent-winner-generation-2026-05-30.md);
    // the factory worker sets this env so every new variant inherits the contract.
    const forceEntrySize = Number(process.env.CAMPAIGN_FORCE_ENTRY_SIZE_USD ?? "");
    if (Number.isFinite(forceEntrySize) && forceEntrySize > 0) {
      for (const g of variants) {
        const p = (g as { params?: Record<string, unknown> }).params;
        if (p && "entry_size_usd" in p) {
          (p as { entry_size_usd: number }).entry_size_usd = forceEntrySize;
        }
      }
    }
    // Same for the consistent-winner price band — when CAMPAIGN_FORCE_PRICE_BAND=1,
    // clamp max_yes_price_for_buy to [0.85, 0.92] and min_yes_price_for_sell to
    // [0.08, 0.15]. Otherwise variants explore freely. Only applies to
    // poly_short_binary_directional (the kind the consistent-winner PRD targets).
    if (process.env.CAMPAIGN_FORCE_PRICE_BAND === "1") {
      for (const g of variants) {
        if ((g as { kind: string }).kind !== "poly_short_binary_directional") continue;
        const p = (g as { params: Record<string, unknown> }).params;
        const yesBuy = Number(p.max_yes_price_for_buy);
        if (!Number.isFinite(yesBuy) || yesBuy < 0.85 || yesBuy > 0.92) {
          p.max_yes_price_for_buy = 0.85 + Math.random() * (0.92 - 0.85);
        }
        const noSell = Number(p.min_yes_price_for_sell);
        if (!Number.isFinite(noSell) || noSell < 0.08 || noSell > 0.15) {
          p.min_yes_price_for_sell = 0.08 + Math.random() * (0.15 - 0.08);
        }
      }
    }

    type Result = {
      genome: Genome;
      pnl_usd: number;
      pnl_pct: number;
      trades_count: number;
      wins_count: number;
      max_dd_pct: number;
      fitness: number;
    };
    const results: Result[] = [];
    for (const g of variants) {
      try {
        const summary = simulateAgentReplay({
          agentId: carrier,
          fromIso: row.from_iso,
          toIso: row.to_iso,
          genomeOverride: g,
          equityCurveStride: 9999, // skip equity curve to save memory
        });
        results.push({
          genome: g,
          pnl_usd: summary.pnl_usd,
          pnl_pct: summary.pnl_pct,
          trades_count: summary.trades_count,
          wins_count: summary.wins_count,
          max_dd_pct: summary.max_dd_pct,
          fitness: summary.fitness,
        });
      } catch (err) {
        console.error(`[campaign ${campaignId}] variant failed: ${(err as Error).message}`);
      }
    }

    // Multi-objective composite score — rewards PnL AND trade volume AND
    // consistency, NOT just PnL. The factor weights are operator-tunable
    // via env so tonight's tuning can flow into tomorrow's training
    // without redeploying. Default weights:
    //   0.50 × pnl_pct
    //   0.25 × min(trades / 30, 1)         (saturates at 30 trades over the window)
    //   0.20 × win_rate
    //  -0.10 × max_dd_pct                   (penalty)
    //
    // When CAMPAIGN_SCORE_FN=pnl (default), still sort by pnl_usd so
    // existing callers behave identically.
    const scoreFn = process.env.CAMPAIGN_SCORE_FN ?? "pnl";
    type ScoredResult = (typeof results)[number] & { composite_score: number };
    const scored: ScoredResult[] = results.map((r) => {
      const wPnl = Number(process.env.CAMPAIGN_W_PNL ?? "0.50");
      const wTrades = Number(process.env.CAMPAIGN_W_TRADES ?? "0.25");
      const wWinRate = Number(process.env.CAMPAIGN_W_WIN_RATE ?? "0.20");
      const wDd = Number(process.env.CAMPAIGN_W_DD ?? "0.10");
      const tradesSat = Math.min(r.trades_count / 30, 1);
      const winRate = r.trades_count > 0 ? r.wins_count / r.trades_count : 0;
      const composite = wPnl * r.pnl_pct + wTrades * tradesSat + wWinRate * winRate - wDd * r.max_dd_pct;
      return { ...r, composite_score: composite };
    });
    if (scoreFn === "composite") {
      scored.sort((a, b) => b.composite_score - a.composite_score);
    } else {
      scored.sort((a, b) => b.pnl_usd - a.pnl_usd);
    }
    // Replace the unscored array with the scored one so downstream insert + seed
    // logic uses the ranking just computed.
    const rankedResults = scored;

    // Persist candidates + optionally seed top-K as paper_agents.
    const seedCount = topKToSeed > 0 ? topKToSeed : 0;
    const candidateInsert = handle.prepare(
      `INSERT INTO training_campaign_candidates
         (campaign_id, rank, genome_json, pnl_usd, pnl_pct, trades_count, wins_count,
          max_dd_pct, fitness, paper_agent_id, notes)
       VALUES (@campaign_id, @rank, @genome_json, @pnl_usd, @pnl_pct, @trades_count,
               @wins_count, @max_dd_pct, @fitness, @paper_agent_id, @notes)`,
    );

    let bestCandidateAgentId: number | null = null;
    const tx = handle.transaction(() => {
      rankedResults.forEach((r, idx) => {
        const rank = idx + 1;
        let paperAgentId: number | null = null;
        if (rank <= seedCount) {
          paperAgentId = seedAsPaperAgent({
            campaignId,
            rank,
            campaignName: row.name,
            genome: r.genome,
          });
          if (rank === 1) bestCandidateAgentId = paperAgentId;
        }
        candidateInsert.run({
          campaign_id: campaignId,
          rank,
          genome_json: serializeGenome(r.genome),
          pnl_usd: r.pnl_usd,
          pnl_pct: r.pnl_pct,
          trades_count: r.trades_count,
          wins_count: r.wins_count,
          max_dd_pct: r.max_dd_pct,
          fitness: r.fitness,
          paper_agent_id: paperAgentId,
          notes: rank === 1 ? "best by lifetime PnL" : null,
        });
      });
    });
    tx();

    const best = rankedResults[0];
    handle
      .prepare(
        `UPDATE training_campaigns
            SET status = 'done',
                candidates_produced = @n,
                best_candidate_id = @best_id,
                best_pnl_usd = @best_pnl,
                best_fitness = @best_fit,
                ended_at = datetime('now')
          WHERE id = @id`,
      )
      .run({
        id: campaignId,
        n: rankedResults.length,
        best_id: bestCandidateAgentId,
        best_pnl: best?.pnl_usd ?? null,
        best_fit: best?.fitness ?? null,
      });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    handle
      .prepare(`UPDATE training_campaigns SET status = 'failed', error = ?, ended_at = datetime('now') WHERE id = ?`)
      .run(msg, campaignId);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Internals

function pickCarrierAgent(kind: string): number | null {
  // First preference: any alive agent whose genome.kind matches.
  const handle = db();
  const candidate = handle
    .prepare(
      `SELECT id FROM paper_agents
        WHERE alive = 1 AND json_extract(genome_json, '$.kind') = ?
        ORDER BY trades_count DESC LIMIT 1`,
    )
    .get(kind) as { id: number } | undefined;
  if (candidate) return candidate.id;
  // Fallback: any alive agent.
  const fallback = handle
    .prepare(`SELECT id FROM paper_agents WHERE alive = 1 ORDER BY id ASC LIMIT 1`)
    .get() as { id: number } | undefined;
  return fallback?.id ?? null;
}

function generateSweepVariants(
  base: Genome,
  count: number,
  perPct: number,
  rng: () => number,
): Genome[] {
  if ((base as any).kind === "multi_strategy") return [base];
  const params = (base as any).params as Record<string, unknown>;
  const numericKeys = Object.entries(params)
    .filter(([k, v]) => k !== "entry_size_usd" && typeof v === "number" && Number.isFinite(v) && v !== 0)
    .map(([k]) => k);
  if (numericKeys.length === 0) return [base];

  const out: Genome[] = [];
  for (let i = 0; i < count; i++) {
    const newParams = { ...params };
    // Perturb each numeric param by a random amount in ±perPct.
    for (const key of numericKeys) {
      const v = newParams[key] as number;
      const delta = (rng() * 2 - 1) * perPct;  // uniform in [-perPct, +perPct]
      newParams[key] = v * (1 + delta);
    }
    out.push({ kind: (base as any).kind, params: newParams } as Genome);
  }
  return out;
}

function seedAsPaperAgent({
  campaignId,
  rank,
  campaignName,
  genome,
}: { campaignId: number; rank: number; campaignName: string; genome: Genome }): number {
  // Get the current generation for the new agent. A generation is "open"
  // when sealed_at is NULL — there's no status column on paper_generations.
  const gen = db()
    .prepare(`SELECT gen_number FROM paper_generations WHERE sealed_at IS NULL ORDER BY id DESC LIMIT 1`)
    .get() as { gen_number: number } | undefined;
  const generation = gen?.gen_number ?? 0;
  const id = insertPaperAgent({
    name: `campaign-${campaignId}-${rank}-${campaignName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 16)}`,
    generation,
    parent_paper_agent_id: null,
    genome,
    introduced_by: `campaign-${campaignId}`,
    cash_usd_start: 1000,
  });
  // Mark top-3 elite so they survive gen culls.
  if (rank <= 3) markElite(id);
  // Auto-stage as a paper capsule so forward PnL starts accumulating and the
  // graduation worker can pick it up. Best-effort — capsule creation failure
  // shouldn't take down the whole campaign.
  try {
    graduateCandidate(id, { capsuleName: `campaign-${campaignId}-r${rank}` });
  } catch (err) {
    console.error(`[campaign ${campaignId}] graduateCandidate failed for agent #${id}: ${(err as Error).message}`);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Read helpers (used by API/UI)

export function getCampaign(id: number): CampaignRow | null {
  return (db().prepare(`SELECT * FROM training_campaigns WHERE id = ?`).get(id) as CampaignRow | undefined) ?? null;
}

export function listCampaigns(limit = 50): CampaignRow[] {
  return db()
    .prepare(`SELECT * FROM training_campaigns ORDER BY id DESC LIMIT ?`)
    .all(limit) as CampaignRow[];
}

export function listCandidatesForCampaign(campaignId: number, limit = 100): CandidateRow[] {
  return db()
    .prepare(
      `SELECT * FROM training_campaign_candidates
        WHERE campaign_id = ? ORDER BY rank ASC LIMIT ?`,
    )
    .all(campaignId, limit) as CandidateRow[];
}
