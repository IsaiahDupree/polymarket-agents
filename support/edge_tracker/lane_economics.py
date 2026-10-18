"""
lane_economics.py — make the rebate↔fill coupling EXPLICIT: how much does the rebate lane have to compensate the
fill lane (adverse selection on the buys/sells), and are we clearing it?

A maker quote is two coupled lanes:
  REBATE lane  — Polymarket pays you for RESTING two-sided. Outcome-independent income. (+)
  FILL lane    — when orders get hit: both legs fill ⇒ you lock the spread (≈neutral); ONE leg fills ⇒ adverse
                 selection (the informed side trades against you) ⇒ you carry a directional loss. (±, usually −)
Net = rebate + spread_capture − adverse_selection_cost. The strategy only works when **rebate ≥ adverse-selection
cost**. The canonical adverse-selection measure is MARKOUT: how the mid moves AFTER your fill (markoutPerShare<0 on a
BUY = the price fell after you bought = you were picked off).

This computes, on PAPER (reward-rounds-enriched: full rebate/fillPnl split) and from REAL fills (order-events markout):
  - rebate income, fill PnL, net, and the COMPENSATION RATIO = rebate / |fill losses|
  - the BREAK-EVEN: rebate-per-round needed to offset the realized adverse selection
  - the live markout (real adverse selection on actual fills) vs the paper-modeled fill PnL — the model-vs-reality gap
Records headline metrics to edge_ledger.db so the coupling is tracked over time.

    python3 lane_economics.py            # report
    python3 lane_economics.py --record   # report + append to edge_ledger.db
"""
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

DATA = Path("/Users/isaiahdupree/Software/polymarket-weather/data")
PP = Path("/Volumes/My Passport/trading-data")
DBS = [p for p in (PP / "edge_ledger.db", DATA / "edge_ledger.db") if p.parent.exists()]


def _rows(p):
    f = DATA / p
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip():
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    return out


def paper_compensation():
    """The modeled rebate↔fill split (reward-rounds-enriched) — per round and aggregate."""
    rr = _rows("reward-rounds-enriched.jsonl")
    if not rr:
        return None
    reb = sum(r.get("honestRebate", 0) for r in rr)
    fp = sum(r.get("fillPnl", 0) for r in rr)
    fp_neg = sum(x for x in (r.get("fillPnl", 0) for r in rr) if x < 0)   # gross fill LOSSES only
    fp_pos = sum(x for x in (r.get("fillPnl", 0) for r in rr) if x > 0)   # gross fill GAINS (spread capture)
    n = len(rr)
    net = reb + fp
    # per-round: does rebate compensate the fill loss?
    compensated = sum(1 for r in rr if r.get("honestRebate", 0) + min(r.get("fillPnl", 0), 0) >= 0)
    return {
        "n_rounds": n,
        "rebate_usd": round(reb, 2), "rebate_per_round": round(reb / n, 3),
        "fillPnl_net_usd": round(fp, 2), "fillPnl_gross_loss_usd": round(fp_neg, 2), "fillPnl_gross_gain_usd": round(fp_pos, 2),
        "net_usd": round(net, 2),
        "compensation_ratio": round(reb / abs(fp_neg), 2) if fp_neg else None,  # rebate vs gross fill losses
        "rounds_rebate_covers_fillloss_pct": round(compensated / n * 100, 1),
        "break_even_rebate_per_round": round(abs(fp_neg) / n, 3),  # avg rebate/round needed to offset the gross losses
    }


