---
title: "0x_Discover article — 15 cited wallets reconciled vs Polymarket data"
type: reconciliation-report
generated: 2026-06-05
source_article: docs/research/articles/0x_discover-polymarket-40m-arb.md
data_source: "https://data-api.polymarket.com/v1/leaderboard"
---

# 0x_Discover article — 15 cited wallets reconciliation

Generated 2026-06-05T22:08:28.170Z. Re-run via `npm run reconcile:0x-discover`.

## Summary

| Outcome | Count |
|---|---:|
| ✓ Claim supported (within ±15%) | **5** |
| ↓ Claim inflated (actual < claim − 15%) | **2** |
| ↑ Claim understated (actual > claim + 15%) | **7** |
| ? Wallet not found / no leaderboard match | **1** |
| **Total** | **15** |

**Total claimed PnL** (article): `$51,163,000`
**Total actual PnL** (leaderboard, resolved wallets only): `$56,123,046.51`
**Aggregate ratio** (actual / claimed): `1.123`
  → The article's aggregate is understated by 12.3% vs current leaderboard.

## Per-wallet breakdown

| # | Handle | Article claim | Actual PnL | Vol | Rank | Δ% | Outcome |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | `kch123` | $12.00M | $11.59M | $292.7M | #3 | -3.4% | ✓ supported |
| 2 | `RN1` | $7.40M | $9.32M | $616.1M | #5 | +25.9% | ↑ understated |
| 3 | `Swisstony` | $5.90M | $9.47M | $855.3M | #4 | +60.6% | ↑ understated |
| 4 | `GamblingIsAllYouNeed` | $4.60M | $4.79M | $436.1M | #16 | +4.1% | ✓ supported |
| 5 | `DrPufferfish` | $3.40M | $3.76M | $248.5M | #24 | +10.5% | ✓ supported |
| 6 | `sovereign2013` | $3.40M | $3.59M | $399.3M | #28 | +5.6% | ✓ supported |
| 7 | `0x2a2C53bD27` | $2.50M | $4.27M | $477.1M | #22 | +70.6% | ↑ understated |
| 8 | `Countryside` | $2.40M | $4.54M | $375.0M | #19 | +89.2% | ↑ understated |
| 9 | `gatorr` | $2.30M | $1.69M | $51.5M | #70 | -26.5% | ↓ inflated |
| 10 | `weflyhigh` | $1.80M | $2.58M | $124.1M | #40 | +43.3% | ↑ understated |
| 11 | `blindStaking` | $1.50M | $-2.77M | $32.0M | #2800473 | -284.9% | ↓ inflated |
| 12 | `CharlieKirkEvans` | $1.20M | — | — | — | — | ? not found |
| 13 | `JPMorgan101` | $1.10M | $1.38M | $18.9M | #92 | +25.2% | ↑ understated |
| 14 | `cigarettes` | $0.85M | $1.03M | $510.6M | #120 | +21.8% | ↑ understated |
| 15 | `Sharky6999` | $0.81M | $0.90M | $208.7M | #153 | +10.2% | ✓ supported |

## Per-wallet rationale

### kch123

- Claim $12.00M, actual $11.59M → within tolerance (-3.4% vs claim) Leaderboard rank 3. Volume $292.67M.
- ProxyWallet: `0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee`
- userName as returned by leaderboard: `kch123`

### RN1

- Claim $7.40M, actual $9.32M → actual significantly above claim (+25.9% vs claim) Leaderboard rank 5. Volume $616.11M.
- ProxyWallet: `0x2005d16a84ceefa912d4e380cd32e7ff827875ea`
- userName as returned by leaderboard: `RN1`

### Swisstony

- Claim $5.90M, actual $9.47M → actual significantly above claim (+60.6% vs claim) Leaderboard rank 4. Volume $855.30M.
- ProxyWallet: `0x204f72f35326db932158cba6adff0b9a1da95e14`
- userName as returned by leaderboard: `swisstony`

### GamblingIsAllYouNeed

- Claim $4.60M, actual $4.79M → within tolerance (+4.1% vs claim) Leaderboard rank 16. Volume $436.07M.
- ProxyWallet: `0x507e52ef684ca2dd91f90a9d26d149dd3288beae`
- userName as returned by leaderboard: `GamblingIsAllYouNeed`

