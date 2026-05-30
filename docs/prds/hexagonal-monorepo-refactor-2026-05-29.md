# Hexagonal monorepo refactor — 2026-05-29

**Goal:** physically restructure the workspace into a `packages/*` + `apps/web` monorepo, fill 4 real architectural gaps (Instrument discriminated union, read-side adapter methods, unified market-data subscription, MCP tool surface), and keep tests + running workers green throughout.

**Recovery point:** git tag `pre-hexagonal-refactor-2026-05-29` (= e4ccc15).

**Non-goals:**

- Behavior change. This is a structural refactor; agents, capsules, DB schema, live workers, dev server output all stay identical.
- Test rewrites. Tests move with their code; no rewrites unless an import is broken by the move.
- Rust/Go rewrite of the hot path (advice mentioned this; declined — none of our edges are microsecond-sensitive).
- NATS / Redis Streams (advice mentioned this; declined — single-machine SQLite is correct for this scale).
- Per-adapter egress routing for compliance (advice mentioned this; declined — personal-use system).

## Architecture target

```
/packages
  /core            # Venue interface, Instrument union, Order/Position/Balance types, ExecutionRouter, KillSwitch, RiskEngine
  /adapters
    /polymarket    # CLOB client + signing + arb + execute + realtime WS
    /coinbase      # Advanced Trade auth + REST + WS
    /aave          # Polygon HF reader + liquidation watcher + leverage advisor
    /sim           # In-process sim adapter for testing
  /strategy        # arena/, strategies/, genome, sim engine, decide()
  /risk            # pre-trade checks, capsule gate (currently in src/lib/risk + src/lib/capsules)
  /oms             # order events log, reconciler
  /data            # SQLite client, schema.sql, migrations, queries
  /quant           # EV, Kelly, Bayes, z-score
  /wallet          # wallet intelligence + typology classifier
  /agent           # research-loop, oracle LLM, MCP tool surface
/apps
  /web             # Next.js: src/app, src/components, middleware, next.config, tailwind
/scripts           # entry points only — import everything from packages/*
/tests             # unchanged paths; tsconfig path aliases resolve to packages/*
```

## Staging strategy: re-export shims, not breaking moves

Each phase:
1. Create new package directory + `package.json` + `tsconfig.json`.
2. Physically move files into the new location.
3. **Leave a re-export shim at the old path** (`export * from "@core/venue/types"`) so existing `@/lib/...` imports continue to resolve.
4. Run `tsc --noEmit` + targeted vitest — must be green.
5. Commit.
6. Future phases gradually update consumers to import from `@core/*` instead of `@/lib/*`.
7. Final phase deletes the shims once nothing references them.

This means **no phase forces a giant `find . -exec sed` over imports**. The blast radius per commit is bounded to "did this file move correctly + does the shim resolve."

## Phase plan

### Phase 1 — Workspace skeleton (today)

- Add `workspaces` to root `package.json`.
- Create empty `packages/{core,adapters/{polymarket,coinbase,aave,sim},strategy,risk,oms,data,quant,wallet,agent}` and `apps/web`.
- Each package gets a stub `package.json` (private, no deps yet) + `tsconfig.json` extending root.
- Update root `tsconfig.json` with path aliases: `@core/*`, `@adapters/*`, `@strategy/*`, etc.
- Verify `tsc --noEmit` is clean (no imports use the new aliases yet, so this should be a no-op).
- Verify dev server still runs.

### Phase 2 — Move src/lib/venue → packages/core

- Move `src/lib/venue/types.ts` → `packages/core/src/venue/types.ts`
- Move `src/lib/venue/router.ts` → `packages/core/src/venue/router.ts`
- Move `src/lib/venue/order-events.ts` → `packages/core/src/venue/order-events.ts`
- Move `src/lib/venue/adapters/{coinbase,polymarket,sim}.ts` → `packages/adapters/{coinbase,polymarket,sim}/src/adapter.ts`
- Move `src/lib/risk/*` → `packages/risk/src/*`
- Re-export shim at `src/lib/venue/index.ts` and `src/lib/risk/index.ts`.
- Run full vitest. Must be green.

### Phase 3 — Move venue SDKs

- `src/lib/polymarket/*` → `packages/adapters/polymarket/src/*`
- `src/lib/coinbase/*` → `packages/adapters/coinbase/src/*`
- `src/lib/onchain/{aave,aave-advisor}.ts` → `packages/adapters/aave/src/*`
- Re-export shims at old paths.
- Run vitest.

### Phase 4 — Move strategy/quant/wallet/data

