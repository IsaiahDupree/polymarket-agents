"""
edge_recorder.py — continuously document OUR edge in one durable SQLite DB, aggregated from ALL paper strats.

Every run reads the paper-strat outputs in the polymarket-weather repo (the maker reward proof + each shadow lane +
directional + copy-follow + near-res) and appends a timestamped snapshot row per (lane, metric) to a single
time-series DB. The DB lives on the Passport (durable across machine restart) with a local mirror. Run it once, or
`--loop 600` to record every 10 minutes alongside the strats.

    python3 edge_recorder.py            # one snapshot
    python3 edge_recorder.py --loop 600 # continuous (every 600s)
    python3 edge_recorder.py --report   # latest snapshot per lane
"""
import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path("/Users/isaiahdupree/Software/polymarket-weather")
DATA = REPO / "data"
PP = Path("/Volumes/My Passport/trading-data")
DB_PASSPORT = PP / "edge_ledger.db"
DB_LOCAL = DATA / "edge_ledger.db"


def _rows(p):
    f = DATA / p
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line:
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def _jsonfile(p):
    f = DATA / p
    try:
        return json.loads(f.read_text(encoding="utf-8")) if f.exists() else {}
    except Exception:
        return {}


def snapshot():
    """Aggregate the current edge across every paper strat → list of (lane, metric, value, n, detail)."""
    out = []

    def add(lane, metric, value, n=None, detail=""):
        out.append((lane, metric, round(value, 4) if isinstance(value, (int, float)) else value, n, detail))

    # --- THE PROVEN EDGE: market-neutral maker rebate (reward-rounds-enriched.jsonl) ---
    rr = _rows("reward-rounds-enriched.jsonl")
    if rr:
        net = sum(r.get("honestNet", 0) for r in rr)
        reb = sum(r.get("honestRebate", 0) for r in rr)
        fill = sum(r.get("fillPnl", 0) for r in rr)
        elig = [r.get("eligFrac") for r in rr if isinstance(r.get("eligFrac"), (int, float))]
        clv = [r.get("clv") for r in rr if isinstance(r.get("clv"), (int, float))]
        add("maker_rebate", "honestNet_usd", net, len(rr), "THE proven edge (market-neutral)")
        add("maker_rebate", "honestRebate_usd", reb, len(rr))
        add("maker_rebate", "fillPnl_usd", fill, len(rr))
        add("maker_rebate", "per_round_usd", net / len(rr), len(rr))
        if elig:
            add("maker_rebate", "mean_eligFrac", sum(elig) / len(elig), len(elig))
        if clv:
            add("maker_rebate", "mean_clv", sum(clv) / len(clv), len(clv))
        # meanShare decay monitor — falling share = the reward-budget-split risk materializing (alert < 0.40)
        sh = [r.get("meanShare") for r in rr if isinstance(r.get("meanShare"), (int, float)) and 0 < r.get("meanShare") <= 1]
        if sh:
            recent = sh[-200:]
            ms = sum(recent) / len(recent)
            add("maker_rebate", "mean_share_recent", ms, len(recent), "ALERT if < 0.40 — competitors splitting the budget")

    # --- per maker shadow lane (activity + eligibility) ---
    for lane, fn in (("maker_base", "maker-shadow.jsonl"), ("maker_neutral", "maker-shadow-neutral.jsonl"),
                     ("maker_targeted", "maker-shadow-targeted.jsonl")):
        rows = _rows(fn)
        if rows:
            elig = sum(1 for r in rows if r.get("rebateEligible"))
            add(lane, "snapshots", len(rows), len(rows))
            add(lane, "eligible_pct", elig / len(rows) * 100, len(rows))

    # --- realized fills (live receipts — 0 until armed) ---
    add("maker_live", "live_fill_bytes", (DATA / "maker-live-fills.jsonl").stat().st_size if (DATA / "maker-live-fills.jsonl").exists() else 0, None, "0 = not live-validated yet")

    # --- tier / scale proof state ---
    sc = _jsonfile("scale-state.json")
    if sc:
        add("scale", "capture", sc.get("capture", 0), sc.get("captureSamples"))
        d = sc.get("directional", {})
        if d:
            add("directional", "ece", d.get("ece", 0), d.get("samples"), "directional lane = DEAD/longshot")
            add("directional", "realizedPnl_usd", d.get("realizedPnlUsd", 0), d.get("samples"))

    # --- other paper lanes (current activity) ---
    add("copy_follow", "decisions", len(_rows("follow-signals.jsonl")), None, "crypto copy-follow paper")
    add("nearres", "captures", len(_rows("nearclose-captures.jsonl")), None, "crypto near-resolution scalp")
    add("signals", "logged", len(_rows("signals.jsonl")) if (DATA / "signals.jsonl").exists() else 0)

    return out


def record(verbose=True):
    ts = datetime.now(timezone.utc).isoformat()
    snap = snapshot()
    dbs = [DB_LOCAL]
    if PP.exists():
        dbs.append(DB_PASSPORT)
    for dbpath in dbs:
        try:
            con = sqlite3.connect(str(dbpath))
            con.execute("CREATE TABLE IF NOT EXISTS edge_snapshots (ts TEXT, lane TEXT, metric TEXT, value, n INTEGER, detail TEXT)")
            con.executemany("INSERT INTO edge_snapshots VALUES (?,?,?,?,?,?)",
                            [(ts, lane, metric, value, n, detail) for (lane, metric, value, n, detail) in snap])
            con.commit()
            con.close()
        except Exception as e:
            print(f"  [db] {dbpath}: {e}")
    if verbose:
        head = next((s for s in snap if s[1] == "honestNet_usd"), None)
        print(f"[{ts[:19]}] edge snapshot: {len(snap)} metrics → {len(dbs)} db(s)"
              + (f" | maker_rebate honestNet ${head[2]} over {head[3]} rounds" if head else ""))
    return len(snap)


def report():
    db = DB_PASSPORT if DB_PASSPORT.exists() else DB_LOCAL
    if not db.exists():
        print("no edge_ledger.db yet — run once to create it")
        return
    con = sqlite3.connect(str(db))
    n = con.execute("SELECT count(*) FROM edge_snapshots").fetchone()[0]
    spans = con.execute("SELECT min(ts), max(ts), count(DISTINCT ts) FROM edge_snapshots").fetchone()
    print(f"edge_ledger.db: {n} rows | {spans[2]} snapshots | {str(spans[0])[:19]} → {str(spans[1])[:19]}")
    print("\nlatest per lane/metric:")
    for row in con.execute("""SELECT lane, metric, value, n, detail FROM edge_snapshots
                              WHERE ts = (SELECT max(ts) FROM edge_snapshots) ORDER BY lane, metric"""):
        print(f"  {row[0]:14} {row[1]:18} {str(row[2]):>12}" + (f"  (n={row[3]})" if row[3] is not None else "") + (f"  {row[4]}" if row[4] else ""))
    con.close()


if __name__ == "__main__":
    if "--report" in sys.argv:
        report()
    elif "--loop" in sys.argv:
        interval = int(sys.argv[sys.argv.index("--loop") + 1]) if len(sys.argv) > sys.argv.index("--loop") + 1 else 600
        print(f"edge_recorder loop every {interval}s → {DB_PASSPORT} (+ local mirror). Ctrl-C to stop.")
        while True:
            try:
                record()
                time.sleep(interval)
            except KeyboardInterrupt:
                print("stopped"); break
            except Exception as e:
                print(f"  error: {e}"); time.sleep(interval)
    else:
        record()
