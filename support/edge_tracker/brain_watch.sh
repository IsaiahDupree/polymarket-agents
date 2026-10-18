#!/bin/zsh
# brain_watch.sh — the ORCHESTRATION BRAIN daemon (maker-brain --loop, docs/PRD_ORCHESTRATION_BRAIN.md).
#
# Each epoch it FUSES realized economics (lane ledgers → comp-gate) + competitor crowding + forecast/obs ruled-out +
# the global go/no-go into a decision and WRITES data/brain-control.json. The live poster reads that file each re-quote
# and OBEYS it (city set, per-market skips, global arm) — the closed loop that makes the system adapt from its own
# results instead of repeating a fixed policy. The brain DECIDES ONLY; it places NO orders (paper mode), so no live-auth
# here. KeepAlive restarts it; RunAtLoad starts it on boot → resumes after reboot.
#
# Risk stays bounded by the poster regardless of what the brain writes (its $ caps + breaker remain in force), and a
# stale brain-control.json is IGNORED by the poster (fail-safe → env fallback). KILL: `launchctl unload` this plist.
set -u
REPO="/Users/isaiahdupree/Software/polymarket-weather"
ET="/Users/isaiahdupree/Software/edge_tracker"
LOGDIR="$ET/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/brain.log"
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
cd "$REPO" || exit 1
echo "[$(date)] brain starting — decides only (writes brain-control.json), places NO orders · epoch ${PW_BRAIN_INTERVAL_S:-3600}s · seed ${PW_BRAIN_CITIES:-london,taipei}" >> "$LOG"
# PW_MAKER_ATTEMPTS_SINCE scopes the go/no-go to the POST-tilt era so the brain incubates (doesn't halt on stale
# pre-tilt bleed) and only auto-disarms once enough post-tilt rounds actually prove the edge failing.
PW_MAKER_ATTEMPTS_SINCE="${PW_MAKER_ATTEMPTS_SINCE:-2026-06-26}" \
  PW_BRAIN_CITIES="${PW_BRAIN_CITIES:-london}" \
  PW_BRAIN_MAX_CITIES="${PW_BRAIN_MAX_CITIES:-1}" \
  PW_BRAIN_MAX_SIZE="${PW_BRAIN_MAX_SIZE:-60}" \
  PW_MAKER_SIZE="${PW_MAKER_SIZE:-20}" \
  PW_MAKER_BUDGET_USD="${PW_MAKER_BUDGET_USD:-20}" \
  PW_BRAIN_INTERVAL_S="${PW_BRAIN_INTERVAL_S:-3600}" \
  npx tsx src/run.ts maker-brain --loop >> "$LOG" 2>&1
echo "[$(date)] brain exited (KeepAlive will restart)" >> "$LOG"
