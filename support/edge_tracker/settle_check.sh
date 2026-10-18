#!/bin/zsh
# settle_check.sh — OS-level fallback that books live maker fills after markets resolve (runs even if Claude is closed).
# Fires daily; runs the LANE-ROUTED settle (maker-live-settle) so single-leg / adverse fills route to their own
# ledgers and NEVER pollute the maker proof. Captures the Taipei 06-24 + London 06-25 live test. Read-only: --settle
# places NO orders. The in-session cron does the same + reports in chat; this is the Claude-closed backup.
set -u
REPO="/Users/isaiahdupree/Software/polymarket-weather"
LOGDIR="/Users/isaiahdupree/Software/edge_tracker/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/settle.log"
DONE="/Users/isaiahdupree/Software/edge_tracker/.settle_done"
PLIST="/Users/isaiahdupree/Library/LaunchAgents/com.edgetracker.settle.plist"
MAKER="$REPO/data/maker-live-fills.jsonl"        # maker-clean (both legs filled, balanced) — the proof ledger
IMB="$REPO/data/maker-imbalanced-fills.jsonl"    # both legs, notional-asym > 0.5
DIR="$REPO/data/directional-live-fills.jsonl"    # single-leg-adverse + off-thesis
export PATH="/opt/homebrew/bin:/usr/bin:/bin"

# Self-disable AFTER the live-test window — DATE-gated, NOT file-presence. (A stale 0-byte .settle_done left over from
# an older script version used to short-circuit EVERY run here, silently disabling the lane-routed settle. Gating on the
# date instead means the job actually runs daily until the window closes, then disables once via the block below.)
if [ "$(date +%Y%m%d)" -gt 20260628 ] && [ -f "$DONE" ]; then exit 0; fi
cd "$REPO" || exit 1
echo "[$(date)] settle-check fired" >> "$LOG"

# lane-routed settle — books any newly-resolved position into its CORRECT lane ledger (dedup is conditionId-keyed).
# A no-op until markets resolve; safe to run daily. PW_MODE=live only to read/identify our live orders (no posting).
OUT="$(PW_MODE=live npx tsx src/run.ts maker-live-settle 2>&1)"
echo "$OUT" | tail -6 >> "$LOG"

lines() { [ -f "$1" ] && wc -l < "$1" | tr -d ' ' || echo 0; }
echo "[$(date)] lane ledgers — maker-clean=$(lines "$MAKER")  imbalanced=$(lines "$IMB")  directional/adverse=$(lines "$DIR")" >> "$LOG"

# Keep running daily until past BOTH resolutions (Taipei 06-24, London 06-25) + retry margin, then summarize + disable.
# We do NOT self-disable on first receipt: a single-leg fill lands in the directional ledger, and we still want the
# OTHER market's result — the whole point of the test is to see which lane each pair lands in.
if [ "$(date +%Y%m%d)" -gt 20260628 ]; then
  echo "[$(date)] past 06-28 — live-test window closed. FINAL lanes: maker-clean=$(lines "$MAKER")  imbalanced=$(lines "$IMB")  directional/adverse=$(lines "$DIR"). Disabling job." >> "$LOG"
  touch "$DONE"; launchctl unload "$PLIST" 2>/dev/null
else
  echo "[$(date)] window open (through 06-28) — will settle again tomorrow" >> "$LOG"
fi
