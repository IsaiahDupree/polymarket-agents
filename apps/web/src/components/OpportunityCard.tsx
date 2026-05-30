/**
 * Polymarket-style opportunity card.
 *
 * Renders one (agent, opportunity) match as a dark-themed card with side-by-
 * side UP/DOWN percentages: MARKET on the left, AGENT's view on the right.
 * The agent's chosen side is highlighted with the edge vs market underneath.
 *
 * Drives the visual "Up 100% · Down 0%" headline pattern requested by the
 * operator, lifted from Polymarket's embed cards but local to this app —
 * no iframes, no external loads.
 *
 * Non-binary opportunities (NRS, CTS) still render in card shape but use
 * "BUY at $X" / "SELL at $X" headlines instead of UP/DOWN.
 */
import { StageCapsuleForm } from "./StageCapsuleForm";
import type { RecentOpportunity, StakeSuggestion } from "@/lib/arena/match-opportunities";

type Props = {
  agentId: number;
  agentName: string;
  agentPnl: number;
  opportunity: RecentOpportunity;
  suggestion: StakeSuggestion;
  allowTradeLive: boolean;
};

/** Treat these event types as "binary UP/DOWN" markets — they render with the
 *  large side-by-side UP/DOWN pair. Others use the BUY/SELL variant. */
const BINARY_EVENT_TYPES = new Set([
  "consensus-signal",
  "late-window-scalp-opportunity",
  "orderbook-imbalance-signal",
  "near-resolution-opportunity",
]);

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function ageBadgeClass(ageSec: number): string {
  if (ageSec <= 30) return "bg-accent-green/20 text-accent-green border-accent-green/40";
  if (ageSec <= 90) return "bg-accent-amber/15 text-accent-amber border-accent-amber/40";
  return "bg-accent-red/15 text-accent-red border-accent-red/40";
}

/** Map opportunity to a (upPct_market, downPct_market) pair if it's a
 *  binary. Returns null if we can't infer it. */
function marketBinarySplit(opp: RecentOpportunity): { upPct: number; downPct: number; mode: "buy-yes" | "sell-yes" | "direction" } | null {
  if (!BINARY_EVENT_TYPES.has(opp.eventType)) return null;
  const price = opp.entryPrice;
  if (price == null || price <= 0 || price >= 1) return null;
  // For UP/DOWN side: price is the cost to bet ON that direction → market's
  // implied probability of UP is `price` if side===UP, `1 − price` if side===DOWN.
  // For BUY/SELL on a binary token: market's implied "YES" is `price`.
  if (opp.side === "UP" || opp.side === "DOWN") {
    const upMarket = opp.side === "UP" ? price : 1 - price;
    return { upPct: upMarket, downPct: 1 - upMarket, mode: "direction" };
  }
  if (opp.side === "BUY" || opp.side === "YES") return { upPct: price, downPct: 1 - price, mode: "buy-yes" };
  if (opp.side === "SELL" || opp.side === "NO") return { upPct: price, downPct: 1 - price, mode: "sell-yes" };
  return null;
}

