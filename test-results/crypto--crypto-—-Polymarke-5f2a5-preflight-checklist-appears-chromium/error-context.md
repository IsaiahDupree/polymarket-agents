# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crypto.spec.ts >> /crypto — Polymarket-style 5m Up/Down widgets >> Trade readiness preflight checklist appears
- Location: tests\ui\crypto.spec.ts:40:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('data freshness < 2 min')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('data freshness < 2 min')

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e4]:
      - generic [ref=e5]: SYSTEM
      - generic [ref=e6]: OK
      - generic [ref=e7]: "|"
      - generic "Polymarket mode" [ref=e8]:
        - text: poly
        - generic [ref=e9]: DRY_RUN
      - generic "Coinbase mode" [ref=e10]:
        - text: cb
        - generic [ref=e11]: DRY_RUN
      - generic [ref=e12]: "|"
      - 'generic "PAPER: 15 capsules wired but ALLOW_TRADE unset → DRY_RUN" [ref=e13]':
        - text: 📝 $750
        - generic [ref=e14]: +$0.00
      - generic [ref=e15]: "|"
      - generic [ref=e16]: alive
      - generic [ref=e17]: "168"
      - generic "7 alive agents have an llm_probability_oracle component (Claude-driven decisions). Remaining 161 are deterministic pattern matchers." [ref=e18]: 🧠 7 AI
      - generic [ref=e19]: "|"
      - generic [ref=e20]: trades today
      - generic [ref=e21]: "0"
      - generic [ref=e22]: "|"
      - generic "markets with no snapshot in 10+ min" [ref=e23]: 2673 stale
      - generic [ref=e24]: refresh 30s · 1:50:55 PM
    - banner [ref=e25]:
      - generic [ref=e26]:
        - link "polyagents" [ref=e27] [cursor=pointer]:
          - /url: /
        - navigation [ref=e28]:
          - link "Overview" [ref=e29] [cursor=pointer]:
            - /url: /
          - button "Markets ▼" [ref=e31] [cursor=pointer]:
            - text: Markets
            - generic [ref=e32]: ▼
          - button "Arena ▼" [ref=e34] [cursor=pointer]:
            - text: Arena
            - generic [ref=e35]: ▼
          - button "Capsules ▼" [ref=e37] [cursor=pointer]:
            - text: Capsules
            - generic [ref=e38]: ▼
          - button "Manage ▼" [ref=e40] [cursor=pointer]:
            - text: Manage
            - generic [ref=e41]: ▼
  - main [ref=e42]:
    - generic [ref=e43]:
      - generic [ref=e44]:
        - button "⏸" [ref=e45] [cursor=pointer]
        - generic [ref=e46]: crypto 15s
      - generic [ref=e47]:
        - generic [ref=e48]:
          - heading "Crypto trading challenge — live" [level=1] [ref=e49]
          - paragraph [ref=e50]:
            - text: Coinbase spot is the truth source. Polymarket Crypto markets are the venue. The video (
            - link "Codex 5.5 vs Claude 4.7" [ref=e51] [cursor=pointer]:
              - /url: https://www.youtube.com/watch?v=6UBGecQTsZE
            - text: ) framed it as rolling 5-min "Will BTC be Up?" binaries — same edge calc surfaced here.
        - generic [ref=e52]:
          - generic [ref=e53]: next 5-min window
          - generic [ref=e54]:
            - generic [ref=e55]: "04"
            - generic [ref=e56]: mins
            - generic [ref=e57]: "05"
            - generic [ref=e58]: secs
      - generic [ref=e59]:
        - generic [ref=e61]:
          - generic [ref=e62]:
            - heading "BTC Up or Down 5m →" [level=2] [ref=e64]:
              - link "BTC Up or Down 5m →" [ref=e65] [cursor=pointer]:
                - /url: /crypto/BTC-USD
            - generic [ref=e67]: May 30, 1:50PM-1:55PM
            - generic [ref=e69]:
              - generic [ref=e70]: "04"
              - generic [ref=e71]: mins
              - generic [ref=e72]: "05"
              - generic [ref=e73]: secs
            - generic [ref=e74]: "9-window history: 6W / 3L"
          - generic [ref=e75]:
            - generic [ref=e76]: Price To Beat
            - generic [ref=e77]: $73,830.4
            - generic [ref=e78]: Current Price
            - generic [ref=e79]: $73,893.55
            - generic [ref=e80]: +$63.15 (0.086%)
          - generic [ref=e81]:
            - generic [ref=e82]:
              - generic [ref=e83]:
                - generic [ref=e84]: Our Up estimate
                - generic [ref=e85]: 63%
              - generic [ref=e86]:
                - generic [ref=e87]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e88]: —
            - generic [ref=e89]:
              - generic [ref=e90]: last 10 windows (close − open)
              - img [ref=e91]:
                - 'generic "5:00Z: $+10.15" [ref=e92]'
                - 'generic "5:05Z: $-51.29" [ref=e94]'
                - 'generic "5:10Z: $+10.99" [ref=e96]'
                - 'generic "5:15Z: $+1.05" [ref=e98]'
                - 'generic "5:20Z: $+91.81" [ref=e100]'
                - 'generic "5:25Z: $-66.59" [ref=e102]'
                - 'generic "5:30Z: $-71.08" [ref=e104]'
                - 'generic "5:35Z: $+62.80" [ref=e106]'
                - 'generic "5:40Z: $+28.58" [ref=e108]'
            - generic [ref=e110]:
              - img [ref=e111]
              - generic [ref=e114]: last 60 × 1-min closes
        - generic [ref=e116]:
          - generic [ref=e117]:
            - heading "ETH Up or Down 5m →" [level=2] [ref=e119]:
              - link "ETH Up or Down 5m →" [ref=e120] [cursor=pointer]:
                - /url: /crypto/ETH-USD
            - generic [ref=e122]: May 30, 1:50PM-1:55PM
            - generic [ref=e124]:
              - generic [ref=e125]: "04"
              - generic [ref=e126]: mins
              - generic [ref=e127]: "05"
              - generic [ref=e128]: secs
            - generic [ref=e129]: "9-window history: 4W / 5L"
          - generic [ref=e130]:
            - generic [ref=e131]: Price To Beat
            - generic [ref=e132]: $2,021.03
            - generic [ref=e133]: Current Price
            - generic [ref=e134]: $2,023.26
            - generic [ref=e135]: +$2.23 (0.110%)
          - generic [ref=e136]:
            - generic [ref=e137]:
              - generic [ref=e138]:
                - generic [ref=e139]: Our Up estimate
                - generic [ref=e140]: 66%
              - generic [ref=e141]:
                - generic [ref=e142]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e143]: —
            - generic [ref=e144]:
              - generic [ref=e145]: last 10 windows (close − open)
              - img [ref=e146]:
                - 'generic "5:00Z: $-0.27" [ref=e147]'
                - 'generic "5:05Z: $-1.35" [ref=e149]'
                - 'generic "5:10Z: $+0.43" [ref=e151]'
                - 'generic "5:15Z: $-0.23" [ref=e153]'
                - 'generic "5:20Z: $+2.49" [ref=e155]'
                - 'generic "5:25Z: $-2.01" [ref=e157]'
                - 'generic "5:30Z: $-4.84" [ref=e159]'
                - 'generic "5:35Z: $+1.65" [ref=e161]'
                - 'generic "5:40Z: $+1.41" [ref=e163]'
            - generic [ref=e165]:
              - img [ref=e166]
              - generic [ref=e169]: last 60 × 1-min closes
        - generic [ref=e171]:
          - generic [ref=e172]:
            - heading "SOL Up or Down 5m →" [level=2] [ref=e174]:
              - link "SOL Up or Down 5m →" [ref=e175] [cursor=pointer]:
                - /url: /crypto/SOL-USD
            - generic [ref=e177]: May 30, 1:50PM-1:55PM
            - generic [ref=e179]:
              - generic [ref=e180]: "04"
              - generic [ref=e181]: mins
              - generic [ref=e182]: "05"
              - generic [ref=e183]: secs
            - generic [ref=e184]: "9-window history: 6W / 3L"
          - generic [ref=e185]:
            - generic [ref=e186]: Price To Beat
            - generic [ref=e187]: $82.74
            - generic [ref=e188]: Current Price
            - generic [ref=e189]: $82.88
            - generic [ref=e190]: +$0.14 (0.169%)
          - generic [ref=e191]:
            - generic [ref=e192]:
              - generic [ref=e193]:
                - generic [ref=e194]: Our Up estimate
                - generic [ref=e195]: 70%
              - generic [ref=e196]:
                - generic [ref=e197]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e198]: —
            - generic [ref=e199]:
              - generic [ref=e200]: last 10 windows (close − open)
              - img [ref=e201]:
                - 'generic "5:00Z: $+0.04" [ref=e202]'
                - 'generic "5:05Z: $-0.10" [ref=e204]'
                - 'generic "5:10Z: $+0.04" [ref=e206]'
                - 'generic "5:15Z: $+0.00"'
                - 'generic "5:20Z: $+0.08" [ref=e208]'
                - 'generic "5:25Z: $-0.08" [ref=e210]'
                - 'generic "5:30Z: $-0.16" [ref=e212]'
                - 'generic "5:35Z: $+0.10" [ref=e214]'
                - 'generic "5:40Z: $+0.06" [ref=e216]'
            - generic [ref=e218]:
              - img [ref=e219]
              - generic [ref=e222]: last 60 × 1-min closes
      - generic [ref=e223]:
        - generic [ref=e224]:
          - heading "All coins at a glance" [level=2] [ref=e225]
          - generic [ref=e226]: 5-min momentum · refreshes with page
        - table [ref=e227]:
          - rowgroup [ref=e228]:
            - row "Coin Price 24h vel 5m accel 5m Our Up%" [ref=e229]:
              - columnheader "Coin" [ref=e230]
              - columnheader "Price" [ref=e231]
              - columnheader "24h" [ref=e232]
              - columnheader "vel 5m" [ref=e233]
              - columnheader "accel 5m" [ref=e234]
              - columnheader "Our Up%" [ref=e235]
          - rowgroup [ref=e236]:
            - row "BTC $73,893.55 — +0.086% +0.010% 63%" [ref=e237]:
              - cell "BTC" [ref=e238]
              - cell "$73,893.55" [ref=e239]
              - cell "—" [ref=e240]
              - cell "+0.086%" [ref=e241]
              - cell "+0.010%" [ref=e242]
              - cell "63%" [ref=e243]
            - row "ETH $2,023.26 — +0.109% +0.008% 66%" [ref=e244]:
              - cell "ETH" [ref=e245]
              - cell "$2,023.26" [ref=e246]
              - cell "—" [ref=e247]
              - cell "+0.109%" [ref=e248]
              - cell "+0.008%" [ref=e249]
              - cell "66%" [ref=e250]
            - row "SOL $82.8800 — +0.145% +0.072% 70%" [ref=e251]:
              - cell "SOL" [ref=e252]
              - cell "$82.8800" [ref=e253]
              - cell "—" [ref=e254]
              - cell "+0.145%" [ref=e255]
              - cell "+0.072%" [ref=e256]
              - cell "70%" [ref=e257]
      - generic [ref=e258]:
        - generic [ref=e259]:
          - generic [ref=e260]:
            - heading "Trade readiness (preflight)" [level=2] [ref=e261]
            - generic [ref=e262]: NOT READY
          - list [ref=e263]:
            - listitem [ref=e264]:
              - generic [ref=e265]: ✓data freshness < 5 min
              - generic [ref=e266]: 177s
            - listitem [ref=e267]:
              - generic [ref=e268]: ✓kill switch clear
              - generic [ref=e269]: ok
            - listitem [ref=e270]:
              - generic [ref=e271]: ✓daily spend under 80% cap
              - generic [ref=e272]: $5.00 / $200
            - listitem [ref=e273]:
              - generic [ref=e274]: ✗Coinbase JWT loaded
              - generic [ref=e275]: missing (set COINBASE_CDP_KEY_FILE or env vars)
            - listitem [ref=e276]:
              - generic [ref=e277]: ✓Polymarket signer (N/A in sim)
              - generic [ref=e278]: —
          - paragraph [ref=e279]: "Mirrors the video's preflight pattern: every check must pass before any agent's entry signal routes to the unified router."
        - generic [ref=e280]:
          - heading "Position caps (Coinbase capsule)" [level=2] [ref=e281]
          - table [ref=e282]:
            - rowgroup [ref=e283]:
              - row "per order $25.00 COINBASE_MAX_TRADE_USD" [ref=e284]:
                - cell "per order" [ref=e285]
                - cell "$25.00" [ref=e286]
                - cell "COINBASE_MAX_TRADE_USD" [ref=e287]:
                  - code [ref=e288]: COINBASE_MAX_TRADE_USD
              - row "daily cap $100.00 COINBASE_MAX_DAILY_USD" [ref=e289]:
                - cell "daily cap" [ref=e290]
                - cell "$100.00" [ref=e291]
                - cell "COINBASE_MAX_DAILY_USD" [ref=e292]:
                  - code [ref=e293]: COINBASE_MAX_DAILY_USD
              - row "spent today (CB) $5.00 DRY_RUN" [ref=e294]:
                - cell "spent today (CB)" [ref=e295]
                - cell "$5.00" [ref=e296]
                - cell "DRY_RUN" [ref=e297]
              - row "spent today (PM) $0.00 DRY_RUN" [ref=e298]:
                - cell "spent today (PM)" [ref=e299]
                - cell "$0.00" [ref=e300]
                - cell "DRY_RUN" [ref=e301]
          - paragraph [ref=e302]:
            - text: "Video defaults: ≤ $3.25/order, ≤ $5.25/market, ≤ $8.25 total open. Tune ours via"
            - code [ref=e303]: COINBASE_MAX_TRADE_USD
            - text: /
            - code [ref=e304]: COINBASE_MAX_DAILY_USD
            - text: in
            - code [ref=e305]: .env.local
            - text: .
      - generic [ref=e306]:
        - generic [ref=e307]:
          - heading "Today's scoreboard" [level=2] [ref=e308]
          - generic [ref=e309]: paper agents, by net P&L
        - paragraph [ref=e310]: No trades today yet. Agents fire as the snapshot worker fills history — momentum strategies need ~30 min of 1-min candles to start firing, fade-spike strategies need hours of poly snapshot history.
      - generic [ref=e311]:
        - generic [ref=e312]:
          - heading "Polymarket Crypto markets (20)" [level=2] [ref=e313]
          - generic [ref=e314]: snapshotted in last 3h · sorted by 24h volume
        - table [ref=e315]:
          - rowgroup [ref=e316]:
            - row "Question Implied Spread 24h vol" [ref=e317]:
              - columnheader "Question" [ref=e318]
              - columnheader "Implied" [ref=e319]
              - columnheader "Spread" [ref=e320]
              - columnheader "24h vol" [ref=e321]
          - rowgroup [ref=e322]:
            - row "MicroStrategy sells any Bitcoin by May 31, 2026? 12.0% 0.10pp $943,810" [ref=e323]:
              - cell "MicroStrategy sells any Bitcoin by May 31, 2026?" [ref=e324]:
                - link "MicroStrategy sells any Bitcoin by May 31, 2026?" [ref=e325] [cursor=pointer]:
                  - /url: /markets/condition/0x3733a1b647e7364095736ab0966465d896a84cf3b6bc1695ca1f26c3239b3868
              - cell "12.0%" [ref=e326]
              - cell "0.10pp" [ref=e327]
              - cell "$943,810" [ref=e328]
            - row "MicroStrategy sells any Bitcoin by June 30, 2026? 71.4% 0.60pp $234,133" [ref=e329]:
              - cell "MicroStrategy sells any Bitcoin by June 30, 2026?" [ref=e330]:
                - link "MicroStrategy sells any Bitcoin by June 30, 2026?" [ref=e331] [cursor=pointer]:
                  - /url: /markets/condition/0x8e7a03cb1970e2ad6533b01892403516b6b3f5b5fa90ed7d104c28b27e40ba00
              - cell "71.4%" [ref=e332]
              - cell "0.60pp" [ref=e333]
              - cell "$234,133" [ref=e334]
            - row "MicroStrategy sells any Bitcoin by December 31, 2026? 88.0% 2.00pp $104,611" [ref=e335]:
              - cell "MicroStrategy sells any Bitcoin by December 31, 2026?" [ref=e336]:
                - link "MicroStrategy sells any Bitcoin by December 31, 2026?" [ref=e337] [cursor=pointer]:
                  - /url: /markets/condition/0x8213d395e079614d6c4d7f4cbb9be9337ab51648a21cc2a334ae8f1966d164b4
              - cell "88.0%" [ref=e338]
              - cell "2.00pp" [ref=e339]
              - cell "$104,611" [ref=e340]
            - row "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET 48.5% 1.00pp $17,355" [ref=e341]:
              - cell "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e342]:
                - link "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e343] [cursor=pointer]:
                  - /url: /markets/condition/0x6f27c2c5f578e3e53c37081c010059937d11181a460d4e3212322412bbff3b3d
              - cell "48.5%" [ref=e344]
              - cell "1.00pp" [ref=e345]
              - cell "$17,355" [ref=e346]
            - row "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $12,109" [ref=e347]:
              - cell "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e348]:
                - link "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e349] [cursor=pointer]:
                  - /url: /markets/condition/0xa326ea55d57013468e227f61b0b626a060ffadfae58f32a5e8149d702d94bdc2
              - cell "0.5%" [ref=e350]
              - cell "1.00pp" [ref=e351]
              - cell "$12,109" [ref=e352]
            - row "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET 97.5% 1.00pp $8,674" [ref=e353]:
              - cell "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET" [ref=e354]:
                - link "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET" [ref=e355] [cursor=pointer]:
                  - /url: /markets/condition/0x1d53ad46f74cad52e960b2410d79d0627470928cdccbe334c4da9f78c7a68c8e
              - cell "97.5%" [ref=e356]
              - cell "1.00pp" [ref=e357]
              - cell "$8,674" [ref=e358]
            - row "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET 97.5% 1.00pp $8,404" [ref=e359]:
              - cell "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e360]:
                - link "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e361] [cursor=pointer]:
                  - /url: /markets/condition/0x7975c4dc693a7bda2f39890fc71c7edede5a1c1a28025b96634546967d3f55fa
              - cell "97.5%" [ref=e362]
              - cell "1.00pp" [ref=e363]
              - cell "$8,404" [ref=e364]
            - row "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET 2.5% 1.00pp $6,814" [ref=e365]:
              - cell "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e366]:
                - link "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e367] [cursor=pointer]:
                  - /url: /markets/condition/0x7dbae8dbd8d3b35b212a2dc7b2c147ede6f643b2e93cf69b2020c1266e0dd201
              - cell "2.5%" [ref=e368]
              - cell "1.00pp" [ref=e369]
              - cell "$6,814" [ref=e370]
            - row "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET 3.5% 0.90pp $6,008" [ref=e371]:
              - cell "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e372]:
                - link "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e373] [cursor=pointer]:
                  - /url: /markets/condition/0x7e4abead50b5f7cfeec70559f72d9bf70fd1d65561bb8476d0828e8435b78dd2
              - cell "3.5%" [ref=e374]
              - cell "0.90pp" [ref=e375]
              - cell "$6,008" [ref=e376]
            - row "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET 4.5% 1.00pp $5,045" [ref=e377]:
              - cell "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET" [ref=e378]:
                - link "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET" [ref=e379] [cursor=pointer]:
                  - /url: /markets/condition/0x9c1d2ab93995dd7c8376c5a3ac0e9b9341720e5c20b9c1bac1cda2079351452a
              - cell "4.5%" [ref=e380]
              - cell "1.00pp" [ref=e381]
              - cell "$5,045" [ref=e382]
            - row "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET 98.5% 1.00pp $4,392" [ref=e383]:
              - cell "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET" [ref=e384]:
                - link "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET" [ref=e385] [cursor=pointer]:
                  - /url: /markets/condition/0xd594c76eb8218209537d8bc6ab59853257a5d7637b38700685d18f69ef5388e3
              - cell "98.5%" [ref=e386]
              - cell "1.00pp" [ref=e387]
              - cell "$4,392" [ref=e388]
            - row "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET 8.5% 1.00pp $3,091" [ref=e389]:
              - cell "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET" [ref=e390]:
                - link "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET" [ref=e391] [cursor=pointer]:
                  - /url: /markets/condition/0x428b5788ac3f3ca0374ea27f23f88e36f54e1a7c88745e6a4e6cf7d349506948
              - cell "8.5%" [ref=e392]
              - cell "1.00pp" [ref=e393]
              - cell "$3,091" [ref=e394]
            - row "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET 54.5% 1.00pp $3,035" [ref=e395]:
              - cell "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET" [ref=e396]:
                - link "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET" [ref=e397] [cursor=pointer]:
                  - /url: /markets/condition/0xd3be4c7c1d1c440818e8e46be579b7d967836441834d5d24e8868c6dcb2d836c
              - cell "54.5%" [ref=e398]
              - cell "1.00pp" [ref=e399]
              - cell "$3,035" [ref=e400]
            - row "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET 96.5% 1.00pp $1,795" [ref=e401]:
              - cell "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e402]:
                - link "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e403] [cursor=pointer]:
                  - /url: /markets/condition/0x84e6266240dff88bb3e54af44cacc3e370a01a422ffaf4d480f0c5e5e227cb88
              - cell "96.5%" [ref=e404]
              - cell "1.00pp" [ref=e405]
              - cell "$1,795" [ref=e406]
            - row "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET 89.5% 1.00pp $1,793" [ref=e407]:
              - cell "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET" [ref=e408]:
                - link "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET" [ref=e409] [cursor=pointer]:
                  - /url: /markets/condition/0x22874250c69f125f52d9645017fcc41cf1386a418886c15c234198aa20e8639d
              - cell "89.5%" [ref=e410]
              - cell "1.00pp" [ref=e411]
              - cell "$1,793" [ref=e412]
            - row "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $1,730" [ref=e413]:
              - cell "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e414]:
                - link "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e415] [cursor=pointer]:
                  - /url: /markets/condition/0x840f66a0b7174a93eb8520c3f1509a92a7a4901c1b55d728fda949849ec2cb72
              - cell "0.5%" [ref=e416]
              - cell "1.00pp" [ref=e417]
              - cell "$1,730" [ref=e418]
            - row "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET 1.5% 1.00pp $1,662" [ref=e419]:
              - cell "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e420]:
                - link "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e421] [cursor=pointer]:
                  - /url: /markets/condition/0xc97b24724566b091d35c216f605881505f1c5c4c1cee223cc1f6142c894e1d0f
              - cell "1.5%" [ref=e422]
              - cell "1.00pp" [ref=e423]
              - cell "$1,662" [ref=e424]
            - row "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET 96.5% 1.00pp $1,614" [ref=e425]:
              - cell "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET" [ref=e426]:
                - link "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET" [ref=e427] [cursor=pointer]:
                  - /url: /markets/condition/0x531e7ddda3d8d165cfb769b3a8d9bccbb5d8aa4419f5c5b2f688411c96f695d5
              - cell "96.5%" [ref=e428]
              - cell "1.00pp" [ref=e429]
              - cell "$1,614" [ref=e430]
            - row "BNB Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $1,550" [ref=e431]:
              - cell "BNB Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e432]:
                - link "BNB Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e433] [cursor=pointer]:
                  - /url: /markets/condition/0xe67d4e09b0f410cf7e58e169b93bd742e8e8f9ed976523f534f3e6ab660ea3f5
              - cell "0.5%" [ref=e434]
              - cell "1.00pp" [ref=e435]
              - cell "$1,550" [ref=e436]
            - row "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET 0.5% 1.00pp $1,470" [ref=e437]:
              - cell "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET" [ref=e438]:
                - link "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET" [ref=e439] [cursor=pointer]:
                  - /url: /markets/condition/0xa4c1bf5d45ea5d527f43152c8e526bae16d9d46af97541a81236d918f2fe6b86
              - cell "0.5%" [ref=e440]
              - cell "1.00pp" [ref=e441]
              - cell "$1,470" [ref=e442]
      - navigation [ref=e443]:
        - link "→ Dashboard JSON" [ref=e444] [cursor=pointer]:
          - /url: /api/crypto/dashboard
        - link "→ Arena" [ref=e445] [cursor=pointer]:
          - /url: /arena
        - link "→ Safety" [ref=e446] [cursor=pointer]:
          - /url: /safety
  - generic [ref=e448]:
    - generic [ref=e449]: TRADES (12)
    - generic [ref=e451]:
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e452] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e453]: entry/SELL
        - generic [ref=e454]: poly:17172924
        - generic [ref=e455]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e456] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e457]: entry/SELL
        - generic [ref=e458]: poly:10164958
        - generic [ref=e459]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e460] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e461]: entry/SELL
        - generic [ref=e462]: poly:84871768
        - generic [ref=e463]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e464] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e465]: entry/BUY
        - generic [ref=e466]: poly:10963197
        - generic [ref=e467]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e468] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e469]: entry/SELL
        - generic [ref=e470]: poly:10164958
        - generic [ref=e471]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e472] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e473]: entry/BUY
        - generic [ref=e474]: poly:49014332
        - generic [ref=e475]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e476] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e477]: entry/BUY
        - generic [ref=e478]: poly:20447903
        - generic [ref=e479]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e480] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e481]: entry/SELL
        - generic [ref=e482]: poly:15962792
        - generic [ref=e483]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e484] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e485]: entry/BUY
        - generic [ref=e486]: poly:51183104
        - generic [ref=e487]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e488] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e489]: entry/BUY
        - generic [ref=e490]: poly:98733003
        - generic [ref=e491]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e492] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e493]: entry/BUY
        - generic [ref=e494]: poly:66651858
        - generic [ref=e495]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e496] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e497]: entry/BUY
        - generic [ref=e498]: poly:89717335
        - generic [ref=e499]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e500] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e501]: entry/SELL
        - generic [ref=e502]: poly:17172924
        - generic [ref=e503]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e504] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e505]: entry/SELL
        - generic [ref=e506]: poly:10164958
        - generic [ref=e507]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e508] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e509]: entry/SELL
        - generic [ref=e510]: poly:84871768
        - generic [ref=e511]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e512] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e513]: entry/BUY
        - generic [ref=e514]: poly:10963197
        - generic [ref=e515]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e516] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e517]: entry/SELL
        - generic [ref=e518]: poly:10164958
        - generic [ref=e519]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e520] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e521]: entry/BUY
        - generic [ref=e522]: poly:49014332
        - generic [ref=e523]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e524] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e525]: entry/BUY
        - generic [ref=e526]: poly:20447903
        - generic [ref=e527]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e528] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e529]: entry/SELL
        - generic [ref=e530]: poly:15962792
        - generic [ref=e531]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e532] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e533]: entry/BUY
        - generic [ref=e534]: poly:51183104
        - generic [ref=e535]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e536] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e537]: entry/BUY
        - generic [ref=e538]: poly:98733003
        - generic [ref=e539]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e540] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e541]: entry/BUY
        - generic [ref=e542]: poly:66651858
        - generic [ref=e543]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e544] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e545]: entry/BUY
        - generic [ref=e546]: poly:89717335
        - generic [ref=e547]: $0.00
        - text: ◆
  - button "Open Next.js Dev Tools" [ref=e553] [cursor=pointer]:
    - img [ref=e554]
  - alert [ref=e557]
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
  36 |       await expect(page.getByTestId(`row-${sym}-USD`)).toBeVisible();
  37 |     }
  38 |   });
  39 | 
  40 |   test("Trade readiness preflight checklist appears", async ({ page }) => {
  41 |     await expect(page.getByText("Trade readiness (preflight)")).toBeVisible();
> 42 |     await expect(page.getByText("data freshness < 2 min")).toBeVisible();
     |                                                            ^ Error: expect(locator).toBeVisible() failed
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