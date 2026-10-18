# Data Locations — hft-live

**Status (2026-06-22): data ARCHIVED to external drive. Repo holds code only; ~0 bytes of data locally.**

## Where the data lives

| What | Location | Size |
|------|----------|------|
| All `hft-live` data | `/Volumes/My Passport/trading-data-archive/hft-live/data/` | **74 GB** |
| `polymarket.db` (main SQLite, WAL mode) | `…/hft-live/data/polymarket.db` (+ `-wal`, `-shm`) | ~74 GB |
| L2 captures | `…/hft-live/data/captures/` | ~17 MB |

`./data` in this repo is a **symlink** → `/Volumes/My Passport/trading-data-archive/hft-live/data`.
`du -sh data/` reports 74 GB because it follows the symlink to the external drive — the local
footprint is ~0.

## How the path resolves (two mechanisms, both already pointed at MyPassport)

1. **Env var** — `src/lib/db/client.ts:5`: `DB_PATH = process.env.POLYMARKET_DB_PATH ?? data/polymarket.db`.
   `.env.local` sets `POLYMARKET_DB_PATH=/Volumes/My Passport/trading-data-archive/hft-live/data/polymarket.db`.
2. **Symlink** — `./data` → the archive, so even cwd-relative paths (`data/captures/`) resolve there.

⚠️ If you ever remove the `data` symlink, KEEP `POLYMARKET_DB_PATH` set (else `client.ts` recreates an
empty local DB), and recreate the symlink for the relative `captures/` path:
`ln -s "/Volumes/My Passport/trading-data-archive/hft-live/data" data`.

## Writers (archive state = stopped)

Sole writer is the arena cycle (`com.isaiahdupree.hft.arena` launchd → `arena-cron.sh` → `snapshot-worker` /
`arena-tick` / `capture-l2`). It is currently **disabled** (`~/Library/LaunchAgents/com.isaiahdupree.hft.arena.plist.disabled`),
no process holds the DB, and the WAL is checkpointed (0 bytes). To resume: re-enable + `launchctl load` the plist.

**Requires `/Volumes/My Passport` mounted.** It is a USB drive — a live SQLite WAL on USB is a corruption/latency
hazard, so resume writers only deliberately; for cold archival, leave them stopped.
