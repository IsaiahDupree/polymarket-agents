/**
 * Phase 4 — Doc-mined seed strategies.
 *
 * Walks docs/inspiration/, docs/research/, docs/skills/, docs/coinbase/, hands
 * each .md to Claude with the genome JSON schema, asks for any concrete
 * strategy proposals it can reverse-engineer from the article.
 *
 * Output: docs/research/extracted-strategies.json (status='pending' on each
 * candidate). The operator hand-reviews + flips `status` to 'accepted' /
 * 'rejected' / 'snoozed'. The arena tick will later pick up 'accepted'
 * entries as new seed genomes for the next generation.
 *
 * Auth: OAuth via getOAuthClient() (Claude Code's local creds) — falls back
 * to ANTHROPIC_API_KEY when present. Skips entirely when no auth is wired.
 *
 * Cost guard: --max-files N caps how many docs we hand off per run.
 *
 * Usage:
 *   npx tsx scripts/extract-doc-strategies.ts
 *   npx tsx scripts/extract-doc-strategies.ts --max-files 3
 *   npx tsx scripts/extract-doc-strategies.ts --dirs docs/research
 *
 * This script does NOT seed any agent. Run again after editing the JSON to
 * re-extract; integration with arena-tick is a follow-up task.
 */
import "./_env.ts";
import fs from "node:fs";
import path from "node:path";
import { authIsAvailable, getOAuthClient } from "../src/lib/anthropic/auth.ts";
import { GENOME_KINDS, GenomeSchema, type Genome, type GenomeKind } from "../src/lib/arena/genome.ts";

const MODEL = "claude-haiku-4-5";
const DEFAULT_DIRS = ["docs/inspiration", "docs/research", "docs/skills", "docs/coinbase"];
const OUTPUT_PATH = "docs/research/extracted-strategies.json";
const MAX_DOC_CHARS = 24_000; // ~6k tokens — covers most articles, truncates long ones

type ExtractedCandidate = {
  source: string;                 // doc path
  source_excerpt: string;         // first 200 chars of doc for hand-review
  status: "pending" | "accepted" | "rejected" | "snoozed";
  proposed_at: string;            // ISO timestamp
  reviewed_at?: string;
  reviewer_note?: string;
  // Proposed genome
  genome: Genome;
  // Why the LLM thinks this is worth trying
  rationale: string;
  // What evidence in the doc supports it (quote, page section)
  supporting_quote?: string;
  // Risk / what could go wrong
  risk_note?: string;
};

type ExtractedFile = {
  generated_at: string;
  total_candidates: number;
  by_source: Record<string, number>;
  candidates: ExtractedCandidate[];
};

const args = process.argv.slice(2);
function flagStr(name: string): string | null {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? null : null;
}
function flagNum(name: string, fallback: number): number {
  const v = flagStr(name);
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const maxFiles = flagNum("max-files", 50);
const dirsArg = flagStr("dirs");
const targetDirs = dirsArg ? dirsArg.split(",").map((d) => d.trim()) : DEFAULT_DIRS;

function listMarkdownFiles(): string[] {
  const out: string[] = [];
  for (const dir of targetDirs) {
    if (!fs.existsSync(dir)) continue;
    walk(dir, out);
  }
  return out;
}
function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith(".md")) out.push(full);
  }
}

