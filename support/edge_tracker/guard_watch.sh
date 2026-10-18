#!/bin/zsh
# guard_watch.sh — reboot-durable ARMED single-leg guard. launchd runs this ONCE per tick (StartInterval); each run
# is a fresh process (no hung-daemon risk). It cancels a stale UNFILLED sibling the moment a maker pair goes one-sided.
# It ONLY cancels (de-risk) — it never posts and can never create exposure. Live-auth is inline HERE, scoped to this
# launcher; it is deliberately NOT written to .env (which other tools read). Disarm by unloading the launchd job.
set -u
REPO="/Users/isaiahdupree/Software/polymarket-weather"
LOGDIR="/Users/isaiahdupree/Software/edge_tracker/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/guard.log"
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
cd "$REPO" || exit 1

# one armed pass — reconstructs pair state from order-events, cancels stale siblings of any single-leg fill.
PW_MODE=live PW_LIVE_CONFIRM=I_UNDERSTAND PW_POLYMARKET_LEGAL_ACK=NON_US_PERSON \
  PW_MAKER_GUARD_ARM=1 \
  npx tsx src/run.ts maker-guard >> "$LOG" 2>&1
echo "[$(date)] guard tick done" >> "$LOG"
