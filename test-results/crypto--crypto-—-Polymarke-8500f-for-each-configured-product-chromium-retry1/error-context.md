# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: crypto.spec.ts >> /crypto — Polymarket-style 5m Up/Down widgets >> renders a per-coin 'Up or Down 5m' widget for each configured product
- Location: tests\ui\crypto.spec.ts:13:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByTestId('crypto-card-XRP-USD')
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByTestId('crypto-card-XRP-USD')

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
      - generic "markets with no snapshot in 10+ min" [ref=e23]: 2680 stale
      - generic [ref=e24]: refresh 30s · 1:44:48 PM
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
            - generic [ref=e55]: "00"
            - generic [ref=e56]: mins
            - generic [ref=e57]: "10"
            - generic [ref=e58]: secs
      - generic [ref=e59]:
        - generic [ref=e61]:
          - generic [ref=e62]:
            - heading "BTC Up or Down 5m →" [level=2] [ref=e64]:
              - link "BTC Up or Down 5m →" [ref=e65] [cursor=pointer]:
                - /url: /crypto/BTC-USD
            - generic [ref=e67]: May 30, 1:40PM-1:45PM
            - generic [ref=e69]:
              - generic [ref=e70]: "00"
              - generic [ref=e71]: mins
              - generic [ref=e72]: "10"
              - generic [ref=e73]: secs
            - generic [ref=e74]: "10-window history: 7W / 3L"
          - generic [ref=e75]:
            - generic [ref=e76]: Price To Beat
            - generic [ref=e77]: $73,815.31
            - generic [ref=e78]: Current Price
            - generic [ref=e79]: $73,829.24
            - generic [ref=e80]: +$13.93 (0.019%)
          - generic [ref=e81]:
            - generic [ref=e82]:
              - generic [ref=e83]:
                - generic [ref=e84]: Our Up estimate
                - generic [ref=e85]: 67%
              - generic [ref=e86]:
                - generic [ref=e87]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e88]: —
            - generic [ref=e89]:
              - generic [ref=e90]: last 10 windows (close − open)
              - img [ref=e91]:
                - 'generic "4:50Z: $+1.14" [ref=e92]'
                - 'generic "4:55Z: $+4.71" [ref=e94]'
                - 'generic "5:00Z: $+10.15" [ref=e96]'
                - 'generic "5:05Z: $-51.29" [ref=e98]'
                - 'generic "5:10Z: $+10.99" [ref=e100]'
                - 'generic "5:15Z: $+1.05" [ref=e102]'
                - 'generic "5:20Z: $+91.81" [ref=e104]'
                - 'generic "5:25Z: $-66.59" [ref=e106]'
                - 'generic "5:30Z: $-71.08" [ref=e108]'
                - 'generic "5:35Z: $+62.80" [ref=e110]'
            - generic [ref=e112]:
              - img [ref=e113]
              - generic [ref=e116]: last 60 × 1-min closes
        - generic [ref=e118]:
          - generic [ref=e119]:
            - heading "ETH Up or Down 5m →" [level=2] [ref=e121]:
              - link "ETH Up or Down 5m →" [ref=e122] [cursor=pointer]:
                - /url: /crypto/ETH-USD
            - generic [ref=e124]: May 30, 1:40PM-1:45PM
            - generic [ref=e126]:
              - generic [ref=e127]: "00"
              - generic [ref=e128]: mins
              - generic [ref=e129]: "10"
              - generic [ref=e130]: secs
            - generic [ref=e131]: "10-window history: 5W / 5L"
          - generic [ref=e132]:
            - generic [ref=e133]: Price To Beat
            - generic [ref=e134]: $2,020.15
            - generic [ref=e135]: Current Price
            - generic [ref=e136]: $2,021.01
            - generic [ref=e137]: +$0.86 (0.043%)
          - generic [ref=e138]:
            - generic [ref=e139]:
              - generic [ref=e140]:
                - generic [ref=e141]: Our Up estimate
                - generic [ref=e142]: 74%
              - generic [ref=e143]:
                - generic [ref=e144]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e145]: —
            - generic [ref=e146]:
              - generic [ref=e147]: last 10 windows (close − open)
              - img [ref=e148]:
                - 'generic "4:50Z: $+0.57" [ref=e149]'
                - 'generic "4:55Z: $+0.13" [ref=e151]'
                - 'generic "5:00Z: $-0.27" [ref=e153]'
                - 'generic "5:05Z: $-1.35" [ref=e155]'
                - 'generic "5:10Z: $+0.43" [ref=e157]'
                - 'generic "5:15Z: $-0.23" [ref=e159]'
                - 'generic "5:20Z: $+2.49" [ref=e161]'
                - 'generic "5:25Z: $-2.01" [ref=e163]'
                - 'generic "5:30Z: $-4.84" [ref=e165]'
                - 'generic "5:35Z: $+1.65" [ref=e167]'
            - generic [ref=e169]:
              - img [ref=e170]
              - generic [ref=e173]: last 60 × 1-min closes
        - generic [ref=e175]:
          - generic [ref=e176]:
            - heading "SOL Up or Down 5m →" [level=2] [ref=e178]:
              - link "SOL Up or Down 5m →" [ref=e179] [cursor=pointer]:
                - /url: /crypto/SOL-USD
            - generic [ref=e181]: May 30, 1:40PM-1:45PM
            - generic [ref=e183]:
              - generic [ref=e184]: "00"
              - generic [ref=e185]: mins
              - generic [ref=e186]: "10"
              - generic [ref=e187]: secs
            - generic [ref=e188]: "10-window history: 7W / 3L"
          - generic [ref=e189]:
            - generic [ref=e190]: Price To Beat
            - generic [ref=e191]: $82.71
            - generic [ref=e192]: Current Price
            - generic [ref=e193]: $82.77
            - generic [ref=e194]: +$0.06 (0.073%)
          - generic [ref=e195]:
            - generic [ref=e196]:
              - generic [ref=e197]:
                - generic [ref=e198]: Our Up estimate
                - generic [ref=e199]: 76%
              - generic [ref=e200]:
                - generic [ref=e201]: PM-implied
                - generic "No PM rolling-5m market currently snapshotted" [ref=e202]: —
            - generic [ref=e203]:
              - generic [ref=e204]: last 10 windows (close − open)
              - img [ref=e205]:
                - 'generic "4:50Z: $+0.01" [ref=e206]'
                - 'generic "4:55Z: $+0.03" [ref=e208]'
                - 'generic "5:00Z: $+0.04" [ref=e210]'
                - 'generic "5:05Z: $-0.10" [ref=e212]'
                - 'generic "5:10Z: $+0.04" [ref=e214]'
                - 'generic "5:15Z: $+0.00"'
                - 'generic "5:20Z: $+0.08" [ref=e216]'
                - 'generic "5:25Z: $-0.08" [ref=e218]'
                - 'generic "5:30Z: $-0.16" [ref=e220]'
                - 'generic "5:35Z: $+0.10" [ref=e222]'
            - generic [ref=e224]:
              - img [ref=e225]
              - generic [ref=e228]: last 60 × 1-min closes
      - generic [ref=e229]:
        - generic [ref=e230]:
          - heading "All coins at a glance" [level=2] [ref=e231]
          - generic [ref=e232]: 5-min momentum · refreshes with page
        - table [ref=e233]:
          - rowgroup [ref=e234]:
            - row "Coin Price 24h vel 5m accel 5m Our Up%" [ref=e235]:
              - columnheader "Coin" [ref=e236]
              - columnheader "Price" [ref=e237]
              - columnheader "24h" [ref=e238]
              - columnheader "vel 5m" [ref=e239]
              - columnheader "accel 5m" [ref=e240]
              - columnheader "Our Up%" [ref=e241]
          - rowgroup [ref=e242]:
            - row "BTC $73,829.24 — +0.120% -0.090% 67%" [ref=e243]:
              - cell "BTC" [ref=e244]
              - cell "$73,829.24" [ref=e245]
              - cell "—" [ref=e246]
              - cell "+0.120%" [ref=e247]
              - cell "-0.090%" [ref=e248]
              - cell "67%" [ref=e249]
            - row "ETH $2,021.01 — +0.171% -0.085% 74%" [ref=e250]:
              - cell "ETH" [ref=e251]
              - cell "$2,021.01" [ref=e252]
              - cell "—" [ref=e253]
              - cell "+0.171%" [ref=e254]
              - cell "-0.085%" [ref=e255]
              - cell "74%" [ref=e256]
            - row "SOL $82.7700 — +0.194% -0.049% 76%" [ref=e257]:
              - cell "SOL" [ref=e258]
              - cell "$82.7700" [ref=e259]
              - cell "—" [ref=e260]
              - cell "+0.194%" [ref=e261]
              - cell "-0.049%" [ref=e262]
              - cell "76%" [ref=e263]
      - generic [ref=e264]:
        - generic [ref=e265]:
          - generic [ref=e266]:
            - heading "Trade readiness (preflight)" [level=2] [ref=e267]
            - generic [ref=e268]: NOT READY
          - list [ref=e269]:
            - listitem [ref=e270]:
              - generic [ref=e271]: ✓data freshness < 5 min
              - generic [ref=e272]: 95s
            - listitem [ref=e273]:
              - generic [ref=e274]: ✓kill switch clear
              - generic [ref=e275]: ok
            - listitem [ref=e276]:
              - generic [ref=e277]: ✓daily spend under 80% cap
              - generic [ref=e278]: $5.00 / $200
            - listitem [ref=e279]:
              - generic [ref=e280]: ✗Coinbase JWT loaded
              - generic [ref=e281]: missing (set COINBASE_CDP_KEY_FILE or env vars)
            - listitem [ref=e282]:
              - generic [ref=e283]: ✓Polymarket signer (N/A in sim)
              - generic [ref=e284]: —
          - paragraph [ref=e285]: "Mirrors the video's preflight pattern: every check must pass before any agent's entry signal routes to the unified router."
        - generic [ref=e286]:
          - heading "Position caps (Coinbase capsule)" [level=2] [ref=e287]
          - table [ref=e288]:
            - rowgroup [ref=e289]:
              - row "per order $25.00 COINBASE_MAX_TRADE_USD" [ref=e290]:
                - cell "per order" [ref=e291]
                - cell "$25.00" [ref=e292]
                - cell "COINBASE_MAX_TRADE_USD" [ref=e293]:
                  - code [ref=e294]: COINBASE_MAX_TRADE_USD
              - row "daily cap $100.00 COINBASE_MAX_DAILY_USD" [ref=e295]:
                - cell "daily cap" [ref=e296]
                - cell "$100.00" [ref=e297]
                - cell "COINBASE_MAX_DAILY_USD" [ref=e298]:
                  - code [ref=e299]: COINBASE_MAX_DAILY_USD
              - row "spent today (CB) $5.00 DRY_RUN" [ref=e300]:
                - cell "spent today (CB)" [ref=e301]
                - cell "$5.00" [ref=e302]
                - cell "DRY_RUN" [ref=e303]
              - row "spent today (PM) $0.00 DRY_RUN" [ref=e304]:
                - cell "spent today (PM)" [ref=e305]
                - cell "$0.00" [ref=e306]
                - cell "DRY_RUN" [ref=e307]
          - paragraph [ref=e308]:
            - text: "Video defaults: ≤ $3.25/order, ≤ $5.25/market, ≤ $8.25 total open. Tune ours via"
            - code [ref=e309]: COINBASE_MAX_TRADE_USD
            - text: /
            - code [ref=e310]: COINBASE_MAX_DAILY_USD
            - text: in
            - code [ref=e311]: .env.local
            - text: .
      - generic [ref=e312]:
        - generic [ref=e313]:
          - heading "Today's scoreboard" [level=2] [ref=e314]
          - generic [ref=e315]: paper agents, by net P&L
        - paragraph [ref=e316]: No trades today yet. Agents fire as the snapshot worker fills history — momentum strategies need ~30 min of 1-min candles to start firing, fade-spike strategies need hours of poly snapshot history.
      - generic [ref=e317]:
        - generic [ref=e318]:
          - heading "Polymarket Crypto markets (20)" [level=2] [ref=e319]
          - generic [ref=e320]: snapshotted in last 3h · sorted by 24h volume
        - table [ref=e321]:
          - rowgroup [ref=e322]:
            - row "Question Implied Spread 24h vol" [ref=e323]:
              - columnheader "Question" [ref=e324]
              - columnheader "Implied" [ref=e325]
              - columnheader "Spread" [ref=e326]
              - columnheader "24h vol" [ref=e327]
          - rowgroup [ref=e328]:
            - row "MicroStrategy sells any Bitcoin by May 31, 2026? 12.2% 0.10pp $946,704" [ref=e329]:
              - cell "MicroStrategy sells any Bitcoin by May 31, 2026?" [ref=e330]:
                - link "MicroStrategy sells any Bitcoin by May 31, 2026?" [ref=e331] [cursor=pointer]:
                  - /url: /markets/condition/0x3733a1b647e7364095736ab0966465d896a84cf3b6bc1695ca1f26c3239b3868
              - cell "12.2%" [ref=e332]
              - cell "0.10pp" [ref=e333]
              - cell "$946,704" [ref=e334]
            - row "MicroStrategy sells any Bitcoin by June 30, 2026? 71.4% 0.60pp $231,740" [ref=e335]:
              - cell "MicroStrategy sells any Bitcoin by June 30, 2026?" [ref=e336]:
                - link "MicroStrategy sells any Bitcoin by June 30, 2026?" [ref=e337] [cursor=pointer]:
                  - /url: /markets/condition/0x8e7a03cb1970e2ad6533b01892403516b6b3f5b5fa90ed7d104c28b27e40ba00
              - cell "71.4%" [ref=e338]
              - cell "0.60pp" [ref=e339]
              - cell "$231,740" [ref=e340]
            - row "MicroStrategy sells any Bitcoin by December 31, 2026? 88.0% 2.00pp $99,366" [ref=e341]:
              - cell "MicroStrategy sells any Bitcoin by December 31, 2026?" [ref=e342]:
                - link "MicroStrategy sells any Bitcoin by December 31, 2026?" [ref=e343] [cursor=pointer]:
                  - /url: /markets/condition/0x8213d395e079614d6c4d7f4cbb9be9337ab51648a21cc2a334ae8f1966d164b4
              - cell "88.0%" [ref=e344]
              - cell "2.00pp" [ref=e345]
              - cell "$99,366" [ref=e346]
            - row "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET 48.5% 1.00pp $17,355" [ref=e347]:
              - cell "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e348]:
                - link "Bitcoin Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e349] [cursor=pointer]:
                  - /url: /markets/condition/0x6f27c2c5f578e3e53c37081c010059937d11181a460d4e3212322412bbff3b3d
              - cell "48.5%" [ref=e350]
              - cell "1.00pp" [ref=e351]
              - cell "$17,355" [ref=e352]
            - row "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $12,109" [ref=e353]:
              - cell "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e354]:
                - link "Bitcoin Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e355] [cursor=pointer]:
                  - /url: /markets/condition/0xa326ea55d57013468e227f61b0b626a060ffadfae58f32a5e8149d702d94bdc2
              - cell "0.5%" [ref=e356]
              - cell "1.00pp" [ref=e357]
              - cell "$12,109" [ref=e358]
            - row "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET 97.5% 1.00pp $8,674" [ref=e359]:
              - cell "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET" [ref=e360]:
                - link "Bitcoin Up or Down - May 30, 11:45AM-12:00PM ET" [ref=e361] [cursor=pointer]:
                  - /url: /markets/condition/0x1d53ad46f74cad52e960b2410d79d0627470928cdccbe334c4da9f78c7a68c8e
              - cell "97.5%" [ref=e362]
              - cell "1.00pp" [ref=e363]
              - cell "$8,674" [ref=e364]
            - row "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET 97.5% 1.00pp $8,404" [ref=e365]:
              - cell "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e366]:
                - link "Bitcoin Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e367] [cursor=pointer]:
                  - /url: /markets/condition/0x7975c4dc693a7bda2f39890fc71c7edede5a1c1a28025b96634546967d3f55fa
              - cell "97.5%" [ref=e368]
              - cell "1.00pp" [ref=e369]
              - cell "$8,404" [ref=e370]
            - row "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET 2.5% 1.00pp $6,814" [ref=e371]:
              - cell "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e372]:
                - link "Bitcoin Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e373] [cursor=pointer]:
                  - /url: /markets/condition/0x7dbae8dbd8d3b35b212a2dc7b2c147ede6f643b2e93cf69b2020c1266e0dd201
              - cell "2.5%" [ref=e374]
              - cell "1.00pp" [ref=e375]
              - cell "$6,814" [ref=e376]
            - row "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET 3.5% 0.90pp $6,008" [ref=e377]:
              - cell "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e378]:
                - link "Ethereum Up or Down - May 30, 1:30PM-1:45PM ET" [ref=e379] [cursor=pointer]:
                  - /url: /markets/condition/0x7e4abead50b5f7cfeec70559f72d9bf70fd1d65561bb8476d0828e8435b78dd2
              - cell "3.5%" [ref=e380]
              - cell "0.90pp" [ref=e381]
              - cell "$6,008" [ref=e382]
            - row "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET 4.5% 1.00pp $5,045" [ref=e383]:
              - cell "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET" [ref=e384]:
                - link "Bitcoin Up or Down - May 30, 11:30AM-11:35AM ET" [ref=e385] [cursor=pointer]:
                  - /url: /markets/condition/0x9c1d2ab93995dd7c8376c5a3ac0e9b9341720e5c20b9c1bac1cda2079351452a
              - cell "4.5%" [ref=e386]
              - cell "1.00pp" [ref=e387]
              - cell "$5,045" [ref=e388]
            - row "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET 98.5% 1.00pp $4,392" [ref=e389]:
              - cell "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET" [ref=e390]:
                - link "Bitcoin Up or Down - May 30, 1:15PM-1:30PM ET" [ref=e391] [cursor=pointer]:
                  - /url: /markets/condition/0xd594c76eb8218209537d8bc6ab59853257a5d7637b38700685d18f69ef5388e3
              - cell "98.5%" [ref=e392]
              - cell "1.00pp" [ref=e393]
              - cell "$4,392" [ref=e394]
            - row "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET 8.5% 1.00pp $3,091" [ref=e395]:
              - cell "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET" [ref=e396]:
                - link "Bitcoin Up or Down - May 30, 12:45PM-1:00PM ET" [ref=e397] [cursor=pointer]:
                  - /url: /markets/condition/0x428b5788ac3f3ca0374ea27f23f88e36f54e1a7c88745e6a4e6cf7d349506948
              - cell "8.5%" [ref=e398]
              - cell "1.00pp" [ref=e399]
              - cell "$3,091" [ref=e400]
            - row "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET 54.5% 1.00pp $3,035" [ref=e401]:
              - cell "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET" [ref=e402]:
                - link "Bitcoin Up or Down - May 30, 11:40AM-11:45AM ET" [ref=e403] [cursor=pointer]:
                  - /url: /markets/condition/0xd3be4c7c1d1c440818e8e46be579b7d967836441834d5d24e8868c6dcb2d836c
              - cell "54.5%" [ref=e404]
              - cell "1.00pp" [ref=e405]
              - cell "$3,035" [ref=e406]
            - row "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET 96.5% 1.00pp $1,795" [ref=e407]:
              - cell "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e408]:
                - link "Ethereum Up or Down - May 30, 12:30PM-12:45PM ET" [ref=e409] [cursor=pointer]:
                  - /url: /markets/condition/0x84e6266240dff88bb3e54af44cacc3e370a01a422ffaf4d480f0c5e5e227cb88
              - cell "96.5%" [ref=e410]
              - cell "1.00pp" [ref=e411]
              - cell "$1,795" [ref=e412]
            - row "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET 89.5% 1.00pp $1,793" [ref=e413]:
              - cell "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET" [ref=e414]:
                - link "Bitcoin Up or Down - May 30, 1:10PM-1:15PM ET" [ref=e415] [cursor=pointer]:
                  - /url: /markets/condition/0x22874250c69f125f52d9645017fcc41cf1386a418886c15c234198aa20e8639d
              - cell "89.5%" [ref=e416]
              - cell "1.00pp" [ref=e417]
              - cell "$1,793" [ref=e418]
            - row "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $1,730" [ref=e419]:
              - cell "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e420]:
                - link "Ethereum Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e421] [cursor=pointer]:
                  - /url: /markets/condition/0x840f66a0b7174a93eb8520c3f1509a92a7a4901c1b55d728fda949849ec2cb72
              - cell "0.5%" [ref=e422]
              - cell "1.00pp" [ref=e423]
              - cell "$1,730" [ref=e424]
            - row "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET 1.5% 1.00pp $1,662" [ref=e425]:
              - cell "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e426]:
                - link "Ethereum Up or Down - May 30, 10:45AM-11:00AM ET" [ref=e427] [cursor=pointer]:
                  - /url: /markets/condition/0xc97b24724566b091d35c216f605881505f1c5c4c1cee223cc1f6142c894e1d0f
              - cell "1.5%" [ref=e428]
              - cell "1.00pp" [ref=e429]
              - cell "$1,662" [ref=e430]
            - row "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET 96.5% 1.00pp $1,614" [ref=e431]:
              - cell "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET" [ref=e432]:
                - link "Bitcoin Up or Down - May 30, 12:00PM-12:15PM ET" [ref=e433] [cursor=pointer]:
                  - /url: /markets/condition/0x531e7ddda3d8d165cfb769b3a8d9bccbb5d8aa4419f5c5b2f688411c96f695d5
              - cell "96.5%" [ref=e434]
              - cell "1.00pp" [ref=e435]
              - cell "$1,614" [ref=e436]
            - row "BNB Up or Down - May 30, 1:00PM-1:15PM ET 0.5% 1.00pp $1,550" [ref=e437]:
              - cell "BNB Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e438]:
                - link "BNB Up or Down - May 30, 1:00PM-1:15PM ET" [ref=e439] [cursor=pointer]:
                  - /url: /markets/condition/0xe67d4e09b0f410cf7e58e169b93bd742e8e8f9ed976523f534f3e6ab660ea3f5
              - cell "0.5%" [ref=e440]
              - cell "1.00pp" [ref=e441]
              - cell "$1,550" [ref=e442]
            - row "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET 0.5% 1.00pp $1,470" [ref=e443]:
              - cell "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET" [ref=e444]:
                - link "Bitcoin Up or Down - May 30, 11:30AM-11:45AM ET" [ref=e445] [cursor=pointer]:
                  - /url: /markets/condition/0xa4c1bf5d45ea5d527f43152c8e526bae16d9d46af97541a81236d918f2fe6b86
              - cell "0.5%" [ref=e446]
              - cell "1.00pp" [ref=e447]
              - cell "$1,470" [ref=e448]
      - navigation [ref=e449]:
        - link "→ Dashboard JSON" [ref=e450] [cursor=pointer]:
          - /url: /api/crypto/dashboard
        - link "→ Arena" [ref=e451] [cursor=pointer]:
          - /url: /arena
        - link "→ Safety" [ref=e452] [cursor=pointer]:
          - /url: /safety
  - generic [ref=e454]:
    - generic [ref=e455]: TRADES (12)
    - generic [ref=e457]:
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e458] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e459]: entry/SELL
        - generic [ref=e460]: poly:17172924
        - generic [ref=e461]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e462] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e463]: entry/SELL
        - generic [ref=e464]: poly:10164958
        - generic [ref=e465]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e466] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e467]: entry/SELL
        - generic [ref=e468]: poly:84871768
        - generic [ref=e469]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e470] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e471]: entry/BUY
        - generic [ref=e472]: poly:10963197
        - generic [ref=e473]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e474] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e475]: entry/SELL
        - generic [ref=e476]: poly:10164958
        - generic [ref=e477]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e478] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e479]: entry/BUY
        - generic [ref=e480]: poly:49014332
        - generic [ref=e481]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e482] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e483]: entry/BUY
        - generic [ref=e484]: poly:20447903
        - generic [ref=e485]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e486] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e487]: entry/SELL
        - generic [ref=e488]: poly:15962792
        - generic [ref=e489]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e490] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e491]: entry/BUY
        - generic [ref=e492]: poly:51183104
        - generic [ref=e493]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e494] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e495]: entry/BUY
        - generic [ref=e496]: poly:98733003
        - generic [ref=e497]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e498] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e499]: entry/BUY
        - generic [ref=e500]: poly:66651858
        - generic [ref=e501]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e502] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e503]: entry/BUY
        - generic [ref=e504]: poly:89717335
        - generic [ref=e505]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s22-fade-spike entry/SELL poly:17172924 $0.00 ◆" [ref=e506] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:11:47 AM g78-s22-fade-spike
        - generic [ref=e507]: entry/SELL
        - generic [ref=e508]: poly:17172924
        - generic [ref=e509]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-s16-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e510] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:11:47 AM g78-s16-fade-spike
        - generic [ref=e511]: entry/SELL
        - generic [ref=e512]: poly:10164958
        - generic [ref=e513]: $0.00
        - text: ◆
      - link "1:11:47 AM g78-c0-fade-spike entry/SELL poly:84871768 $0.00 ◆" [ref=e514] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:11:47 AM g78-c0-fade-spike
        - generic [ref=e515]: entry/SELL
        - generic [ref=e516]: poly:84871768
        - generic [ref=e517]: $0.00
        - text: ◆
      - link "1:11:47 AM g76-s17-fade-spike entry/BUY poly:10963197 $0.00 ◆" [ref=e518] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:11:47 AM g76-s17-fade-spike
        - generic [ref=e519]: entry/BUY
        - generic [ref=e520]: poly:10963197
        - generic [ref=e521]: $0.00
        - text: ◆
      - link "1:11:47 AM g72-s4-fade-spike entry/SELL poly:10164958 $0.00 ◆" [ref=e522] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:11:47 AM g72-s4-fade-spike
        - generic [ref=e523]: entry/SELL
        - generic [ref=e524]: poly:10164958
        - generic [ref=e525]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s22-fade-spike entry/BUY poly:49014332 $0.00 ◆" [ref=e526] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:06:47 AM g78-s22-fade-spike
        - generic [ref=e527]: entry/BUY
        - generic [ref=e528]: poly:49014332
        - generic [ref=e529]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-s16-fade-spike entry/BUY poly:20447903 $0.00 ◆" [ref=e530] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:06:47 AM g78-s16-fade-spike
        - generic [ref=e531]: entry/BUY
        - generic [ref=e532]: poly:20447903
        - generic [ref=e533]: $0.00
        - text: ◆
      - link "1:06:47 AM g78-c0-fade-spike entry/SELL poly:15962792 $0.00 ◆" [ref=e534] [cursor=pointer]:
        - /url: /arena/2426
        - text: 1:06:47 AM g78-c0-fade-spike
        - generic [ref=e535]: entry/SELL
        - generic [ref=e536]: poly:15962792
        - generic [ref=e537]: $0.00
        - text: ◆
      - link "1:06:47 AM g76-s17-fade-spike entry/BUY poly:51183104 $0.00 ◆" [ref=e538] [cursor=pointer]:
        - /url: /arena/2379
        - text: 1:06:47 AM g76-s17-fade-spike
        - generic [ref=e539]: entry/BUY
        - generic [ref=e540]: poly:51183104
        - generic [ref=e541]: $0.00
        - text: ◆
      - link "1:06:47 AM g72-s4-fade-spike entry/BUY poly:98733003 $0.00 ◆" [ref=e542] [cursor=pointer]:
        - /url: /arena/2278
        - text: 1:06:47 AM g72-s4-fade-spike
        - generic [ref=e543]: entry/BUY
        - generic [ref=e544]: poly:98733003
        - generic [ref=e545]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s22-fade-spike entry/BUY poly:66651858 $0.00 ◆" [ref=e546] [cursor=pointer]:
        - /url: /arena/2448
        - text: 1:01:48 AM g78-s22-fade-spike
        - generic [ref=e547]: entry/BUY
        - generic [ref=e548]: poly:66651858
        - generic [ref=e549]: $0.00
        - text: ◆
      - link "1:01:48 AM g78-s16-fade-spike entry/BUY poly:89717335 $0.00 ◆" [ref=e550] [cursor=pointer]:
        - /url: /arena/2442
        - text: 1:01:48 AM g78-s16-fade-spike
        - generic [ref=e551]: entry/BUY
        - generic [ref=e552]: poly:89717335
        - generic [ref=e553]: $0.00
        - text: ◆
  - button "Open Next.js Dev Tools" [ref=e559] [cursor=pointer]:
    - img [ref=e560]
  - alert [ref=e563]
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
> 16 |       await expect(card).toBeVisible();
     |                          ^ Error: expect(locator).toBeVisible() failed
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