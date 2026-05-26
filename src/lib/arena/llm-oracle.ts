/**
 * LLM probability oracle — the "20-line Claude brain" from the Lunar article.
 *
 * Given a Polymarket question + its market-implied probability, ask Claude to
 * estimate the TRUE probability of YES resolution. Caller (genome decide())
 * pairs the answer with a market entry signal; the EV+Kelly rail (P2) gates
 * and resizes.
 *
 * Three layers:
 *   1. Cache: in-memory Map keyed by (market_id, prompt_version, hour_bucket)
 *      with TTL. Cache hits are logged to llm_call_log as cost_usd=0.
 *   2. Budget guard: refuses live calls once daily cap is hit; cache still served.
 *   3. Persistent log: every call (hit or miss) writes a row to llm_call_log
 *      for postmortem + budget tracking.
 *
 * Spec: `docs/prds/lunar-inspired-arena-strategies.md` §6.5.R5 +
 *        `IMPLEMENTATION-PLAN.md` Phase 6.
 */
import { z } from "zod";
import { db } from "@/lib/db/client";
import { authIsAvailable, getOAuthClient } from "@/lib/anthropic/auth";
import { checkBudget } from "./llm-oracle-budget";

const OracleResponse = z.object({
  probability: z.number().min(0).max(1),
  confidence: z.enum(["high", "medium", "low"]),
  reasoning: z.string().max(400),
});
export type OracleResult = z.infer<typeof OracleResponse>;

// Sonnet 4.6 prices in $/Mtok (input + output). Update when pricing changes.
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-7":          { input: 15, output: 75 },
  "claude-sonnet-4-6":        { input:  3, output: 15 },
  "claude-haiku-4-5-20251001":{ input:  1, output:  5 },
};

// In-memory cache. Keyed by `${market_id}|${prompt_version}|${hour_bucket}`.
const CACHE = new Map<string, { result: OracleResult; cached_at: number; ttl_min: number }>();

function hourBucket(now = new Date()): string {
  return `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1).toString().padStart(2, "0")}-${now.getUTCDate().toString().padStart(2, "0")}T${now.getUTCHours().toString().padStart(2, "0")}`;
}
function cacheKey(marketId: string, promptVersion: string): string {
  return `${marketId}|${promptVersion}|${hourBucket()}`;
}
function cacheHit(key: string, ttlMin: number): OracleResult | null {
  const e = CACHE.get(key);
  if (!e) return null;
  const ageMs = Date.now() - e.cached_at;
  if (ageMs > ttlMin * 60_000) {
    CACHE.delete(key);
    return null;
  }
  return e.result;
}

function logCall(args: {
  model: string; promptVersion: string; marketId: string;
  inputTokens: number; outputTokens: number; cost_usd: number;
  callerAgentId?: number; cacheHit: boolean; response: OracleResult | null;
}) {
  db().prepare(
    `INSERT INTO llm_call_log (model, prompt_version, market_id, input_tokens, output_tokens, cost_usd, caller_agent_id, cache_hit, response_json)
     VALUES (@model, @promptVersion, @marketId, @inputTokens, @outputTokens, @cost_usd, @callerAgentId, @cacheHit, @response)`,
  ).run({
    model: args.model, promptVersion: args.promptVersion, marketId: args.marketId,
    inputTokens: args.inputTokens, outputTokens: args.outputTokens, cost_usd: args.cost_usd,
    callerAgentId: args.callerAgentId ?? null,
    cacheHit: args.cacheHit ? 1 : 0,
    response: args.response ? JSON.stringify(args.response) : null,
  });
}

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING["claude-sonnet-4-6"];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

const SYSTEM_PROMPT_V1 = `You are a calibrated prediction-market analyst. Your job is to estimate the TRUE probability that a specific binary outcome resolves YES, ignoring the current market price.

Rules:
1. Base rates first. Anchor on the historical base rate for the question type.
2. Penalize extreme confidence. Reserve 95%+/5%- for overwhelming evidence; most live between 20-80%.
3. Acknowledge unknowns. If your training doesn't cover it, return confidence="low" and probability near the market price.
4. Calibration: if you say 70%, ~7 of 10 such forecasts should resolve YES.
5. Output JSON only, matching the schema {"probability": number, "confidence": "high"|"medium"|"low", "reasoning": string}.

Examples (study the calibration, not the topics):
- FOMC rate cut in known-weak labor market: probability 0.62, confidence "medium", "FOMC cuts in cycles where unemployment rises; base rate ~50%, adjusted +12pp".
- Beyond-knowledge-cutoff launch question: probability 0.40-0.85, confidence "low", "Cannot verify timeline; matching market with mild fade".
- BTC point-target forecast beyond cutoff: probability ≈ market price, confidence "low", "No edge on point forecasts; no-edge default".`;