def live_adverse_selection():
    """The REAL adverse selection on actual fills (order-events markout). Negative markout on a BUY = picked off."""
    ev = _rows("order-events.jsonl")
    mk = [e for e in ev if e.get("kind") == "markout" and isinstance(e.get("markoutPerShare"), (int, float))]
    fl = [e for e in ev if e.get("kind") == "fill"]
    if not mk:
        return {"n_markouts": 0, "n_fills": len(fl), "note": "no markout data yet"}
    by_h = {}
    for e in mk:
        h = e.get("horizonS", "?")
        by_h.setdefault(h, []).append(e["markoutPerShare"])
    horizons = {f"{h}s": {"n": len(v), "mean_markout_per_share": round(sum(v) / len(v), 5),
                          "adverse_pct": round(sum(1 for x in v if x < 0) / len(v) * 100, 1)}
                for h, v in sorted(by_h.items(), key=lambda kv: (kv[0] is None, kv[0]))}
    by_src = {}
    for e in mk:
        by_src.setdefault(e.get("source", "?"), []).append(e["markoutPerShare"])
    return {"n_fills": len(fl), "n_markouts": len(mk),
            "by_horizon": horizons,
            "by_source": {s: round(sum(v) / len(v), 5) for s, v in by_src.items()},
            "overall_mean_markout_per_share": round(sum(e["markoutPerShare"] for e in mk) / len(mk), 5)}


def analyze():
    return {"paper": paper_compensation(), "live_fills": live_adverse_selection()}


def _print(a):
    p = a["paper"]; L = a["live_fills"]
    print(f"\n{'='*74}\n  LANE ECONOMICS — does the rebate lane compensate the fill lane?\n{'='*74}")
    if p:
        print("  PAPER (modeled, reward-rounds-enriched):")
        print(f"    rebate ${p['rebate_usd']} (+${p['rebate_per_round']}/rd) | fillPnl net ${p['fillPnl_net_usd']} "
              f"(gains ${p['fillPnl_gross_gain_usd']}, LOSSES ${p['fillPnl_gross_loss_usd']}) | net ${p['net_usd']}")
        print(f"    compensation ratio (rebate / gross fill losses) = {p['compensation_ratio']}x")
        print(f"    rounds where rebate covers the fill loss: {p['rounds_rebate_covers_fillloss_pct']}%")
        print(f"    break-even: need ${p['break_even_rebate_per_round']}/round rebate to offset the gross fill losses")
    print("\n  LIVE (real fills, markout = adverse selection):")
    if L.get("n_markouts"):
        print(f"    {L['n_fills']} fills, {L['n_markouts']} markouts | overall mean markout/share ${L['overall_mean_markout_per_share']} "
              f"({'ADVERSE — picked off' if L['overall_mean_markout_per_share'] < 0 else 'favorable'})")
        for h, d in L["by_horizon"].items():
            print(f"      {h:>5}: mean ${d['mean_markout_per_share']}/sh, {d['adverse_pct']}% adverse (n={d['n']})")
        print(f"    by source: {L['by_source']}")
    else:
        print(f"    {L.get('note', 'n/a')} ({L.get('n_fills', 0)} fills)")
    print("\n  READ: paper says fillPnl is ~net-positive so rebate barely needs to compensate — but the LIVE markout")
    print("  is the truth. If live mean markout/share is negative, real fills are adversely selected and the rebate")
    print("  MUST exceed that cost or the lane bleeds (which is what the live directional losses showed).")
    print(f"{'='*74}\n")


def record():
    a = analyze()
    p, L = a["paper"], a["live_fills"]
    ts = datetime.now(timezone.utc).isoformat()
    rows = []
    if p:
        rows += [(ts, "lane_econ", "compensation_ratio", p["compensation_ratio"], p["n_rounds"], "rebate / gross fill losses (paper)"),
                 (ts, "lane_econ", "break_even_rebate_per_round", p["break_even_rebate_per_round"], p["n_rounds"], "rebate/rd needed to offset fill losses")]
    if L.get("n_markouts"):
        rows.append((ts, "lane_econ", "live_mean_markout_per_share", L["overall_mean_markout_per_share"], L["n_markouts"], "real adverse selection on fills (<0 = picked off)"))
    for db in DBS:
        try:
            con = sqlite3.connect(str(db))
            con.execute("CREATE TABLE IF NOT EXISTS edge_snapshots (ts TEXT, lane TEXT, metric TEXT, value, n INTEGER, detail TEXT)")
            con.executemany("INSERT INTO edge_snapshots VALUES (?,?,?,?,?,?)", rows)
            con.commit(); con.close()
        except Exception as e:
            print(f"  [db] {db}: {e}")
    _print(a)


if __name__ == "__main__":
    record() if "--record" in sys.argv else _print(analyze())
