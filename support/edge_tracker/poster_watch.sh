#!/bin/zsh
# poster_watch.sh — THE CONTINUOUS ARMED MAKER POSTER (the "system, not a command").
#
# Runs `weather-maker --live --loop` (runContinuousMaker): rests two-sided reward pairs (tilt ON for pair-completion),
# self-de-risks single-legs IN-PROCESS every cycle (Phase-1 rescue + settlement-lag-aware circuit breaker), and books
# resolved pairs to the lane ledgers. launchd KeepAlive restarts it on crash; RunAtLoad starts it on boot/login — so the
# whole thing survives reboot/logout and runs UNATTENDED. This is what makes it a system rather than a manual command.
#
# SAFETY: live-auth is INLINE here (never persisted to .env). Risk is bounded every which way —
#   • per-set budget (PW_MAKER_BUDGET_USD, default $20) — escrow per re-quote can't exceed it
#   • filled-exposure cap (PW_MAKER_MAX_EXPOSURE_USD, default $40) — halts posting once cumulative filled buys hit it
#   • finite daily circuit breaker (PW_MAKER_RESCUE_MAX_FAILS=5 / MAX_LOSS=$15) — halts on the day's failed-pair bleed
#   • patient single-leg hold (PW_MAKER_GUARD_HOLD_S=6h) — does NOT prematurely cancel a leg that's still completing
#     (the proven London pair filled both legs over ~2 days; a 90s cancel would have sabotaged it)
#   • cancel-only rescue (sell disabled) for v1 — frees escrow on a stale sibling, never market-dumps the filled leg
# KILL: `touch /Users/isaiahdupree/Software/edge_tracker/.poster_off` (idles within ~5min) OR
#       `launchctl unload ~/Library/LaunchAgents/com.edgetracker.poster.plist`.
# SUPERSEDES com.edgetracker.rescue (the poster self-rescues in-process) — unload that first so they don't both cancel.
set -u
REPO="/Users/isaiahdupree/Software/polymarket-weather"
ET="/Users/isaiahdupree/Software/edge_tracker"
LOGDIR="$ET/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/poster.log"
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
cd "$REPO" || exit 1

# kill-switch: idle without unloading the job
if [ -f "$ET/.poster_off" ]; then echo "[$(date)] .poster_off present — poster IDLE (rm it to resume)" >> "$LOG"; sleep 300; exit 0; fi

echo "[$(date)] poster starting — ARMED · tilt ON · cities=${PW_MAKER_CITIES:-london} · budget \$${PW_MAKER_BUDGET_USD:-20}/set · exposure cap \$${PW_MAKER_MAX_EXPOSURE_USD:-40} · breaker ${PW_MAKER_RESCUE_MAX_FAILS:-5} fails/\$${PW_MAKER_RESCUE_MAX_LOSS:-15}" >> "$LOG"
PW_MODE=live PW_LIVE_CONFIRM=I_UNDERSTAND PW_POLYMARKET_LEGAL_ACK=NON_US_PERSON PW_KEY_ROTATED=1 \
  WP_MAKER_ARM=1 PW_MAKER_NEUTRAL=1 PW_MAKER_RESCUE_ARM=1 \
  PW_MAKER_CITIES="${PW_MAKER_CITIES:-london}" \
  PW_MAKER_SIZE="${PW_MAKER_SIZE:-20}" \
  PW_MAKER_MAX_MID="${PW_MAKER_MAX_MID:-0.5}" \
  PW_MAKER_MAX_POOLS="${PW_MAKER_MAX_POOLS:-1}" \
  PW_MAKER_BUDGET_USD="${PW_MAKER_BUDGET_USD:-20}" \
  PW_MAKER_MAX_EXPOSURE_USD="${PW_MAKER_MAX_EXPOSURE_USD:-20}" \
  PW_MAKER_RESCUE_MAX_FAILS="${PW_MAKER_RESCUE_MAX_FAILS:-5}" \
  PW_MAKER_RESCUE_MAX_LOSS="${PW_MAKER_RESCUE_MAX_LOSS:-15}" \
  PW_MAKER_RESCUE_SELL_MARKOUT="${PW_MAKER_RESCUE_SELL_MARKOUT:--1}" \
  PW_MAKER_GUARD_HOLD_S="${PW_MAKER_GUARD_HOLD_S:-21600}" \
  PW_MAKER_CHASE="${PW_MAKER_CHASE:-1}" \
  PW_MAKER_CHASE_S="${PW_MAKER_CHASE_S:-300}" \
  PW_MAKER_CHASE_MIN_FACTOR="${PW_MAKER_CHASE_MIN_FACTOR:-0.30}" \
  PW_MAKER_REQUOTE_MS="${PW_MAKER_REQUOTE_MS:-21600000}" \
  PW_MAKER_INTERVAL_S="${PW_MAKER_INTERVAL_S:-60}" \
  npx tsx src/run.ts weather-maker --live --loop --budget="${PW_MAKER_BUDGET_USD:-20}" >> "$LOG" 2>&1
echo "[$(date)] poster exited (KeepAlive will restart)" >> "$LOG"