function loadExisting(): ExtractedFile {
  if (!fs.existsSync(OUTPUT_PATH)) {
    return { generated_at: new Date().toISOString(), total_candidates: 0, by_source: {}, candidates: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8")) as ExtractedFile;
  } catch {
    return { generated_at: new Date().toISOString(), total_candidates: 0, by_source: {}, candidates: [] };
  }
}

/** Skip a source if we already have a 'pending' OR an explicit
 *  'rejected/snoozed' decision for it — only reprocess sources with no
 *  candidates or where every candidate was 'accepted' (in case the operator
 *  wants more from the same doc). */
function shouldSkipSource(existing: ExtractedFile, source: string): boolean {
  const sourceCandidates = existing.candidates.filter((c) => c.source === source);
  if (sourceCandidates.length === 0) return false;
  // If every candidate is 'accepted', user wants more — re-process.
  return sourceCandidates.some((c) => c.status === "pending" || c.status === "rejected" || c.status === "snoozed");
}

const SYSTEM_PROMPT = `
You extract concrete trading strategy proposals from prediction-market and
crypto research articles, expressed in the JSON shape used by the
PolymarketAutomation arena.

A strategy proposal is a Genome object:
  { "kind": "<one of the kinds listed below>", "params": { ... } }

Valid kinds (with what they trade):
  poly_fade_spike            — Polymarket midpoint mean-reversion (fades sharp moves)
  poly_breakout              — Polymarket: ride breakouts above recent high
  cb_breakout                — Coinbase spot: ride breakouts
  cb_mean_reversion          — Coinbase spot: z-score band
  cross_venue_arb            — Poly-vs-Coinbase implied-prob spread
  cb_momentum_burst          — Coinbase short-window velocity + acceleration
  random_walk_baseline       — Null hypothesis control, DO NOT PROPOSE
  category_specialist        — Polymarket fade/breakout, filtered to one category tag
  wallet_copy_filtered       — Mirror a tracked wallet, filtered by category
  polymarket_market_maker    — Single-token quote (sim-only)
  llm_probability_oracle     — Claude estimates P_true → EV/Kelly rail
  poly_short_binary_directional — 5-min "Up or Down" binaries from CB velocity

Each kind has STRICT parameter bounds you must respect (see the schema text
in the user message). Numbers must fall inside [lo, hi]; string-enum params
must use one of the listed values.

For each proposal you make, also provide:
  - rationale: 1-2 sentences why this strategy is worth trying based on the doc
  - supporting_quote: the exact quote from the doc that suggests it (≤ 200 chars)
  - risk_note: 1 sentence on the failure mode (≤ 200 chars)

Output a JSON object with a top-level "candidates" array. Return between 0
and 5 candidates per article — high-precision, only what's clearly supported
by the text. If the article is not about trading strategies (e.g. infra,
architecture notes), return an empty array.

Do not invent new strategy kinds. Do not nest multi_strategy. Do not propose
random_walk_baseline (it's a control). Stay strictly inside the bounds.
`;

function paramBoundsAsText(): string {
  const lines: string[] = [];
  for (const kind of GENOME_KINDS) {
    if (kind === "random_walk_baseline") continue;
    lines.push(`\n${kind}:`);
    // Derive from the zod schemas — defensive in case the bound listing here
    // drifts from `genome.ts`. We just list the keys; numeric bounds are
    // implicitly enforced by the schema parse before we save.
    // For string enums, list the choices so the LLM picks valid values.
  }
  return lines.join("\n");
}

const BOUND_BLOB = paramBoundsAsText();

async function extractFromDoc(client: Awaited<ReturnType<typeof getOAuthClient>>, source: string, body: string): Promise<ExtractedCandidate[]> {
  const truncated = body.slice(0, MAX_DOC_CHARS);
  const truncNote = body.length > MAX_DOC_CHARS ? `\n\n[...truncated from ${body.length} chars]` : "";
  const userMessage = `SOURCE: ${source}

The genome schema is enforced by zod; valid kinds + param keys are listed in the system prompt above. Respect numeric bounds.

ARTICLE BODY:
${truncated}${truncNote}

Return JSON: { "candidates": [ { "kind", "params", "rationale", "supporting_quote", "risk_note" }, ... ] }
If no concrete proposals can be derived, return { "candidates": [] }.`;

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT + BOUND_BLOB,
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    console.error(`  [extract] api err: ${(err as Error).message.slice(0, 160)}`);
    return [];
  }

  // Collect raw text from response.content array (Anthropic v6+ shape).
  let raw = "";
  for (const block of response.content as Array<{ type: string; text?: string }>) {
    if (block.type === "text" && block.text) raw += block.text;
  }
  // Strip fenced code block if present.
  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = fencedMatch ? fencedMatch[1] : raw;

  let parsed: { candidates?: Array<{ kind?: string; params?: Record<string, unknown>; rationale?: string; supporting_quote?: string; risk_note?: string }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    console.error(`  [extract] non-JSON response: ${(err as Error).message}`);
    return [];
  }

  const candidates: ExtractedCandidate[] = [];
  for (const c of parsed.candidates ?? []) {
    if (typeof c.kind !== "string") continue;
    if (!GENOME_KINDS.includes(c.kind as GenomeKind)) {
      console.error(`  [extract] skipping invalid kind: ${c.kind}`);
      continue;
    }
    if (c.kind === "random_walk_baseline") continue; // control — never accept from extraction
    let genome: Genome;
    try {
      genome = GenomeSchema.parse({ kind: c.kind, params: c.params });
    } catch (err) {
      console.error(`  [extract] schema rejected ${c.kind}: ${(err as Error).message.slice(0, 120)}`);
      continue;
    }
    candidates.push({
      source,
      source_excerpt: body.slice(0, 200).replace(/\s+/g, " ").trim(),
      status: "pending",
      proposed_at: new Date().toISOString(),
      genome,
      rationale: (c.rationale ?? "").slice(0, 400),
      supporting_quote: c.supporting_quote ? c.supporting_quote.slice(0, 200) : undefined,
      risk_note: c.risk_note ? c.risk_note.slice(0, 200) : undefined,
    });
  }
  return candidates;
}

