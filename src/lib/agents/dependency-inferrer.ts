/**
 * Cross-market dependency-constraint inferrer — 0x_Discover article #1.
 *
 * The article describes:
 *
 *   DeepSeek-R1-Distill-Qwen-32B with prompt engineering to classify
 *   market pairs. Input: two market descriptions. Output: JSON of valid
 *   outcome combinations. 81.45% accuracy on complex multi-condition
 *   election markets. Good enough for filtering; requires manual
 *   verification for execution.
 *
 * This module is the codebase's port: Claude haiku 4.5 in place of
 * DeepSeek (we already have OAuth wired). Returns `LpConstraint[]` in
 * the exact shape `lp.ts` consumes, so the comb-arb scanner can pass
 * inferred constraints straight to the solver.
 *
 * The model returns `null` when:
 *   - Auth unavailable (caller can choose a fallback)
 *   - The model says "no logical implication between these two markets"
 *   - The model's reply doesn't parse
 *
 * Honest caveats baked into the design (matches the article):
 *   - 81% accuracy on complex election pairs — DO NOT auto-execute on
 *     inferred constraints. The runner records them, the LP uses them,
 *     but anything routed through the maker-only gate still goes through
 *     a human in `paper` mode first.
 *   - The model is queried per (marketA, marketB) pair. With N markets
 *     in an event, that's N*(N-1)/2 calls. Caller should cache.
 *
 * Pure async. No DB writes. No router calls.
 */
import Anthropic from "@anthropic-ai/sdk";
import { authIsAvailable, getOAuthClient } from "../anthropic/auth";

const MODEL = "claude-haiku-4-5";

/** Mirrors LpConstraint in packages/adapters/polymarket/src/lp.ts. */
export type InferredConstraint = {
  ifTrue: string[];
  thenTrue: string[];
};

export type MarketDescriptor = {
  /** Polymarket condition id or token id; passed through into constraints. */
  id: string;
  /** Question text the LLM reads. */
  question: string;
  /** YES outcome id (token id in our LP). */
  yesId: string;
  /** NO outcome id. */
  noId: string;
};

export type InferredVerdict = {
  constraints: InferredConstraint[];
  /** "independent" | "implies" | "mutually_exclusive" | "uncertain". */
  relation: "independent" | "implies" | "mutually_exclusive" | "uncertain";
  /** Model confidence "high" | "medium" | "low". */
  confidence: "high" | "medium" | "low";
  rationale?: string;
  model: string;
};

export function dependencyInfererAvailable(): boolean {
  return authIsAvailable();
}

const SYSTEM_PROMPT = `You are a market-dependency classifier for prediction markets. The operator gives you TWO market questions and their YES/NO outcomes. You decide whether the resolution of one logically constrains the other.

# What you're looking for

A logical implication: "if outcome X resolves YES, then outcome Y must resolve YES (or NO)."

Examples that DO imply:
  A: "Will Trump win Pennsylvania?"  YES=trump-pa, NO=no-trump-pa
  B: "Will Republicans win PA by 5+ points?"  YES=rep-by-5, NO=no-rep-by-5
  → If B-YES, then A-YES.  (Republicans winning by 5 implies Trump wins.)
  → emit: ifTrue=[rep-by-5], thenTrue=[trump-pa]

Examples that DO NOT imply:
  A: "Will Trump win Pennsylvania?"  B: "Will it rain in Florida tomorrow?"
  → independent

Examples that are mutually exclusive:
  A: "Will Trump win PA?"  B: "Will Harris win PA?"
  → if A-YES then B-NO. Encode as ifTrue=[A.yesId], thenTrue=[B.noId].

# Rules

- Return constraints ONLY when you are HIGHLY confident. The article cites 81% accuracy on complex pairs — be conservative.
- For "uncertain" or "low" confidence, return an empty constraints array and relation="uncertain".
- The constraints must use the EXACT outcome ids the operator gave you (yesId / noId).
- Each constraint is a one-way implication. To express "iff", emit two constraints.
- Cap output at 4 constraints per market pair.

# Output

Return one JSON object matching this schema. Nothing else.

{
  "relation": "independent" | "implies" | "mutually_exclusive" | "uncertain",
  "confidence": "high" | "medium" | "low",
  "constraints": [
    { "ifTrue": ["outcome-id", ...], "thenTrue": ["outcome-id", ...] }
  ],
  "rationale": "1-2 sentences explaining the call."
}`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    relation: { type: "string", enum: ["independent", "implies", "mutually_exclusive", "uncertain"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    constraints: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ifTrue: { type: "array", items: { type: "string" } },
          thenTrue: { type: "array", items: { type: "string" } },
        },
        required: ["ifTrue", "thenTrue"],
        additionalProperties: false,
      },
    },
    rationale: { type: "string" },
  },
  required: ["relation", "confidence", "constraints"],
  additionalProperties: false,
} as const;

function buildUserMessage(a: MarketDescriptor, b: MarketDescriptor): string {
  return [
    "# Market A",
    `Question: ${a.question}`,
    `yesId: ${a.yesId}`,
    `noId: ${a.noId}`,
    "",
    "# Market B",
    `Question: ${b.question}`,
    `yesId: ${b.yesId}`,
    `noId: ${b.noId}`,
    "",
    "Return the JSON object now.",
  ].join("\n");
}

export async function inferDependency(
  a: MarketDescriptor,
  b: MarketDescriptor,
): Promise<InferredVerdict | null> {
  if (!authIsAvailable()) return null;
  let c: Anthropic;
  try {
    c = await getOAuthClient();
  } catch (e) {
    console.warn(`[dependency-inferrer] auth unavailable: ${(e as Error).message}`);
    return null;
  }
  try {
    const resp = await c.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildUserMessage(a, b) }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } as any },
    } as any);
    const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("no text block in response");
    const parsed = JSON.parse(textBlock.text) as Omit<InferredVerdict, "model">;
    // Defensive: prune constraints with empty arrays + filter out ids that
    // don't match either input market — protects the LP from bogus inputs.
    const allowedIds = new Set([a.yesId, a.noId, b.yesId, b.noId]);
    const constraints = (parsed.constraints ?? []).filter((cn) => {
      if (cn.ifTrue.length === 0 || cn.thenTrue.length === 0) return false;
      return [...cn.ifTrue, ...cn.thenTrue].every((id) => allowedIds.has(id));
    });
    return { ...parsed, constraints, model: MODEL };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.warn(`[dependency-inferrer] rate limited: ${err.message}`);
      return null;
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.warn("[dependency-inferrer] auth failed");
      return null;
    }
    if (err instanceof Anthropic.APIError) {
      console.warn(`[dependency-inferrer] API ${err.status}: ${err.message}`);
      return null;
    }
    throw err;
  }
}
