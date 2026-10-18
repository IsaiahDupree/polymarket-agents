# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crypto.spec.ts >> /crypto — Polymarket-style 5m Up/Down widgets >> 'All coins at a glance' table has 5 rows
- Location: tests\ui\crypto.spec.ts:34:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('row-XRP-USD')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('row-XRP-USD')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e4]:
      - generic [ref=e5]: SYSTEM
      - generic [ref=e6]: OK
      - generic [ref=e7]: "|"
      - generic "Polymarket mode" [ref=e8]: poly —
      - generic "Coinbase mode" [ref=e9]: cb —
      - generic [ref=e10]: "|"
      - generic [ref=e11]: alive
      - generic [ref=e12]: —
      - generic [ref=e13]: "|"
      - generic [ref=e14]: trades today
      - generic [ref=e15]: "0"
      - generic [ref=e16]: refresh 30s · —
    - banner [ref=e17]:
      - generic [ref=e18]:
        - link "polyagents" [ref=e19] [cursor=pointer]:
          - /url: /
        - navigation [ref=e20]:
          - link "Overview" [ref=e21] [cursor=pointer]:
            - /url: /
          - button "Markets ▼" [ref=e23] [cursor=pointer]:
            - text: Markets
            - generic [ref=e24]: ▼
          - button "Arena ▼" [ref=e26] [cursor=pointer]:
            - text: Arena
            - generic [ref=e27]: ▼
          - button "Capsules ▼" [ref=e29] [cursor=pointer]:
            - text: Capsules
            - generic [ref=e30]: ▼
          - button "Manage ▼" [ref=e32] [cursor=pointer]:
            - text: Manage
            - generic [ref=e33]: ▼
  - main [ref=e34]:
    - generic [ref=e35]:
      - generic [ref=e36]:
        - button "⏸" [ref=e37] [cursor=pointer]
        - generic [ref=e38]: crypto 15s
      - generic [ref=e39]:
        - generic [ref=e40]:
          - heading "Crypto trading challenge — live" [level=1] [ref=e41]
          - paragraph [ref=e42]:
            - text: Coinbase spot is the truth source. Polymarket Crypto markets are the venue. The video (
            - link "Codex 5.5 vs Claude 4.7" [ref=e43] [cursor=pointer]:
              - /url: https://www.youtube.com/watch?v=6UBGecQTsZE
            - text: ) framed it as rolling 5-min "Will BTC be Up?" binaries — same edge calc surfaced here.
        - generic [ref=e44]:
          - generic [ref=e45]: next 5-min window
          - generic [ref=e46]:
            - generic [ref=e47]: "04"
            - generic [ref=e48]: mins
            - generic [ref=e49]: "44"
            - generic [ref=e50]: secs
      - generic [ref=e51]:
        - generic [ref=e53]:
          - generic [ref=e54]:
            - heading "BTC Up or Down 5m →" [level=2] [ref=e56]:
              - link "BTC Up or Down 5m →" [ref=e57] [cursor=pointer]:
                - /url: /crypto/BTC-USD
            - generic [ref=e59]: May 30, 1:50PM-1:55PM
            - generic [ref=e61]:
              - generic [ref=e62]: "04"
              - generic [ref=e63]: mins
              - generic [ref=e64]: "44"
              - generic [ref=e65]: secs
            - generic [ref=e66]: "9-window history: 6W / 3L"
          - generic [ref=e67]:
            - generic [ref=e68]: Price To Beat
            - generic [ref=e69]: $73,830.4
            - generic [ref=e70]: Current Price
            - generic [ref=e71]: $73,893.55
            - generic [ref=e72]: +$63.15 (0.086%)
          - generic [ref=e73]:
            - generic [ref=e74]:
              - generic [ref=e75]:
                - generic [ref=e76]: Our Up estimate
                - generic [ref=e77]: 63%
              - generic [ref=e78]:
                - generic [ref=e79]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e80]: —
            - generic [ref=e81]:
              - generic [ref=e82]: last 10 windows (close − open)
              - img [ref=e83]:
                - 'generic "5:00Z: $+10.15" [ref=e84]'
                - 'generic "5:05Z: $-51.29" [ref=e86]'
                - 'generic "5:10Z: $+10.99" [ref=e88]'
                - 'generic "5:15Z: $+1.05" [ref=e90]'
                - 'generic "5:20Z: $+91.81" [ref=e92]'
                - 'generic "5:25Z: $-66.59" [ref=e94]'
                - 'generic "5:30Z: $-71.08" [ref=e96]'
                - 'generic "5:35Z: $+62.80" [ref=e98]'
                - 'generic "5:40Z: $+28.58" [ref=e100]'
            - generic [ref=e102]:
              - img [ref=e103]
              - generic [ref=e106]: last 60 × 1-min closes
        - generic [ref=e108]:
          - generic [ref=e109]:
            - heading "ETH Up or Down 5m →" [level=2] [ref=e111]:
              - link "ETH Up or Down 5m →" [ref=e112] [cursor=pointer]:
                - /url: /crypto/ETH-USD
            - generic [ref=e114]: May 30, 1:50PM-1:55PM
            - generic [ref=e116]:
              - generic [ref=e117]: "04"
              - generic [ref=e118]: mins
              - generic [ref=e119]: "44"
              - generic [ref=e120]: secs
            - generic [ref=e121]: "9-window history: 4W / 5L"
          - generic [ref=e122]:
            - generic [ref=e123]: Price To Beat
            - generic [ref=e124]: $2,021.03
            - generic [ref=e125]: Current Price
            - generic [ref=e126]: $2,023.26
            - generic [ref=e127]: +$2.23 (0.110%)
          - generic [ref=e128]:
            - generic [ref=e129]:
              - generic [ref=e130]:
                - generic [ref=e131]: Our Up estimate
                - generic [ref=e132]: 66%
              - generic [ref=e133]:
                - generic [ref=e134]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e135]: —
            - generic [ref=e136]:
              - generic [ref=e137]: last 10 windows (close − open)
              - img [ref=e138]:
                - 'generic "5:00Z: $-0.27" [ref=e139]'
                - 'generic "5:05Z: $-1.35" [ref=e141]'
                - 'generic "5:10Z: $+0.43" [ref=e143]'
                - 'generic "5:15Z: $-0.23" [ref=e145]'
                - 'generic "5:20Z: $+2.49" [ref=e147]'
                - 'generic "5:25Z: $-2.01" [ref=e149]'
                - 'generic "5:30Z: $-4.84" [ref=e151]'
                - 'generic "5:35Z: $+1.65" [ref=e153]'
                - 'generic "5:40Z: $+1.41" [ref=e155]'
            - generic [ref=e157]:
              - img [ref=e158]
              - generic [ref=e161]: last 60 × 1-min closes
        - generic [ref=e163]:
          - generic [ref=e164]:
            - heading "SOL Up or Down 5m →" [level=2] [ref=e166]:
              - link "SOL Up or Down 5m →" [ref=e167] [cursor=pointer]:
                - /url: /crypto/SOL-USD
            - generic [ref=e169]: May 30, 1:50PM-1:55PM
            - generic [ref=e171]:
              - generic [ref=e172]: "04"
              - generic [ref=e173]: mins
              - generic [ref=e174]: "44"
              - generic [ref=e175]: secs
            - generic [ref=e176]: "9-window history: 6W / 3L"
          - generic [ref=e177]:
            - generic [ref=e178]: Price To Beat
            - generic [ref=e179]: $82.74
            - generic [ref=e180]: Current Price
            - generic [ref=e181]: $82.88
            - generic [ref=e182]: +$0.14 (0.169%)
          - generic [ref=e183]:
            - generic [ref=e184]:
              - generic [ref=e185]:
                - generic [ref=e186]: Our Up estimate
                - generic [ref=e187]: 70%
              - generic [ref=e188]:
                - generic [ref=e189]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e190]: —
            - generic [ref=e191]:
              - generic [ref=e192]: last 10 windows (close − open)
              - img [ref=e193]:
                - 'generic "5:00Z: $+0.04" [ref=e194]'
                - 'generic "5:05Z: $-0.10" [ref=e196]'
                - 'generic "5:10Z: $+0.04" [ref=e198]'
                - 'generic "5:15Z: $+0.00"'
                - 'generic "5:20Z: $+0.08" [ref=e200]'
                - 'generic "5:25Z: $-0.08" [ref=e202]'
                - 'generic "5:30Z: $-0.16" [ref=e204]'
                - 'generic "5:35Z: $+0.10" [ref=e206]'
                - 'generic "5:40Z: $+0.06" [ref=e208]'
            - generic [ref=e210]:
              - img [ref=e211]
              - generic [ref=e214]: last 60 × 1-min closes
      - generic [ref=e215]:
        - generic [ref=e216]:
          - heading "All coins at a glance" [level=2] [ref=e217]
          - generic [ref=e218]: 5-min momentum · refreshes with page
        - table [ref=e219]:
          - rowgroup [ref=e220]:
            - row "Coin Price 24h vel 5m accel 5m Our Up%" [ref=e221]:
              - columnheader "Coin" [ref=e222]
              - columnheader "Price" [ref=e223]
              - columnheader "24h" [ref=e224]
              - columnheader "vel 5m" [ref=e225]
              - columnheader "accel 5m" [ref=e226]
              - columnheader "Our Up%" [ref=e227]
          - rowgroup [ref=e228]:
            - row "BTC $73,893.55 — +0.086% +0.010% 63%" [ref=e229]:
              - cell "BTC" [ref=e230]
              - cell "$73,893.55" [ref=e231]
              - cell "—" [ref=e232]
              - cell "+0.086%" [ref=e233]
              - cell "+0.010%" [ref=e234]
              - cell "63%" [ref=e235]
            - row "ETH $2,023.26 — +0.109% +0.008% 66%" [ref=e236]:
              - cell "ETH" [ref=e237]
              - cell "$2,023.26" [ref=e238]
              - cell "—" [ref=e239]
              - cell "+0.109%" [ref=e240]
              - cell "+0.008%" [ref=e241]
              - cell "66%" [ref=e242]
            - row "SOL $82.8800 — +0.145% +0.072% 70%" [ref=e243]:
              - cell "SOL" [ref=e244]
              - cell "$82.8800" [ref=e245]
              - cell "—" [ref=e246]
              - cell "+0.145%" [ref=e247]
              - cell "+0.072%" [ref=e248]
              - cell "70%" [ref=e249]
      - generic [ref=e250]:
        - generic [ref=e251]:
          - generic [ref=e252]:
            - heading "Trade readiness (preflight)" [level=2] [ref=e253]
            - generic [ref=e254]: NOT READY
          - list [ref=e255]:
            - listitem [ref=e256]:
              - generic [ref=e257]: ✓data freshness < 5 min
              - generic [ref=e258]: 147s
            - listitem [ref=e259]:
              - generic [ref=e260]: ✓kill switch clear
              - generic [ref=e261]: ok
            - listitem [ref=e262]:
              - generic [ref=e263]: ✓daily spend under 80% cap
              - generic [ref=e264]: $5.00 / $200
            - listitem [ref=e265]:
              - generic [ref=e266]: ✗Coinbase JWT loaded
              - generic [ref=e267]: missing (set COINBASE_CDP_KEY_FILE or env vars)
            - listitem [ref=e268]:
              - generic [ref=e269]: ✓Polymarket signer (N/A in sim)
              - generic [ref=e270]: —
          - paragraph [ref=e271]: "Mirrors the video's preflight pattern: every check must pass before any agent's entry signal routes to the unified router."
        - generic [ref=e272]:
          - heading "Position caps (Coinbase capsule)" [level=2] [ref=e273]
          - table [ref=e274]:
            - rowgroup [ref=e275]:
              - row "per order $25.00 COINBASE_MAX_TRADE_USD" [ref=e276]:
                - cell "per order" [ref=e277]
                - cell "$25.00" [ref=e278]
                - cell "COINBASE_MAX_TRADE_USD" [ref=e279]:
                  - code [ref=e280]: COINBASE_MAX_TRADE_USD
              - row "daily cap $100.00 COINBASE_MAX_DAILY_USD" [ref=e281]:
                - cell "daily cap" [ref=e282]
                - cell "$100.00" [ref=e283]
                - cell "COINBASE_MAX_DAILY_USD" [ref=e284]:
                  - code [ref=e285]: COINBASE_MAX_DAILY_USD
              - row "spent today (CB) $5.00 DRY_RUN" [ref=e286]:
                - cell "spent today (CB)" [ref=e287]
                - cell "$5.00" [ref=e288]
                - cell "DRY_RUN" [ref=e289]
              - row "spent today (PM) $0.00 DRY_RUN" [ref=e290]:
                - cell "spent today (PM)" [ref=e291]
                - cell "$0.00" [ref=e292]
                - cell "DRY_RUN" [ref=e293]
          - paragraph [ref=e294]:
            - text: "Video defaults: ≤ $3.25/order, ≤ $5.25/market, ≤ $8.25 total open. Tune ours via"
            - code [ref=e295]: COINBASE_MAX_TRADE_USD
            - text: /
            - code [ref=e296]: COINBASE_MAX_DAILY_USD
            - text: in
            - code [ref=e297]: .env.local
            - text: .
      - generic [ref=e298]:
        - generic [ref=e299]:
          - heading "Today's scoreboard" [level=2] [ref=e300]
          - generic [ref=e301]: paper agents, by net P&L
        - paragraph [ref=e302]: No trades today yet. Agents fire as the snapshot worker fills history — momentum strategies need ~30 min of 1-min candles to start firing, fade-spike strategies need hours of poly snapshot history.
      - generic [ref=e303]:
        - generic [ref=e304]:
          - heading "Polymarket Crypto markets (20)" [level=2] [ref=e305]
          - generic [ref=e306]: snapshotted in last 3h · sorted by 24h volume
        - table [ref=e307]:
          - rowgroup [ref=e308]:
            - row "Question Implied Spread 24h vol" [ref=e309]:
              - columnheader "Question" [ref=e310]
              - columnheader "Implied" [ref=e311]
              - columnheader "Spread" [ref=e312]
              - columnheader "24h vol" [ref=e313]
          - rowgroup [ref=e314]:
            - row "MicroStrategy sells any Bitcoin by May 31, 2026? 12.0% 0.10pp $943,810" [ref=e315]:
              - cell "MicroStrategy sells any Bitcoin by May 31, 2026?" [ref=e316]:
                - link "MicroStrategy sells any Bitcoin by May 31, 2026?" [ref=e317] [cursor=pointer]:
                  - /url: /markets/condition/0x3733a1b647e7364095736ab0966465d896a84cf3b6bc1695ca1f26c3239b3868
              - cell "12.0%" [ref=e318]
              - cell "0.10pp" [ref=e319]
              - cell "$943,810" [ref=e320]
            - row "MicroStrategy sells any Bitcoin by June 30, 2026? 71.4% 0.60pp $234,133" [ref=e321]:
              - cell "MicroStrategy sells any Bitcoin by June 30, 2026?" [ref=e322]:
                - link "MicroStrategy sells any Bitcoin by June 30, 2026?" [ref=e323] [cursor=pointer]:
                  - /url: /markets/condition/0x8e7a03cb1970e2ad6533b01892403516b6b3f5b5fa90ed7d104c28b27e40ba00
              - cell "71.4%" [ref=e324]
              - cell "0.60pp" [ref=e325]
              - cell "$234,133" [ref=e326]
            - row "MicroStrategy sells any Bitcoin by December 31, 2026? 88.0% 2.00pp $104,611" [ref=e327]:
              - cell "MicroStrategy sells any Bitcoin by December 31, 2026?" [ref=e328]:
                - link "MicroStrategy sells any Bitcoin by December 31, 2026?" [ref=e329] [cursor=pointer]:
                  - /url: /markets/condition/0x8213d395e079614d6c4d7f4cbb9be9337ab51648a21cc2a334ae8f1966d164b4
              - cell "88.0%" [ref=e330]
              - cell "2.00pp" [ref=e331]
              - cell "$104,611" [ref=e332]
            - row "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET 48.5% 1.00pp $17,355" [ref=e333]:
              - cell "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e334]:
                - link "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e335] [cursor=pointer]:
                  - /url: /markets/condition/0x6f27c2c5f578e3e53c37081c010059937d11181a460d4e3212322412bbff3b3d
              - cell "48.5%" [ref=e336]
              - cell "1.00pp" [ref=e337]
              - cell "$17,355" [ref=e338]
            - row "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $12,109" [ref=e339]:
              - cell "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e340]:
                - link "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e341] [cursor=pointer]:
                  - /url: /markets/condition/0xa326ea55d57013468e227f61b0b626a060ffadfae58f32a5e8149d702d94bdc2
              - cell "0.5%" [ref=e342]
              - cell "1.00pp" [ref=e343]
              - cell "$12,109" [ref=e344]
            - row "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET 97.5% 1.00pp $8,674" [ref=e345]:
              - cell "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET" [ref=e346]:
                - link "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET" [ref=e347] [cursor=pointer]:
                  - /url: /markets/condition/0x1d53ad46f74cad52e960b2410d79d0627470928cdccbe334c4da9f78c7a68c8e
              - cell "97.5%" [ref=e348]
              - cell "1.00pp" [ref=e349]
              - cell "$8,674" [ref=e350]
            - row "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET 97.5% 1.00pp $8,404" [ref=e351]:
              - cell "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e352]:
                - link "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e353] [cursor=pointer]:
                  - /url: /markets/condition/0x7975c4dc693a7bda2f39890fc71c7edede5a1c1a28025b96634546967d3f55fa
              - cell "97.5%" [ref=e354]
              - cell "1.00pp" [ref=e355]
              - cell "$8,404" [ref=e356]
            - row "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET 2.5% 1.00pp $6,814" [ref=e357]:
              - cell "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e358]:
                - link "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e359] [cursor=pointer]:
                  - /url: /markets/condition/0x7dbae8dbd8d3b35b212a2dc7b2c147ede6f643b2e93cf69b2020c1266e0dd201
              - cell "2.5%" [ref=e360]
              - cell "1.00pp" [ref=e361]
              - cell "$6,814" [ref=e362]
            - row "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET 3.5% 0.90pp $6,008" [ref=e363]:
              - cell "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e364]:
                - link "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e365] [cursor=pointer]:
                  - /url: /markets/condition/0x7e4abead50b5f7cfeec70559f72d9bf70fd1d65561bb8476d0828e8435b78dd2
              - cell "3.5%" [ref=e366]
              - cell "0.90pp" [ref=e367]
              - cell "$6,008" [ref=e368]
            - row "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET 4.5% 1.00pp $5,045" [ref=e369]:
              - cell "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET" [ref=e370]:
                - link "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET" [ref=e371] [cursor=pointer]:
                  - /url: /markets/condition/0x9c1d2ab93995dd7c8376c5a3ac0e9b9341720e5c20b9c1bac1cda2079351452a
              - cell "4.5%" [ref=e372]
              - cell "1.00pp" [ref=e373]
              - cell "$5,045" [ref=e374]
            - row "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET 98.5% 1.00pp $4,392" [ref=e375]:
              - cell "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET" [ref=e376]:
                - link "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET" [ref=e377] [cursor=pointer]:
                  - /url: /markets/condition/0xd594c76eb8218209537d8bc6ab59853257a5d7637b38700685d18f69ef5388e3
              - cell "98.5%" [ref=e378]
              - cell "1.00pp" [ref=e379]
              - cell "$4,392" [ref=e380]
            - row "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET 8.5% 1.00pp $3,091" [ref=e381]:
              - cell "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET" [ref=e382]:
                - link "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET" [ref=e383] [cursor=pointer]:
                  - /url: /markets/condition/0x428b5788ac3f3ca0374ea27f23f88e36f54e1a7c88745e6a4e6cf7d349506948
              - cell "8.5%" [ref=e384]
              - cell "1.00pp" [ref=e385]
              - cell "$3,091" [ref=e386]
            - row "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET 54.5% 1.00pp $3,035" [ref=e387]:
              - cell "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET" [ref=e388]:
                - link "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET" [ref=e389] [cursor=pointer]:
                  - /url: /markets/condition/0xd3be4c7c1d1c440818e8e46be579b7d967836441834d5d24e8868c6dcb2d836c
              - cell "54.5%" [ref=e390]
              - cell "1.00pp" [ref=e391]
              - cell "$3,035" [ref=e392]
            - row "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET 96.5% 1.00pp $1,795" [ref=e393]:
              - cell "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e394]:
                - link "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e395] [cursor=pointer]:
                  - /url: /markets/condition/0x84e6266240dff88bb3e54af44cacc3e370a01a422ffaf4d480f0c5e5e227cb88
              - cell "96.5%" [ref=e396]
              - cell "1.00pp" [ref=e397]
              - cell "$1,795" [ref=e398]
            - row "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET 89.5% 1.00pp $1,793" [ref=e399]:
              - cell "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET" [ref=e400]:
                - link "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET" [ref=e401] [cursor=pointer]:
                  - /url: /markets/condition/0x22874250c69f125f52d9645017fcc41cf1386a418886c15c234198aa20e8639d
              - cell "89.5%" [ref=e402]
              - cell "1.00pp" [ref=e403]
              - cell "$1,793" [ref=e404]
            - row "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $1,730" [ref=e405]:
              - cell "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e406]:
                - link "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e407] [cursor=pointer]:
                  - /url: /markets/condition/0x840f66a0b7174a93eb8520c3f1509a92a7a4901c1b55d728fda949849ec2cb72
              - cell "0.5%" [ref=e408]
              - cell "1.00pp" [ref=e409]
              - cell "$1,730" [ref=e410]
            - row "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET 1.5% 1.00pp $1,662" [ref=e411]:
              - cell "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e412]:
                - link "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e413] [cursor=pointer]:
                  - /url: /markets/condition/0xc97b24724566b091d35c216f605881505f1c5c4c1cee223cc1f6142c894e1d0f
              - cell "1.5%" [ref=e414]
              - cell "1.00pp" [ref=e415]
              - cell "$1,662" [ref=e416]
            - row "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET 96.5% 1.00pp $1,614" [ref=e417]:
              - cell "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET" [ref=e418]:
                - link "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET" [ref=e419] [cursor=pointer]:
                  - /url: /markets/condition/0x531e7ddda3d8d165cfb769b3a8d9bccbb5d8aa4419f5c5b2f688411c96f695d5
              - cell "96.5%" [ref=e420]
              - cell "1.00pp" [ref=e421]
              - cell "$1,614" [ref=e422]
            - row "BNB Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $1,550" [ref=e423]:
              - cell "BNB Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e424]:
                - link "BNB Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e425] [cursor=pointer]:
                  - /url: /markets/condition/0xe67d4e09b0f410cf7e58e169b93bd742e8e8f9ed976523f534f3e6ab660ea3f5
              - cell "0.5%" [ref=e426]
              - cell "1.00pp" [ref=e427]
              - cell "$1,550" [ref=e428]
            - row "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET 0.5% 1.00pp $1,470" [ref=e429]:
              - cell "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET" [ref=e430]:
                - link "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET" [ref=e431] [cursor=pointer]:
                  - /url: /markets/condition/0xa4c1bf5d45ea5d527f43152c8e526bae16d9d46af97541a81236d918f2fe6b86
              - cell "0.5%" [ref=e432]
              - cell "1.00pp" [ref=e433]
              - cell "$1,470" [ref=e434]
      - navigation [ref=e435]:
        - link "→ Dashboard JSON" [ref=e436] [cursor=pointer]:
          - /url: /api/crypto/dashboard
        - link "→ Arena" [ref=e437] [cursor=pointer]:
          - /url: /arena
        - link "→ Safety" [ref=e438] [cursor=pointer]:
          - /url: /safety
  - generic [ref=e439]: TRADES — no fills yet. Random walkers + momentum agents fire as data accumulates.
  - alert [ref=e440]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | 
  3  | test.describe("/crypto — Polymarket-style 5m Up/Down widgets", () => {
  4  |   test.beforeEach(async ({ page }) => {
  5  |     await page.goto("/crypto");
  6  |   });
  7  | 
  8  |   test("page loads with title and big window countdown", async ({ page }) => {
  9  |     await expect(page.locator("h1")).toContainText("Crypto trading challenge");
  10 |     await expect(page.getByText("next 5-min window")).toBeVisible();
  11 |   });
  12 | 
  13 |   test("renders a per-coin 'Up or Down 5m' widget for each configured product", async ({ page }) => {
  14 |     for (const sym of ["BTC", "ETH", "SOL", "XRP", "DOGE"]) {
  15 |       const card = page.getByTestId(`crypto-card-${sym}-USD`);
  16 |       await expect(card).toBeVisible();
  17 |       await expect(card).toContainText(`${sym} Up or Down 5m`);
  18 |       await expect(card.getByText("Price To Beat")).toBeVisible();
  19 |       await expect(card.getByText("Current Price")).toBeVisible();
  20 |       await expect(card.getByText("Our Up estimate")).toBeVisible();
  21 |       await expect(card.getByText("last 10 windows")).toBeVisible();
  22 |     }
  23 |   });
  24 | 
  25 |   test("countdown updates every second (Mins:Secs ticks)", async ({ page }) => {
  26 |     const secs = page.getByTestId("live-countdown-secs").first();
  27 |     await expect(secs).toBeVisible();
  28 |     const initial = (await secs.textContent()) ?? "";
  29 |     await page.waitForTimeout(2200);
  30 |     const after = (await secs.textContent()) ?? "";
  31 |     expect(initial).not.toBe(after);
  32 |   });
  33 | 
  34 |   test("'All coins at a glance' table has 5 rows", async ({ page }) => {
  35 |     for (const sym of ["BTC", "ETH", "SOL", "XRP", "DOGE"]) {
> 36 |       await expect(page.getByTestId(`row-${sym}-USD`)).toBeVisible();
     |                                                        ^ Error: expect(locator).toBeVisible() failed
  37 |     }
  38 |   });
  39 | 
  40 |   test("Trade readiness preflight checklist appears", async ({ page }) => {
  41 |     await expect(page.getByText("Trade readiness (preflight)")).toBeVisible();
  42 |     await expect(page.getByText("data freshness < 2 min")).toBeVisible();
  43 |     await expect(page.getByText("kill switch clear")).toBeVisible();
  44 |   });
  45 | 
  46 |   test("'Position caps (Coinbase capsule)' panel renders with env-var labels", async ({ page }) => {
  47 |     await expect(page.getByText("Position caps (Coinbase capsule)")).toBeVisible();
  48 |     // Env-var names appear inside <code> elements — use locator for the code block.
  49 |     await expect(page.locator("code", { hasText: "COINBASE_MAX_TRADE_USD" }).first()).toBeVisible();
  50 |     await expect(page.locator("code", { hasText: "COINBASE_MAX_DAILY_USD" }).first()).toBeVisible();
  51 |   });
  52 | });
  53 | 
```