export type CallOracleArgs = {
  marketId: string;
  question: string;
  marketImpliedProb: number;
  category?: string;
  model?: string;
  promptVersion?: string;
  cacheTtlMin?: number;
  callerAgentId?: number;
};

/**
 * Call the oracle. Returns the cached result if hot, else makes a live API
 * call (if budget allows). Returns null when:
 *   - OAuth is not configured (no creds), OR
 *   - Budget is exhausted AND no cache hit, OR
 *   - The model returns invalid JSON (logged separately for postmortem).
 *
 * The caller treats null as "no signal, hold".
 */
export async function callOracle(args: CallOracleArgs): Promise<OracleResult | null> {
  const model = args.model ?? "claude-sonnet-4-6";
  const promptVersion = args.promptVersion ?? "v1";
  const ttl = args.cacheTtlMin ?? 60;
  const key = cacheKey(args.marketId, promptVersion);

  // 1. Cache check.
  const hit = cacheHit(key, ttl);
  if (hit) {
    logCall({
      model, promptVersion, marketId: args.marketId,
      inputTokens: 0, outputTokens: 0, cost_usd: 0,
      callerAgentId: args.callerAgentId, cacheHit: true, response: hit,
    });
    return hit;
  }

  // 2. Budget guard.
  const budget = checkBudget();
  if (!budget.allowed) {
    // Refuse silent — caller diagnostic surfaces this. No log row (we didn't
    // make a call) to keep the spend total honest.
    return null;
  }

  // 3. Auth.
  if (!authIsAvailable()) return null;

  // 4. Live call.
  const userPrompt = `<market>\n  <question>${escapeXml(args.question)}</question>\n  <market_implied_probability>${args.marketImpliedProb.toFixed(3)}</market_implied_probability>\n  <category>${args.category ?? "other"}</category>\n</market>\n\nReturn JSON only.`;
  try {
    const client = await getOAuthClient();
    const resp = await client.messages.create({
      model,
      max_tokens: 200,
      system: SYSTEM_PROMPT_V1,
      messages: [{ role: "user", content: userPrompt }],
    });
    const text = resp.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("");
    const parsed = extractAndParseJson(text);
    const validated = OracleResponse.safeParse(parsed);
    const inputTokens = resp.usage?.input_tokens ?? 0;
    const outputTokens = resp.usage?.output_tokens ?? 0;
    const cost = computeCost(model, inputTokens, outputTokens);

    if (!validated.success) {
      logCall({
        model, promptVersion, marketId: args.marketId,
        inputTokens, outputTokens, cost_usd: cost,
        callerAgentId: args.callerAgentId, cacheHit: false, response: null,
      });
      return null;
    }
    const result = validated.data;
    CACHE.set(key, { result, cached_at: Date.now(), ttl_min: ttl });
    logCall({
      model, promptVersion, marketId: args.marketId,
      inputTokens, outputTokens, cost_usd: cost,
      callerAgentId: args.callerAgentId, cacheHit: false, response: result,
    });
    return result;
  } catch {
    return null;
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

/** Robust JSON extraction — finds the first balanced `{...}` block and parses
 *  it. Tolerates leading/trailing prose if the model ignores "JSON only". */
function extractAndParseJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); }
        catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Synchronous cache peek. Used by `decideLlmProbabilityOracle` (which is
 * sync — we don't want to make every decide() call async). The async
 * `warmOracleCacheForTick` runs first in the tick loop and populates the
 * cache; sync peeks during the per-agent loop find hot entries.
 */
export function peekOracleCache(marketId: string, promptVersion = "v1"): OracleResult | null {
  const e = CACHE.get(cacheKey(marketId, promptVersion));
  if (!e) return null;
  if (Date.now() - e.cached_at > e.ttl_min * 60_000) {
    CACHE.delete(cacheKey(marketId, promptVersion));
    return null;
  }
  return e.result;
}

/** Test-only: clear the in-memory cache. */
export function _clearOracleCache(): void {
  CACHE.clear();
}

/** Test-only: seed the cache (skip API). */
export function _seedOracleCache(marketId: string, promptVersion: string, result: OracleResult, ttlMin = 60): void {
  CACHE.set(cacheKey(marketId, promptVersion), { result, cached_at: Date.now(), ttl_min: ttlMin });
}