export function OpportunityCard({
  agentId,
  agentName,
  agentPnl,
  opportunity,
  suggestion,
  allowTradeLive,
}: Props) {
  const split = marketBinarySplit(opportunity);
  const isStale = opportunity.ageSec > 180;
  const agentSide = opportunity.side;

  // Agent's predicted UP/DOWN: market + edge skewed toward agent's chosen side.
  let agentUp: number | null = null;
  let agentDown: number | null = null;
  if (split && opportunity.edge != null) {
    if (agentSide === "UP") {
      agentUp = Math.min(0.999, split.upPct + opportunity.edge);
      agentDown = 1 - agentUp;
    } else if (agentSide === "DOWN") {
      agentDown = Math.min(0.999, split.downPct + opportunity.edge);
      agentUp = 1 - agentDown;
    } else if (agentSide === "BUY" || agentSide === "YES") {
      agentUp = Math.min(0.999, split.upPct + opportunity.edge);
      agentDown = 1 - agentUp;
    } else if (agentSide === "SELL" || agentSide === "NO") {
      agentDown = Math.min(0.999, split.downPct + opportunity.edge);
      agentUp = 1 - agentDown;
    }
  }
  // If no edge but the agent picked a side, show the agent's pure conviction
  // as a sided "100% / 0%" pick (just the directional vote, no probability).
  if (split && agentUp == null) {
    if (agentSide === "UP" || agentSide === "BUY" || agentSide === "YES") {
      agentUp = 1; agentDown = 0;
    } else if (agentSide === "DOWN" || agentSide === "SELL" || agentSide === "NO") {
      agentUp = 0; agentDown = 1;
    }
  }

  const marketSide: "UP" | "DOWN" | null = split
    ? (split.upPct >= split.downPct ? "UP" : "DOWN")
    : null;
  const agentSideLabel: "UP" | "DOWN" | null = agentUp != null && agentDown != null
    ? (agentUp >= agentDown ? "UP" : "DOWN")
    : null;
  const disagrees = marketSide != null && agentSideLabel != null && marketSide !== agentSideLabel;

  const edgePts = opportunity.edge != null ? opportunity.edge * 100 : null;

  return (
    <figure className="border border-zinc-800 bg-zinc-950 rounded-lg p-4 max-w-2xl">
      {/* Headline strip */}
      <header className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-zinc-100 font-medium text-sm truncate">
            {opportunity.marketTitle ?? `Opportunity #${opportunity.id}`}
          </div>
          <div className="text-[10px] text-zinc-500 flex flex-wrap gap-2 mt-0.5">
            <span className="font-mono">{opportunity.eventType}</span>
            {opportunity.conditionId && (
              <span className="font-mono truncate" title={opportunity.conditionId}>
                {opportunity.conditionId.slice(0, 10)}…
              </span>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${ageBadgeClass(opportunity.ageSec)}`}>
          {opportunity.ageSec}s ago
        </span>
      </header>

      {/* MARKET vs AGENT side-by-side UP/DOWN */}
      {split && agentUp != null && agentDown != null ? (
        <div className="grid grid-cols-2 gap-3">
          <SidePanel
            title="MARKET"
            upPct={split.upPct}
            downPct={split.downPct}
            highlight={marketSide}
            muted
          />
          <SidePanel
            title={`AGENT #${agentId}`}
            upPct={agentUp}
            downPct={agentDown}
            highlight={agentSideLabel}
            muted={false}
          />
        </div>
      ) : (
        /* Non-binary fallback — BUY/SELL line */
        <div className="border border-zinc-800 rounded p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              ["BUY", "YES", "UP"].includes(agentSide)
                ? "bg-accent-green/20 text-accent-green border border-accent-green/40"
                : "bg-accent-red/20 text-accent-red border border-accent-red/40"
            }`}>
              {agentSide}
            </span>
            <span className="text-zinc-300">
              at {opportunity.entryPrice != null ? `$${opportunity.entryPrice.toFixed(3)}` : "—"}
            </span>
            {edgePts != null && (
              <span className="text-zinc-500 text-xs">
                · edge +{edgePts.toFixed(1)}pp
              </span>
            )}
          </div>
        </div>
      )}

      {/* Edge comparison line */}
      {split && agentSideLabel && (
        <div className="mt-3 flex items-center justify-between text-[11px]">
          <span className={disagrees ? "text-accent-amber" : "text-zinc-500"}>
            {disagrees ? "⚠ agent disagrees with market" : `agent agrees with market on ${agentSideLabel}`}
          </span>
          {edgePts != null && (
            <span className="text-zinc-400">
              edge:{" "}
              <span className={edgePts >= 0 ? "text-accent-green" : "text-accent-red"}>
                {edgePts >= 0 ? "+" : ""}{edgePts.toFixed(1)}pp
              </span>
            </span>
          )}
        </div>
      )}

      {/* EV + Kelly readout */}
      <div className="mt-3 border-t border-zinc-800 pt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Metric
          label="EV @ bet"
          value={suggestion.ev != null ? `${suggestion.ev >= 0 ? "+" : ""}$${suggestion.ev.toFixed(2)}` : "—"}
          tone={suggestion.ev != null ? (suggestion.ev >= 0 ? "good" : "bad") : "neutral"}
        />
        <Metric
          label="¼-Kelly"
          value={suggestion.quarterKellyUsd != null ? `$${suggestion.quarterKellyUsd.toFixed(2)}` : "—"}
          tone="neutral"
        />
        <Metric
          label="shares"
          value={suggestion.sharesAtPrice != null ? suggestion.sharesAtPrice.toFixed(1) : "—"}
          tone="neutral"
        />
      </div>

      {suggestion.notes.length > 0 && (
        <ul className="mt-2 text-[10px] text-zinc-500 space-y-0.5">
          {suggestion.notes.map((n, i) => <li key={i}>· {n}</li>)}
        </ul>
      )}

      {/* Staging form */}
      <div className="mt-3 pt-3 border-t border-zinc-800">
        <div className="text-[10px] text-zinc-500 mb-1">
          Staging by{" "}
          <span className="text-zinc-300">{agentName}</span>
          {" "}(lifetime PnL{" "}
          <span className={agentPnl >= 0 ? "text-accent-green" : "text-accent-red"}>
            {agentPnl >= 0 ? "+" : ""}${agentPnl.toFixed(2)}
          </span>)
          {" "}— creates a paused capsule. Operator flips paused → paper/live separately.
        </div>
        <StageCapsuleForm
          agentId={agentId}
          opportunityId={opportunity.id}
          defaultBetUsd={Math.max(1, Math.min(50, suggestion.quarterKellyUsd ?? suggestion.betUsd))}
          side={agentSide}
          disabled={isStale}
        />
        {isStale && (
          <div className="mt-1 text-[10px] text-accent-red">
            opportunity is {opportunity.ageSec}s old — book has very likely moved; restage when fresher
          </div>
        )}
        {!allowTradeLive && (
          <div className="mt-1 text-[10px] text-zinc-500">
            ALLOW_TRADE=0 — staged capsule will dry-run even if flipped to live until the env var is set
          </div>
        )}
      </div>
    </figure>
  );
}

function SidePanel({
  title,
  upPct,
  downPct,
  highlight,
  muted,
}: {
  title: string;
  upPct: number;
  downPct: number;
  highlight: "UP" | "DOWN" | null;
  muted: boolean;
}) {
  return (
    <div className={`rounded border ${muted ? "border-zinc-800 bg-zinc-900/40" : "border-accent-blue/40 bg-accent-blue/5"} p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <SidePct label="UP" pct={upPct} active={highlight === "UP"} accent="green" muted={muted} />
        <SidePct label="DOWN" pct={downPct} active={highlight === "DOWN"} accent="red" muted={muted} />
      </div>
    </div>
  );
}

function SidePct({
  label,
  pct,
  active,
  accent,
  muted,
}: {
  label: string;
  pct: number;
  active: boolean;
  accent: "green" | "red";
  muted: boolean;
}) {
  const colorActive = accent === "green" ? "text-accent-green" : "text-accent-red";
  const ringActive = accent === "green" ? "ring-accent-green/40" : "ring-accent-red/40";
  return (
    <div
      className={`py-2 rounded transition ${
        active
          ? muted
            ? `ring-1 ${ringActive} ${colorActive}`
            : `ring-2 ${ringActive} ${colorActive} bg-${accent === "green" ? "accent-green" : "accent-red"}/10`
          : "text-zinc-500"
      }`}
    >
      <div className={`text-[10px] ${active && !muted ? "text-zinc-300" : "text-zinc-500"}`}>{label}</div>
      <div className={`tabular-nums ${active ? "text-2xl font-semibold" : "text-base"}`}>
        {fmtPct(pct)}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "neutral" }) {
  const toneClass = tone === "good" ? "text-accent-green" : tone === "bad" ? "text-accent-red" : "text-zinc-300";
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`tabular-nums text-xs ${toneClass}`}>{value}</div>
    </div>
  );
}
