/**
 * Seed the article-triage workbench with articles already saved in
 * docs/research/articles/. Idempotent — re-runnable.
 *
 * For the 0x_Discover piece we pre-populate the gap report + 3 initial
 * todos so the workbench has substance on first open. Later articles
 * either get a hand-written gap report here too, or the operator clicks
 * "Generate gap report" on the page itself.
 */
import "./_env.ts";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  upsertArticleByTitle,
  getArticleByTitle,
  getLatestGapReport,
  saveGapReport,
  listTodos,
  addTodo,
  linkStrategyToArticle,
} from "../src/lib/articles/queries.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..");

type Seed = {
  title: string;
  source: string;
  url?: string;
  bodyFromFile: string; // path relative to repo root
  frontmatter?: Record<string, unknown>;
  gapReportMd?: string;
  todos?: Array<{ label: string; related_path?: string | null }>;
};

const SEEDS: Seed[] = [
  {
    title: "Hermes + Polymarket — how to build an AI for a self-learning BTC trading agent ($100 → $10,000)",
    source: "@0xRicker on X (Twitter)",
    url: "https://x.com/0xRicker",
    bodyFromFile: "docs/research/articles/0xricker-hermes-btc-trading-agent.md",
    frontmatter: {
      published: "2026-05-22",
      tags: ["hermes", "agentic", "btc", "markov", "kelly", "prompts"],
      promo: "Paid partnership; links to predictparity.com?code=ricky and atomicbot.ai",
      wallets_cited: ["bonereaper", "0xe1d6b51521bd4365769199f392f9818661bd907", "0xb27bc932bf8110d8f78e55da7d5f0497a18b5b82-1772569391020"],
    },
    // No hand-written gap report — click "Generate gap report" on the page
    // to have Claude produce one against current SKILL.md.
  },
  {
    title: "I Mass-Analyzed 14,000 Polymarket Wallets With Claude. Here's Guide How to Print Money.",
    source: "@LunarResearcher on X (Twitter)",
    url: "https://x.com/LunarResearcher",
    bodyFromFile: "docs/research/lunar-2026-03-30-mass-analysis.md",
    frontmatter: {
      published: "2026-03-30",
      tags: ["ev", "kelly", "bayes", "tooling", "open-source", "security"],
      promo: "Paid partnership; bio says 'all content here is sponsored or commissioned'. Multiple affiliate CTAs (kreo.app, Telegram bots).",
      wallets_cited: ["HorizonSplendidView", "beachboy4", "majorexploiter", "CemeterySun"],
    },
  },
  {
    title: "I analyzed 1000 Polymarket bots with Claude. Here's how they make $100K/month",
    source: "@Dan1ro0 on X (Twitter)",
    url: "https://x.com/Dan1ro0",
    bodyFromFile: "docs/research/daniro-2026-05-25-1000-polymarket-bots.md",
    frontmatter: {
      published: "2026-05-25",
      tags: ["arbitrage", "lag-arb", "bayes", "stoikov", "microstructure"],
      promo: "Every wallet URL has ?via=dan-kwpx referral param. Treat wallet selections as marketing curation.",
      wallets_cited: ["bonereaper", "0x6e1d5040d0ac73709b0621f620d2a60b80d2d0f", "0xb55fa1296e6ec55d0ce53d93b9237389f11764d4-1777575277609", "0xce25e214d5cfe4f459cf67f08df581885aae7fdc-1777575398144", "flippingsharks"],
    },
  },
  {
    title: "How To Use Markov Chains To Win Every Single Trade + [Quant Framework]",
    source: "@de1lymoon (Alex) on X (Twitter)",
    url: "https://x.com/de1lymoon",
    bodyFromFile: "docs/research/articles/de1lymoon-markov-chains-framework.md",
    frontmatter: {
      published: "2026-05-26",
      tags: ["markov", "monte-carlo", "kelly", "calibration", "longshot-bias", "maker-taker", "becker"],
      primary_sources: ["Jonathan Becker — 72.1M trade analysis (2026)"],
    },
  },
  {
    title: "The Exact Math That Pulled $40,000,000 from Polymarket (Full Roadmap)",
    source: "@0x_Discover on X (Twitter)",
    url: "https://x.com/0x_Discover",
    bodyFromFile: "docs/research/articles/0x_discover-polymarket-40m-arb.md",
    frontmatter: {
      published: "2026-04-17",
      papers: ["arxiv:2508.03474", "arxiv:1606.02825v2"],
      tags: ["arbitrage", "frank-wolfe", "bregman", "microstructure"],
    },
    gapReportMd: `## Already done
- **Article archived** — \`docs/research/articles/0x_discover-polymarket-40m-arb.md\`
- **Quant-Arb agent + 2 strategies + 15 tracked wallets seeded** — \`scripts/seed-quant-arb.ts\`
- **Single-market YES+NO arb detector** — \`src/lib/strategies/complement-sum-arb.ts\` (the "41% of conditions" check from the paper)
- **Kelly sizing** — \`src/lib/quant/formulas.ts\` (used across arena/risk-wrapper/llm-oracle/match-opportunities)
- **Real-time WebSocket worker** — \`worker:realtime\`
- **Wallet typology classifier** encodes the article's "copy-trading fails — you provide exit liquidity" thesis as the \`hft_bot\` un-copyable bucket

## Seeded but not built
- **\`src/lib/polymarket/arb.ts:findSingleMarketArbs\`** — referenced in the seed script but the file doesn't exist; \`complement-sum-arb.ts\` covers the detection logic, scanner wiring is missing
- **\`tracked_wallets\` table** has 15 handles but no \`proxy_wallet\` addresses populated — the OBSERVE_ONLY replay strategy can't pull \`/trades?user=\` data yet
- **\`/arb\` page** exists but doesn't surface live YES+NO baskets yet

## Missing
- **Combinatorial / multi-market dependency detection** — the "Republicans win by 5+ implies Trump wins PA" example. No code path constructs the constraint graph across markets.
- **Frank-Wolfe + Bregman projection** — the production pipeline needs a Frank-Wolfe + IP-solver hookup (Gurobi or HiGHS via WASM, or a Python sidecar) before it produces actionable outputs
- **Same-block parallel-order submission on Polygon** — execution is shadow-mode only; need a bundled-tx path that submits both legs in the same block
- **AI-powered dependency classifier** (DeepSeek-R1-Distill-Qwen-32B in the article) — no module classifies whether two markets are logically dependent

## Suggested next steps
1. **Wire \`complement-sum-arb.ts\` to a live scanner + \`/arb\` UI** (\`/arb\`)
   Highest leverage: detection code exists; you just need a scanner script that polls \`getOrderBooks\` on the universe + writes results to \`evolution_log\`, then surface in the existing \`/arb\` page. Stays SHADOW_MODE — no execution change.
2. **Resolve the 15 tracked-wallet handles to proxy_wallet addresses + start observe-only replay** (\`scripts/seed-quant-arb.ts\`)
   Calls Gamma \`/v1/leaderboard?userName=<handle>\` to get the on-chain address, then a worker runs \`/trades?user=<addr>\` every 5 min and feeds an analytics table. Gives concrete learning data without copying anything.
3. **Scaffold combinatorial arb on event-bundles only** (\`src/lib/strategies/\`)
   Don't try to solve 2^63 yet — start with event-bundles where Polymarket already exposes a "multi-outcome event" (e.g. one-winner-only). On these, the constraints are explicit and a brute-force linear program in \`highs-js\` is sufficient. Builds the Frank-Wolfe substrate without needing the IP solver day one.
4. **Reach-out / Slack the relevant arxiv authors before reinventing** (\`docs/research/articles/0x_discover-polymarket-40m-arb.md\`)
   The paper has a public reference implementation. Worth checking the repo before building from scratch — could save days of FW + Bregman engineering.`,
    todos: [
      { label: "Wire complement-sum-arb.ts to a live scanner + /arb UI", related_path: "/arb" },
      { label: "Resolve 15 tracked-wallet handles to proxy_wallet addresses; start observe-only replay", related_path: "scripts/seed-quant-arb.ts" },
      { label: "Scaffold combinatorial arb on event-bundles only (highs-js linear program)", related_path: "src/lib/strategies/" },
      { label: "Check arxiv:2508.03474 for reference implementation before building Frank-Wolfe from scratch", related_path: "docs/research/articles/0x_discover-polymarket-40m-arb.md" },
    ],
  },
];

