# install-all.ps1
#
# Master installer — registers ALL scheduled tasks needed for the system
# to run continuously and self-improve:
#
#   1. PolymarketArenaTick      → arena ticks + auto-evolve every 5 min
#   2. PolymarketSupervisor     → heartbeat watchdog every 5 min
#   3. PolymarketObserveScalp   → continuous late-window-scalp data gathering (at logon)
#   4. PolymarketReconcile      → capsule/venue state reconciliation every 15 min
#
# After running this, the system runs forever:
#   - Arena ticks fire every 5 min → evolution loop progresses
#   - Supervisor catches anything stale (within 15 min) → auto-recovers
#   - Scalp observer continuously collects data (auto-restarts on death)
#   - Reconciler keeps venue + capsule state in sync
#
# Plus the existing self-improvement mechanisms (already deployed in code):
#   - Dynamic kind blacklist: failing strategies drop out automatically
#   - Cluster-aware breeding: failing families get under-bred
#   - Correlation-aware promote: structurally-duplicate elites get vetoed
#   - Capital follows fitness: winners earn more
#   - Decision pipeline (shadow): records every would-have-decision
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install-all.ps1

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot

Write-Host '═══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host 'PolymarketAutomation — installing all scheduled tasks' -ForegroundColor Cyan
Write-Host '═══════════════════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''

# 1. Arena tick (every 5 min)
Write-Host '[1/4] Arena tick scheduler...' -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'install-arena-tasks.ps1')
Write-Host ''

# 2. Supervisor (every 5 min, restarts anything stale)
Write-Host '[2/4] Heartbeat supervisor...' -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'install-supervisor.ps1')
Write-Host ''

# 3. Late-window-scalp observer (continuous, at logon)
Write-Host '[3/4] Late-window-scalp observer...' -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'install-observe-scalp.ps1')
Write-Host ''

# 4. Reconciler (every 15 min)
Write-Host '[4/4] Reconciler...' -ForegroundColor Yellow
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Here 'install-reconcile-task.ps1')
Write-Host ''

Write-Host '═══════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host 'All tasks installed.' -ForegroundColor Green
Write-Host '═══════════════════════════════════════════════════════════════' -ForegroundColor Green
Write-Host ''
Write-Host 'System status:' -ForegroundColor Cyan
Get-ScheduledTask | Where-Object { $_.TaskName -like 'Polymarket*' } | Format-Table TaskName, State -AutoSize

Write-Host ''
Write-Host 'To verify it''s actually running, open /training in the browser' -ForegroundColor Cyan
Write-Host 'or query the heartbeat data:' -ForegroundColor Cyan
Write-Host '  npm run supervisor                    # see current subsystem status' -ForegroundColor White
Write-Host '  npm run compare:evolution             # see what mechanisms are doing' -ForegroundColor White
Write-Host '  npm run audit:wallet                  # check actual Polymarket state' -ForegroundColor White
Write-Host ''
Write-Host 'To start a task immediately (instead of waiting for logon/cron):' -ForegroundColor Cyan
Write-Host '  Start-ScheduledTask -TaskName PolymarketObserveScalp' -ForegroundColor White
Write-Host '  Start-ScheduledTask -TaskName PolymarketArenaTick' -ForegroundColor White
Write-Host ''
Write-Host 'To stop EVERYTHING (uninstall):' -ForegroundColor Yellow
Write-Host '  Get-ScheduledTask | Where-Object { $_.TaskName -like ''Polymarket*'' } | Unregister-ScheduledTask -Confirm:$false' -ForegroundColor White