- `src/lib/arena/*` + `src/lib/strategies/*` + `src/lib/decision/*` → `packages/strategy/src/*`
- `src/lib/quant/*` → `packages/quant/src/*`
- `src/lib/wallet/*` + `src/lib/wallets/*` → `packages/wallet/src/*`
- `src/lib/db/*` → `packages/data/src/*`
- `src/lib/capsules/*` → `packages/risk/src/capsules/*`
- `src/lib/reconcile/*` + `src/lib/stages/*` → `packages/oms/src/*`
- `src/lib/agents/*` + `src/lib/anthropic/*` → `packages/agent/src/*`
- `src/lib/portfolio/*` → `packages/core/src/portfolio/*`
- `src/lib/backtest/*` → `packages/strategy/src/backtest/*`
- Re-export shims at all old paths.
- Run vitest. Run Playwright UI tests.

### Phase 5 — Fill the 4 real gaps

- **5a. `Instrument` discriminated union** in `packages/core/src/instrument.ts`:
  ```typescript
  export type Instrument =
    | { kind: "spot"; venue: VenueId; base: string; quote: string }
    | { kind: "perp"; venue: VenueId; base: string; quote: string; maxLeverage: number }
    | { kind: "prediction"; venue: VenueId; marketId: string; outcome: "UP" | "DOWN" | "YES" | "NO" }
    | { kind: "lending"; venue: VenueId; asset: string; mode: "supply" | "borrow" };
  ```
  Add `instrument?: Instrument` optional field to `UnifiedOrder` (additive, doesn't break existing `symbol: string` callers).
- **5b. Read-side adapter methods** on `VenueAdapter`:
  ```typescript
  getPositions?(): Promise<Position[]>;
  getBalances?(): Promise<Balance[]>;
  ```
  Optional during transition; only Polymarket + Coinbase implement first.
- **5c. `subscribeMarketData`**: unify under one AsyncIterable interface, but **don't migrate the existing snapshot workers** — they're durable and battle-tested. The new interface wraps them.
- **5d. MCP tool surface** in `packages/agent/src/mcp/server.ts` — exposes router.submit, router.health, getPositions, listOrders, getCapsule, listAgents, runArenaTick. Stdio-transport MCP server so Claude can drive the system as tool calls.

### Phase 6 — Carve apps/web

- Move `src/app/*` → `apps/web/src/app/*`
- Move `src/components/*` → `apps/web/src/components/*`
- Move `src/middleware.ts` → `apps/web/src/middleware.ts`
- Move `next.config.mjs`, `tailwind.config.*`, `postcss.config.*`, `next-env.d.ts` → `apps/web/`
- Update `package.json` scripts: `npm run dev` invokes `npm run dev -w apps/web`.
- Run dev server → verify all routes still load.
- Run Playwright UI tests.

### Phase 7 — Delete shims + scripts cleanup

- Update every `scripts/*.ts` import to point at `packages/*` directly.
- Update every remaining `src/app/api/*` and `src/components/*` import (these moved to apps/web in phase 6).
- Delete the shim files at `src/lib/*/index.ts`.
- Final `tsc --noEmit` + full vitest + Playwright pass.
- CHANGELOG entry + git tag `post-hexagonal-refactor-2026-05-29`.

## What's *not* moving

- `tests/` stays at root — vitest config paths resolve to packages.
- `docs/` stays at root.
- `data/` (SQLite + JSON state) stays at root — this is runtime state, not code.
- `.github/`, `Dockerfile`, `docker-compose.yml` stay at root.
- Background workers (`scripts/snapshot-cb-*.ts`, `scripts/snapshot-worker.ts`, etc.) stay in `scripts/` — only their imports change.

## Running infrastructure during refactor

- **Dev server**: stays running between phases. After each phase, hit `/arena/high-pnl-agents` to verify SSR + client still work.
- **Background workers** (cb-depth, cb-stats): keep running. Their imports are at module load — when we move files, restart them after each phase. They each take <2s to restart.
- **23 archetype agents**: unaffected — they're DB rows, not code.
- **Live trading**: still gated by `ALLOW_TRADE=0`; no risk of accidental submission during refactor.

## Failure mode

If any phase produces red tests or a broken page, the recovery is:
```
git reset --hard pre-hexagonal-refactor-2026-05-29  # nuclear: throw out all phases
git reset --hard HEAD~1                              # surgical: revert just the failed phase
```
Each phase commits separately so rollback is one commit.

## Validation gates

After **every** phase:
- `npx tsc --noEmit` clean
- `npm test` green (>=2046 passing, no regressions)
- Dev server returns 200 on `/arena/high-pnl-agents`
- `/api/arena/binary-now` returns JSON with full shape

At final phase:
- Playwright UI tests green
- CHANGELOG entry written
