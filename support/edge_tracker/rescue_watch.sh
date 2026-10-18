#!/bin/zsh
# rescue_watch.sh — durable ARMED rescue daemon (maker-rescue --loop). Reacts to single-leg fills with the price+time
# aware decision (docs/MECHANISM_PAIR_COMPLETION.md §7): hold for the completion window, then CANCEL the stale unfilled
# sibling once it can't complete. It ONLY cancels (de-risk — frees escrow) by default; AUTO-SELL is DISABLED here via
# PW_MAKER_RESCUE_SELL_MARKOUT=-1 (a marketable sell never triggers). To enable auto-sell-and-flatten of deeply-adverse
# legs, set PW_MAKER_RESCUE_SELL_MARKOUT=-0.10 (or your threshold) in this launcher. NEVER posts new maker pairs.
#
# Live-auth is inline here (scoped to this launcher, NOT in .env). SUPERSEDES the time-only guard (com.edgetracker.guard)
# — unload the guard before loading this so they don't both cancel. DEFAULT-OFF: launchd job is created but not loaded
# until you `launchctl load ~/Library/LaunchAgents/com.edgetracker.rescue.plist`.
set -u
REPO="/Users/isaiahdupree/Software/polymarket-weather"
LOGDIR="/Users/isaiahdupree/Software/edge_tracker/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/rescue.log"
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
cd "$REPO" || exit 1
echo "[$(date)] rescue daemon starting (cancel-only; sell disabled)" >> "$LOG"
PW_MODE=live PW_LIVE_CONFIRM=I_UNDERSTAND PW_POLYMARKET_LEGAL_ACK=NON_US_PERSON \
  PW_MAKER_RESCUE_ARM=1 PW_MAKER_RESCUE_SELL_MARKOUT="${PW_MAKER_RESCUE_SELL_MARKOUT:--1}" \
  PW_MAKER_RESCUE_INTERVAL_S="${PW_MAKER_RESCUE_INTERVAL_S:-60}" \
  npx tsx src/run.ts maker-rescue --loop >> "$LOG" 2>&1
echo "[$(date)] rescue daemon exited (launchd KeepAlive will restart)" >> "$LOG"
