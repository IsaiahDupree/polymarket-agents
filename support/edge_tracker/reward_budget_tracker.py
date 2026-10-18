"""
reward_budget_tracker.py — track Polymarket's daily WEATHER maker-reward budget: the #1 risk to our edge.

Our proven edge is reward-BUDGET capture (it scales with the budget; the proven operator defiance_cr says it bleeds
when the budget thins). The budget is rented day-by-day and was previously untracked. This polls the live gamma board
(city × upcoming dates, no auth), sums rewards.rates[].rewards_daily_rate across all weather pools = today's budget,
and records it to budget-history.jsonl (Passport) + a budget snapshot into edge_ledger.db. Run hourly via launchd.

    python3 reward_budget_tracker.py            # one snapshot
    python3 reward_budget_tracker.py --report   # recent budget history
"""
import json
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

GAMMA = "https://gamma-api.polymarket.com"
PP = Path("/Volumes/My Passport/trading-data")
HIST = PP / "budget-history.jsonl" if PP.exists() else Path("/Users/isaiahdupree/Software/polymarket-weather/data/budget-history.jsonl")
DBS = [p for p in (PP / "edge_ledger.db", Path("/Users/isaiahdupree/Software/polymarket-weather/data/edge_ledger.db")) if p.parent.exists()]
CITIES = ["nyc", "chicago", "miami", "dallas", "seattle", "atlanta", "london", "paris", "munich", "ankara",
          "seoul", "tokyo", "shanghai", "singapore", "lucknow", "tel-aviv", "toronto", "sao-paulo",
          "buenos-aires", "wellington", "denver", "austin", "beijing", "guangzhou", "shenzhen", "taipei",
          "chengdu", "warsaw"]
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
          "october", "november", "december"]
USDC = "0x2791bca1f2de4661ed88a30c99a7a9449aa84174"


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "edge-budget-tracker"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def _pool_rate(market):
    """rewards_daily_rate (USDC) for one bucket market, from gamma fields."""
    rw = market.get("rewards") or market.get("clobRewards") or {}
    try:
        if isinstance(rw, dict):
            for rt in rw.get("rates", []) or []:
                if str(rt.get("asset_address", "")).lower() == USDC:
                    return float(rt.get("rewards_daily_rate", 0) or 0)
        # some gamma shapes expose a flat field
        for k in ("rewardsDailyRate", "rewards_daily_rate", "dailyRewardRate"):
            if market.get(k) is not None:
                return float(market[k])
    except Exception:
        pass
    return 0.0


def poll():
    """Authoritative source: CLOB /sampling-markets (all reward-eligible markets, paginated) — the daily rate lives in
    rewards.rates[].rewards_daily_rate here (the gamma events endpoint exposes max_spread/min_size but NOT the rate;
    the per-market CLOB endpoint returns rates:null). Filter to weather/temperature, sum the rate, aggregate by city."""
    cursor, total, pools, scanned, pages = "", 0.0, 0, 0, 0
    by_city = {}
    while pages < 20:
        try:
            d = _get(f"https://clob.polymarket.com/sampling-markets?next_cursor={cursor}")
        except Exception:
            break
        data = d.get("data", []) if isinstance(d, dict) else []
        scanned += len(data)
        for m in data:
            q = (m.get("question") or "").lower()
            if "temperature" in q or "highest temp" in q:
                rate = 0.0
                for rt in (m.get("rewards") or {}).get("rates") or []:
                    if str(rt.get("asset_address", "")).lower() == USDC:
                        rate += float(rt.get("rewards_daily_rate", 0) or 0)
                if rate > 0:
                    total += rate
                    pools += 1
                    city = next((c for c in CITIES if c.replace("-", " ") in q or c in q), "other")
                    by_city[city] = round(by_city.get(city, 0) + rate, 1)
        cursor = d.get("next_cursor", "") if isinstance(d, dict) else ""
        pages += 1
        if not cursor or cursor == "LTE=":
            break
    return {"budget_usd_day": round(total, 1), "n_pools": pools, "n_events": len(by_city),
            "avg_rate_per_pool": round(total / pools, 1) if pools else 0.0, "scanned": scanned, "by_event": by_city}


def health_check(snap):
    """Distinguish a BROKEN source (schema change → silent $0) from a genuinely thin budget. Weather reward pools
    have numbered hundreds every day this lane has existed; $0 / near-zero pools means the CLOB shape changed, NOT
    that the budget vanished. Returns (healthy, reason)."""
    if snap.get("scanned", 0) < 100:
        return False, f"only {snap.get('scanned', 0)} markets scanned — sampling-markets pagination/endpoint likely broke"
    if snap["n_pools"] == 0 or snap["budget_usd_day"] == 0:
        return False, "0 weather pools / $0 budget but the endpoint returned data — rewards.rates field shape likely changed"
    if snap["n_pools"] < 20:
        return False, f"only {snap['n_pools']} weather pools (expect ~300+) — partial source failure, treat as suspect"
    return True, "ok"


def record():
    n = datetime.now(timezone.utc)
    snap = poll()
    healthy, reason = health_check(snap)
    if not healthy:
        print(f"  🚨 SOURCE-HEALTH ALARM: {reason} — recording but DO NOT trust this as 'budget thin / edge at risk'. Check the CLOB sampling-markets schema.")
    ts = n.isoformat()
    row = {"ts": ts, "source_healthy": healthy, **{k: v for k, v in snap.items() if k != "by_event"}}
    with open(HIST, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({**row, "by_event": snap["by_event"]}) + "\n")
    for db in DBS:
        try:
            con = sqlite3.connect(str(db))
            con.execute("CREATE TABLE IF NOT EXISTS edge_snapshots (ts TEXT, lane TEXT, metric TEXT, value, n INTEGER, detail TEXT)")
            con.executemany("INSERT INTO edge_snapshots VALUES (?,?,?,?,?,?)", [
                (ts, "reward_budget", "budget_usd_day", snap["budget_usd_day"], snap["n_pools"], "weather maker-reward budget (binding constraint)"),
                (ts, "reward_budget", "n_pools", snap["n_pools"], snap["n_pools"], ""),
                (ts, "reward_budget", "avg_rate_per_pool", snap["avg_rate_per_pool"], snap["n_pools"], ""),
                (ts, "reward_budget", "source_healthy", 1 if healthy else 0, snap.get("scanned", 0), reason),
            ])
            con.commit(); con.close()
        except Exception as e:
            print(f"  [db] {db}: {e}")
    b = snap["budget_usd_day"]
    tag = "FAT" if b >= 15000 else ("THIN — edge at risk" if b < 5000 else "moderate")
    top = sorted(snap["by_event"].items(), key=lambda x: -x[1])[:5]
    print(f"[{ts[:19]}] weather reward budget: ${b}/day over {snap['n_pools']} pools "
          f"(avg ${snap['avg_rate_per_pool']}/pool) — {tag} | top: {top}")
    return snap


def report():
    if not HIST.exists():
        print("no budget-history.jsonl yet — run once"); return
    rows = [json.loads(l) for l in HIST.read_text().splitlines() if l.strip()]
    print(f"budget-history.jsonl: {len(rows)} snapshots")
    for r in rows[-12:]:
        print(f"  {r['ts'][:16]}  ${r['budget_usd_day']:>8}/day  {r['n_pools']:>3} pools  avg ${r['avg_rate_per_pool']}/pool")


if __name__ == "__main__":
    report() if "--report" in sys.argv else record()
