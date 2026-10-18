#!/bin/zsh
# system_status.sh — one glance at the continuous trading system: daemons, last poster action, live lane ledgers,
# kill-switch state. Read-only. Run anytime: zsh /Users/isaiahdupree/Software/edge_tracker/system_status.sh
set -u
REPO="/Users/isaiahdupree/Software/polymarket-weather"
ET="/Users/isaiahdupree/Software/edge_tracker"
export PATH="/opt/homebrew/bin:/usr/bin:/bin"
echo "=== daemons (launchd: pid '-' = not currently running this instant) ==="
launchctl list 2>/dev/null | grep -iE "edgetracker|weatherpredictor|polybot.nearres" | awk '{printf "  %-38s pid=%-7s exit=%s\n",$3,$1,$2}'
echo
echo "=== poster: last 8 log lines ==="
tail -8 "$ET/logs/poster.log" 2>/dev/null | sed 's/^/  /' || echo "  (no poster.log yet)"
echo
echo "=== live lane ledgers (the realized record) ==="
for f in maker-live-fills maker-imbalanced-fills directional-live-fills; do
  printf "  %-26s %s rounds\n" "$f" "$(wc -l < "$REPO/data/$f.jsonl" 2>/dev/null | tr -d ' ' || echo 0)"
done
echo
echo "=== kill-switch ==="
[ -f "$ET/.poster_off" ] && echo "  ⏸  .poster_off PRESENT — poster IDLE (rm it to resume)" || echo "  ▶  ARMED  (touch $ET/.poster_off to idle the poster)"
echo
echo "=== paper tracking freshness (the alarm the June freeze never had) ==="
now=$(date +%s)
for f in maker-shadow-targeted.jsonl watchlist.jsonl capture-study.jsonl brain-control.json; do
  p="$REPO/data/$f"
  if [ -f "$p" ]; then
    age=$(( now - $(stat -f %m "$p") ))
    if [ "$f" = "capture-study.jsonl" ]; then lim=3600; else lim=10800; fi
    [ "$age" -gt "$lim" ] && flag="🔴 STALE" || flag="🟢"
    printf "  %-28s age %6ss  %s\n" "$f" "$age" "$flag"
  else
    printf "  %-28s MISSING 🔴\n" "$f"
  fi
done
tail -1 "$REPO/data/capture-study.jsonl" 2>/dev/null | /opt/homebrew/bin/python3 -c '
import json,sys
try: s=json.loads(sys.stdin.read())
except Exception: sys.exit(0)
sh=s.get("shadow",{})
ph=s.get("phase_hint"); r=sh.get("rows_24h",0); ts=sh.get("two_sided_24h",0); mf=sh.get("malformed_quotes_24h",0); cr=100*s.get("capture_ratio_24h",0)
print(f"  capture-study: phase={ph} · shadow {r}/24h ({ts} two-sided, {mf} malformed) · capture {cr:.1f}% (gate >=34%)")
for a in (s.get("alerts") or []): print(f"  !! {a}")
'
echo
echo "=== wallet guard (reserve + per-bot envelopes) ==="
WFUNDER=$(grep -E "^POLYMARKET_FUNDER=" "$REPO/.env" 2>/dev/null | head -1 | cut -d= -f2 | tr -d "\"'" )
if [ -n "$WFUNDER" ]; then
  (cd /Users/isaiahdupree/Documents/Software/polymarket-2dollar-bot 2>/dev/null && /opt/homebrew/bin/python3 -m edgeos.grid.wallet_guard status --account "$WFUNDER" 2>/dev/null | sed 's/^/  /') || echo "  (wallet_guard unavailable)"
else
  echo "  (no FUNDER in weather .env)"
fi
echo
echo "=== edgeos weather-account roller (crypto 4848 on this wallet) ==="
for d in ~/.edgeos-weather ~/.edgeos-weather-15m; do
  lg="$d/logs/holdset_daemon.log"
  [ -f "$lg" ] && printf "  %-24s %s\n" "${d:t}:" "$(tail -200 "$lg" | grep -E "HOLD HALTED|HOLD LIVE|bal \\$" | tail -1 | cut -c1-110)"
done
echo
echo "=== passport backup (durability) ==="
tail -1 "$REPO/data/logs/passport-backup.log" 2>/dev/null | sed 's/^/  /' || echo "  (no backup log)"
launchctl list 2>/dev/null | grep -q com.weatherpredictor.passport-backup && echo "  🟢 backup job loaded (every 30min)" || echo "  🔴 backup job NOT loaded"