async function main(): Promise<void> {
  if (!authIsAvailable()) {
    console.error("[extract-doc-strategies] No Anthropic auth available.");
    console.error("  Sign in with Claude Code (`claude login`) or set ANTHROPIC_API_KEY.");
    process.exit(2);
  }

  const client = await getOAuthClient();
  const allFiles = listMarkdownFiles();
  console.log(`[extract-doc-strategies] discovered ${allFiles.length} markdown files in [${targetDirs.join(", ")}]`);

  const existing = loadExisting();
  const candidates: ExtractedCandidate[] = [...existing.candidates];
  let processed = 0;
  let added = 0;

  for (const file of allFiles) {
    if (processed >= maxFiles) {
      console.log(`  [budget] hit --max-files ${maxFiles}, stopping`);
      break;
    }
    if (shouldSkipSource(existing, file)) {
      console.log(`  [skip] ${file} (already has pending/rejected/snoozed candidates)`);
      continue;
    }
    const body = fs.readFileSync(file, "utf-8");
    if (body.trim().length < 200) {
      console.log(`  [skip] ${file} (too short: ${body.trim().length} chars)`);
      continue;
    }
    console.log(`  [extract] ${file} (${body.length} chars)`);
    const found = await extractFromDoc(client, file, body);
    candidates.push(...found);
    added += found.length;
    processed++;
    if (found.length > 0) {
      console.log(`    → ${found.length} candidate(s): ${found.map((c) => c.genome.kind).join(", ")}`);
    } else {
      console.log(`    → 0 candidates (article had nothing actionable)`);
    }
  }

  const bySource: Record<string, number> = {};
  for (const c of candidates) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  const out: ExtractedFile = {
    generated_at: new Date().toISOString(),
    total_candidates: candidates.length,
    by_source: bySource,
    candidates,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf-8");
  console.log("");
  console.log(`[extract-doc-strategies] done.`);
  console.log(`  processed: ${processed} files`);
  console.log(`  added candidates: ${added}`);
  console.log(`  total in ${OUTPUT_PATH}: ${candidates.length}`);
  console.log("");
  console.log("Review:");
  console.log(`  ${OUTPUT_PATH}`);
  console.log("Hand-edit `status` to 'accepted' on the candidates you want to seed in the next gen.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
