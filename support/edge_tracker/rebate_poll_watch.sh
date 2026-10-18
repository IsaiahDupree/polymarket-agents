#!/bin/zsh
# rebate_poll_watch.sh — Phase-2 deferred rebate WAIT (docs/LANE-AWARE-CONTROLLER.md). One armed poll per launchd tick.
# Reads the realized LP reward for each pending receipt's due UTC day once it rolls past 00:00Z (+margin) and seals the
# receipt (final / closed-zero). Places NO orders. Leaves receipts pending if the rewards endpoint 401s.
#
# DEFAULT-OFF: do NOT load this until `npm run derive:creds` refreshes the stale L2 creds (the /rewards/user 401).
# Enable:  launchctl load ~/Library/LaunchAgents/com.weatherpredictor.rebate-poll.plist
set -u
REPO="/Users/isaiahdupree/Software/polymarket-weather"
LOGDIR="/Users/isaiahdupree/Software/edge_tracker/logs"; mkdir -p "$LOGDIR"
LOG="$LOGDIR/rebate-poll.log"
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
cd "$REPO" || exit 1
PW_MODE=live PW_MAKER_REBATE_POLL=1 npx tsx src/run.ts maker-rebate-poll >> "$LOG" 2>&1
echo "[$(date)] rebate-poll tick done" >> "$LOG"