### DrPufferfish

- Claim $3.40M, actual $3.76M → within tolerance (+10.5% vs claim) Leaderboard rank 24. Volume $248.47M.
- ProxyWallet: `0xdb27bf2ac5d428a9c63dbc914611036855a6c56e`
- userName as returned by leaderboard: `DrPufferfish`

### sovereign2013

- Claim $3.40M, actual $3.59M → within tolerance (+5.6% vs claim) Leaderboard rank 28. Volume $399.25M.
- ProxyWallet: `0xee613b3fc183ee44f9da9c05f53e2da107e3debf`
- userName as returned by leaderboard: `sovereign2013`

### 0x2a2C53bD27

- Claim $2.50M, actual $4.27M → actual significantly above claim (+70.6% vs claim) Leaderboard rank 22. Volume $477.06M.
- ProxyWallet: `0x2a2c53bd278c04da9962fcf96490e17f3dfb9bc1`
- userName as returned by leaderboard: `0x2a2C53bD278c04DA9962Fcf96490E17F3DfB9Bc1-1772479215461`

### Countryside

- Claim $2.40M, actual $4.54M → actual significantly above claim (+89.2% vs claim) Leaderboard rank 19. Volume $375.01M.
- ProxyWallet: `0xbddf61af533ff524d27154e589d2d7a81510c684`
- userName as returned by leaderboard: `Countryside`

### gatorr

- Claim $2.30M, actual $1.69M → actual significantly below claim (-26.5% vs claim) Leaderboard rank 70. Volume $51.48M.
- ProxyWallet: `0x93abbc022ce98d6f45d4444b594791cc4b7a9723`
- userName as returned by leaderboard: `gatorr`

### weflyhigh

- Claim $1.80M, actual $2.58M → actual significantly above claim (+43.3% vs claim) Leaderboard rank 40. Volume $124.10M.
- ProxyWallet: `0x03e8a544e97eeff5753bc1e90d46e5ef22af1697`
- userName as returned by leaderboard: `weflyhigh`

### blindStaking

- Claim $1.50M, actual $-2.77M → actual significantly below claim (-284.9% vs claim) Leaderboard rank 2800473. Volume $32.04M.
- ProxyWallet: `0x50b1db131a24a9d9450bbd0372a95d32ea88f076`
- userName as returned by leaderboard: `blindStaking`

### CharlieKirkEvans

- No leaderboard match for handle "CharlieKirkEvans".

### JPMorgan101

- Claim $1.10M, actual $1.38M → actual significantly above claim (+25.2% vs claim) Leaderboard rank 92. Volume $18.93M.
- ProxyWallet: `0xb6d6e99d3bfe055874a04279f659f009fd57be17`
- userName as returned by leaderboard: `JPMorgan101`

### cigarettes

- Claim $850.0K, actual $1.03M → actual significantly above claim (+21.8% vs claim) Leaderboard rank 120. Volume $510.57M.
- ProxyWallet: `0xd218e474776403a330142299f7796e8ba32eb5c9`
- userName as returned by leaderboard: `cigarettes`

### Sharky6999

- Claim $813.0K, actual $896.1K → within tolerance (+10.2% vs claim) Leaderboard rank 153. Volume $208.68M.
- ProxyWallet: `0x751a2b86cab503496efd325c8344e10159349ea1`
- userName as returned by leaderboard: `Sharky6999`

## Caveats

- The leaderboard returns LIFETIME PnL as of the query time. The article was published 2026-04-17; some wallets may have continued earning or drawn down since.
- Handle collisions: if multiple wallets use the same userName, the leaderboard returns the highest-ranked one. The runner trusts this; if a cited bot is shadowed by a more prolific same-name wallet, the reconciliation will be misleading. Spot-check the proxyWallet against on-chain trades for any wallet where the verdict surprises you.
- `0x2a2C53bD27` was truncated in the article; the resolver matched to a longer wallet that may or may not be the intended one. Flagged separately if the rationale notes this.
- Polymarket's data API tolerance was not verified — the leaderboard `pnl` field may double-count fees or omit certain bonuses. For audit-grade numbers, cross-check via on-chain trades.