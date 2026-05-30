/**
 * MCP server — expose the factory's read + write surface as Model Context
 * Protocol tools so an LLM agent (Claude Code, Claude Desktop, custom) can
 * drive training campaigns + cohort inspection + backtests directly.
 *
 * Transport: stdio (run as `npm run mcp:serve` from the repo root; the MCP
 * client launches this process and talks JSON-RPC over stdin/stdout).
 *
 * Tools exposed:
 *   - list_cohorts             — group-by introduced_by view of all agents
 *   - get_cohort               — drill into one cohort
 *   - list_campaigns           — recent training campaigns
 *   - get_campaign             — single campaign + its candidates
 *   - create_campaign          — kick off a new training campaign
 *   - backtest_agent           — backtest one agent over a date range
 *   - run_graduation_pass      — manual graduation-eligibility pass
 *   - list_top_agents          — top-N paper_agents by lifetime PnL
 *
 * Read-only by default — only create_campaign mutates state (and only by
 * inserting rows; live trading is still gated by ALLOW_TRADE=0).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { db } from "@/lib/db/client";
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  listCandidatesForCampaign,
  runCampaign,
  type CreateCampaignInput,
} from "@/lib/arena/campaigns";
import {
  getCohort,
  listCohorts,
  listCohortAgents,
  getCohortGraduationStats,
} from "@/lib/arena/cohorts";
import { simulateAgentReplay } from "@/lib/arena/training";
import { runGraduationPass } from "@/lib/arena/graduation";
import { GENOME_KINDS, type GenomeKind } from "@/lib/arena/genome";

const server = new Server(
  { name: "polymarket-factory", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

// --- Tool definitions ------------------------------------------------------

const tools = [
  {
    name: "list_cohorts",
    description: "List all agent cohorts (groups by introduced_by tag), ranked by total lifetime PnL. A cohort is any batch — archetype seeds, training-campaign output, evolved survivors.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "max cohorts to return (default 50)" } } },
  },
  {
    name: "get_cohort",
    description: "Drill into one cohort: header stats + all agents sorted by lifetime PnL + capsule + graduation status.",
    inputSchema: { type: "object", required: ["cohort"], properties: { cohort: { type: "string" }, limit: { type: "number" } } },
  },
  {
    name: "list_campaigns",
    description: "List recent training campaigns.",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  },
  {
    name: "get_campaign",
    description: "Single campaign + its ranked candidates.",
    inputSchema: { type: "object", required: ["id"], properties: { id: { type: "number" } } },
  },
  {
    name: "create_campaign",
    description: `Kick off a new training campaign synchronously. Returns campaign id and final ranked candidates. Genome kinds: ${GENOME_KINDS.join(", ")}.`,
    inputSchema: {
      type: "object",
      required: ["name", "kind", "from", "to"],
      properties: {
        name: { type: "string", description: "human-readable label" },
        kind: { type: "string", description: "genome kind to vary (must be a valid GENOME_KIND)" },
        asset: { type: "string", description: "asset filter, e.g. 'BTC' (optional)" },
        from: { type: "string", description: "ISO timestamp" },
        to: { type: "string", description: "ISO timestamp" },
        variants: { type: "number", description: "number of variants (1..1000, default 50)" },
        topKToSeed: { type: "number", description: "seed top-K candidates as paper_agents (default 0)" },
        autoSeed: { type: "boolean", description: "shortcut: seed top 5" },
        charter: { type: "string", description: "free-form notes" },
        baseAgentId: { type: "number", description: "if set, sweep this agent's genome instead of generating random" },
      },
    },
  },
  {
    name: "backtest_agent",
    description: "Replay an agent's genome over a historical window. Returns PnL, trades, win rate, max DD, fitness.",
    inputSchema: {
      type: "object",
      required: ["agentId", "from", "to"],
      properties: {
        agentId: { type: "number" },
        from: { type: "string", description: "ISO timestamp" },
        to: { type: "string", description: "ISO timestamp" },
        tickIntervalMin: { type: "number", description: "default 5" },
      },
    },
  },
  {
    name: "run_graduation_pass",
    description: "Scan paper-staged capsules from campaign cohorts, emit graduation-eligible events for any that cleared the PnL + trades thresholds. Returns scan stats + ranked candidates.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_top_agents",
    description: "Top-N alive paper_agents by lifetime PnL with capsule status.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number" },
        excludeCohorts: { type: "array", items: { type: "string" }, description: "introduced_by values to skip (e.g. ['archetype-prd-2026-05-29'])" },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

// --- Tool dispatch ---------------------------------------------------------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "list_cohorts": {
        const limit = Number(args.limit ?? 50);
        const rows = listCohorts(limit);
        return ok(rows);
      }
      case "get_cohort": {
        const cohort = String(args.cohort ?? "");
        const limit = Number(args.limit ?? 200);
        const header = getCohort(cohort);
        if (!header) return ok({ error: `cohort '${cohort}' not found` });
        const agents = listCohortAgents(cohort, limit);
        const graduation = getCohortGraduationStats(cohort);
        return ok({ cohort: header, graduation, agents });
      }
      case "list_campaigns": {
        const limit = Number(args.limit ?? 50);
        return ok(listCampaigns(limit));
      }
      case "get_campaign": {
        const id = Number(args.id);
        const campaign = getCampaign(id);
        if (!campaign) return ok({ error: `campaign ${id} not found` });
        const candidates = listCandidatesForCampaign(id, 100);
        return ok({ campaign, candidates });
      }
      case "create_campaign": {
        const input = z.object({
          name: z.string().min(3),
          kind: z.enum(GENOME_KINDS as unknown as readonly [string, ...string[]]),
          asset: z.string().optional(),
          from: z.string(),
          to: z.string(),
          variants: z.number().int().min(1).max(1000).default(50),
          topKToSeed: z.number().int().min(0).max(50).default(0),
          autoSeed: z.boolean().default(false),
          charter: z.string().optional(),
          baseAgentId: z.number().int().optional(),
        }).parse(args);
        const createInput: CreateCampaignInput = {
          name: input.name,
          kind: input.kind as GenomeKind,
          assetFilter: input.asset,
          fromIso: input.from,
          toIso: input.to,
          variants: input.variants,
          baseAgentId: input.baseAgentId,
          charter: input.charter,
          topKToSeed: input.autoSeed ? 5 : input.topKToSeed,
        };
        const id = createCampaign(createInput);
        runCampaign(id, createInput.topKToSeed ?? 0);
        return ok({ campaign_id: id, summary: getCampaign(id), candidates: listCandidatesForCampaign(id, 100) });
      }
      case "backtest_agent": {
        const input = z.object({
          agentId: z.number().int(),
          from: z.string(),
          to: z.string(),
          tickIntervalMin: z.number().int().min(1).default(5),
        }).parse(args);
        const summary = simulateAgentReplay({
          agentId: input.agentId,
          fromIso: input.from,
          toIso: input.to,
          tickIntervalMin: input.tickIntervalMin,
          equityCurveStride: 9999,
        });
        // Strip the equity_curve from the response to keep it compact for MCP transport.
        const { equity_curve: _ec, ...compact } = summary;
        return ok(compact);
      }
      case "run_graduation_pass": {
        return ok(runGraduationPass());
      }
      case "list_top_agents": {
        const limit = Number(args.limit ?? 20);
        const exclude = Array.isArray(args.excludeCohorts) ? (args.excludeCohorts as string[]) : [];
        const placeholders = exclude.map(() => "?").join(",");
        const sql = `
          WITH latest_caps AS (
            SELECT id, paper_agent_id, status, capital_allocated_usd,
                   ROW_NUMBER() OVER (PARTITION BY paper_agent_id ORDER BY updated_at DESC, id DESC) AS rn
              FROM capsules WHERE paper_agent_id IS NOT NULL
          )
          SELECT pa.id, pa.name, pa.generation, pa.is_elite, pa.introduced_by,
                 pa.trades_count, pa.wins_count,
                 (pa.cash_usd_current + pa.unrealized_pnl_usd
                   + IFNULL((SELECT SUM(json_extract(value, '$.size_usd'))
                               FROM json_each(pa.position_basket_json)), 0)
                   - pa.cash_usd_start) AS lifetime_pnl,
                 c.id AS capsule_id, c.status AS capsule_status, c.capital_allocated_usd AS capsule_capital,
                 json_extract(pa.genome_json, '$.kind') AS genome_kind
            FROM paper_agents pa
            LEFT JOIN latest_caps c ON c.paper_agent_id = pa.id AND c.rn = 1
           WHERE pa.alive = 1
             ${exclude.length ? `AND (pa.introduced_by IS NULL OR pa.introduced_by NOT IN (${placeholders}))` : ""}
           ORDER BY lifetime_pnl DESC LIMIT ?
        `;
        const rows = db().prepare(sql).all(...exclude, limit);
        return ok(rows);
      }
      default:
        return ok({ error: `unknown tool: ${name}` }, true);
    }
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return ok({ error: msg }, true);
  }
});

function ok(payload: unknown, isError = false) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(payload, null, 2) },
    ],
    isError,
  };
}

// --- Boot ------------------------------------------------------------------

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  // Log to stderr only — stdout is reserved for MCP protocol frames.
  console.error("[mcp] polymarket-factory ready");
}).catch((err) => {
  console.error("[mcp] fatal:", (err as Error).message);
  process.exit(1);
});
