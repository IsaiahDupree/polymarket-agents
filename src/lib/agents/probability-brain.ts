/**
 * 20-line Claude probability brain — @LunarResearcher article #3 (2026-03-30).
 *
 * Verbatim from the article:
 *
 *   def claude_probability(market_question, market_price):
 *       response = client.messages.create(...)
 *       return json.loads(response.content[0].text)
 *
 * The article's pitch: "50 lines of custom code. Everything else is open
 * source." This module is the TypeScript port of that 20-line brain,
 * wired to the existing OAuth-first Anthropic auth path so it costs
 * nothing on a Claude Max plan.
 *
 * Output shape mirrors the article exactly:
 *   { probability: 0.XX, confidence: "high" | "medium" | "low" }
 *
 * Use as a calibrated second opinion alongside the Markov/Becker stack:
 *
 *   const claude = await claudeProbability(question, marketPrice);
 *   if (claude.confidence === "low") return; // skip
 *   const calibrated = calibrateProbability(claude.probability);
 *   const edge = calibrated - marketPrice;
 *   // ... Kelly + LIMIT submit
 *
 * Pure async — no DB, no file writes, no router calls. Returns null when
 * auth is unavailable so the caller can choose a fallback.
 */
import Anthropic from "@anthropic-ai/sdk";
import { authIsAvailable, getOAuthClient } from "../anthropic/auth";

const MODEL = "claude-haiku-4-5";

export type ProbabilityVerdict = {
  probability: number;
  confidence: "high" | "medium" | "low";
  rationale?: string;
  model: string;
};

export function probabilityBrainAvailable(): boolean {
  return authIsAvailable();
}

const SYSTEM_PROMPT = `You are a calibrated prediction-market analyst. The operator will give you a market question and its current Polymarket price. Estimate the TRUE probability the YES outcome occurs.

# Calibration rules

- If you say 70%, ~7 out of 10 such calls should resolve YES. This is the rule of calibration — not "if I'm right, this is the answer," but "across many such calls, my stated probabilities should match resolution rates."
- Anchor on base rates first. "Will the Fed cut rates next meeting?" — base rate ≈ 30% across decades. Adjust only if the current setup is materially different from the base case.
- Penalize extreme confidence. If you'd naively say 95%, output 88%. Real-world uncertainty + the operator's own model uncertainty mean overconfidence kills.
- The market price is a Bayesian prior, not a target. If the market is at 0.50 and you'd say 0.55, output 0.55 — don't anchor to 0.50 just because that's where it trades.
- If you don't have enough information to update from base rates, return confidence="low" with probability ≈ the base rate or 0.5.

# Output

Return a single JSON object matching the schema. Nothing else.

{
  "probability": 0.00 to 1.00,
  "confidence": "high" | "medium" | "low",
  "rationale": "1-2 sentences explaining the call. Cite the base rate + the key adjustments."
}`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    probability: { type: "number" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    rationale: { type: "string" },
  },
  required: ["probability", "confidence"],
  additionalProperties: false,
} as const;

export async function claudeProbability(
  marketQuestion: string,
  marketPrice: number,
): Promise<ProbabilityVerdict | null> {
  if (!authIsAvailable()) return null;
  let c: Anthropic;
  try {
    c = await getOAuthClient();
  } catch (e) {
    console.warn(`[probability-brain] auth unavailable: ${(e as Error).message}`);
    return null;
  }

  const userText = `Market question: ${marketQuestion}\nCurrent Polymarket price: ${marketPrice.toFixed(3)}\n\nReturn the JSON object now.`;

  try {
    const resp = await c.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userText }],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } as any },
    } as any);
    const textBlock = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("no text block in response");
    const parsed = JSON.parse(textBlock.text) as { probability: number; confidence: "high" | "medium" | "low"; rationale?: string };
    // Defensive clamp — the schema can't enforce min/max so we do it here.
    const probability = Math.max(0, Math.min(1, Number(parsed.probability)));
    return { ...parsed, probability, model: MODEL };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      console.warn(`[probability-brain] rate limited: ${err.message}`);
      return null;
    }
    if (err instanceof Anthropic.AuthenticationError) {
      console.warn("[probability-brain] auth failed");
      return null;
    }
    if (err instanceof Anthropic.APIError) {
      console.warn(`[probability-brain] API ${err.status}: ${err.message}`);
      return null;
    }
    throw err;
  }
}