let seededArticles = 0;
let seededGapReports = 0;
let seededTodos = 0;

for (const seed of SEEDS) {
  const bodyPath = resolve(REPO_ROOT, seed.bodyFromFile);
  if (!existsSync(bodyPath)) {
    console.warn(`[seed-articles] skip "${seed.title}" — body file not found at ${bodyPath}`);
    continue;
  }
  const body = readFileSync(bodyPath, "utf8");
  const id = upsertArticleByTitle({
    title: seed.title,
    source: seed.source,
    url: seed.url,
    body_md: body,
    frontmatter: seed.frontmatter,
  });
  seededArticles++;

  if (seed.gapReportMd && !getLatestGapReport(id)) {
    saveGapReport({
      article_id: id,
      body_md: seed.gapReportMd,
      report_json: {},
      model: "hand-written",
      source: "seed",
    });
    seededGapReports++;
  }

  if (seed.todos && listTodos(id).length === 0) {
    for (const t of seed.todos) {
      addTodo({ article_id: id, label: t.label, related_path: t.related_path ?? null });
      seededTodos++;
    }
  }
}

// Cross-link modules + strategies back to the articles that inspired them.
// This is what makes /articles/[id] "Scaffolded from this article" useful.
// Idempotent — linkStrategyToArticle uses INSERT OR IGNORE.
let seededLinks = 0;
const links: Array<{
  module_path?: string;
  strategy_slug?: string;
  agent_slug?: string;
  article_title: string;
  role: "primary" | "supporting" | "calibration" | "execution";
  notes?: string;
}> = [
  {
    module_path: "src/lib/quant/becker-calibration.ts",
    article_title: "How To Use Markov Chains To Win Every Single Trade + [Quant Framework]",
    role: "calibration",
    notes: "Becker 72.1M-trade longshot-bias table; post-processor for any model probability. Surfaced on /calibration.",
  },
  {
    module_path: "packages/core/src/venue/maker-only-gate.ts",
    article_title: "How To Use Markov Chains To Win Every Single Trade + [Quant Framework]",
    role: "execution",
    notes: "Router gate #6: rejects MARKET orders unless metadata.allowTaker=true or ROUTER_ALLOW_TAKER=1. Codifies Becker's +1.12% maker / -1.12% taker rule. Applies to every existing strategy.",
  },
  {
    module_path: "src/lib/quant/markov.ts",
    article_title: "How To Use Markov Chains To Win Every Single Trade + [Quant Framework]",
    role: "primary",
    notes: "Transition matrix + Monte Carlo (10K paths) + matrix validation + persistence probability. The 5-step framework's core math. Pipes raw MC probability through becker-calibration.ts. Pure functions; 19 tests.",
  },
  {
    module_path: "src/lib/quant/markov.ts",
    article_title: "Hermes + Polymarket — how to build an AI for a self-learning BTC trading agent ($100 → $10,000)",
    role: "supporting",
    notes: "persistenceProbability(T, j) is the substrate for Ricker's `p(j*,j*) ≥ 0.87` filter.",
  },
  {
    module_path: "src/lib/strategies/markov-persistence-filter.ts",
    article_title: "Hermes + Polymarket — how to build an AI for a self-learning BTC trading agent ($100 → $10,000)",
    role: "primary",
    notes: "Pure decision logic for Ricker's filter: persistence ≥ MIN_PROB (default 0.87) AND |calibrated_p − market_p| ≥ MIN_EDGE (default 5%). 7 tests covering all PASS/ENTER paths.",
  },
  {
    module_path: "src/lib/strategies/markov-persistence-scanner.ts",
    article_title: "Hermes + Polymarket — how to build an AI for a self-learning BTC trading agent ($100 → $10,000)",
    role: "primary",
    notes: "Pure evaluator wrapping the filter with market-shaped input (token id, midpoint, expiry, raw pricesHistory). 8 tests. Runner: scripts/scan-markov-persistence.ts (npm run scan:markov-persistence).",
  },
  {
    module_path: "src/lib/strategies/markov-persistence-executor.ts",
    article_title: "Hermes + Polymarket — how to build an AI for a self-learning BTC trading agent ($100 → $10,000)",
    role: "execution",
    notes: "Pure decideOrder() with quarter-Kelly sizing → LIMIT order (passes Becker maker-only gate naturally). 7 tests. Worker: scripts/worker-markov-persistence-exec.ts. MARKOV_LIVE=1 to arm.",
  },
  {
    module_path: "src/lib/strategies/complement-sum-arb.ts",
    article_title: "The Exact Math That Pulled $40,000,000 from Polymarket (Full Roadmap)",
    role: "primary",
    notes: "Single-market YES+NO arb detector — the '41% of conditions' case from the paper.",
  },
];
for (const link of links) {
  const article = getArticleByTitle(link.article_title);
  if (!article) continue;
  linkStrategyToArticle({
    module_path: link.module_path,
    article_id: article.id,
    role: link.role,
    notes: link.notes,
  });
  seededLinks++;
}

console.log(
  `[seed-articles] articles upserted: ${seededArticles}, gap reports: ${seededGapReports}, todos: ${seededTodos}, links: ${seededLinks}`,
);
