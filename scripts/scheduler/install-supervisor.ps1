# install-supervisor.ps1
#
# Registers a Windows Scheduled Task that runs the heartbeat supervisor
# every 5 minutes. The supervisor detects stale subsystems (arena tick,
# snapshot:evolution, worker:portfolio-snapshot, reconcile) and restarts
# whichever ones missed their last heartbeat window.
#
# Pair this with install-arena-tasks.ps1 (arena tick scheduler). Together
# they create a self-recovering loop: if the arena tick task is healthy
# it runs every 5 min; if it stops, the supervisor catches it within 15
# min (3× the cadence) and triggers a recovery run.
#
# Default cadence: 5 minutes. Default task name: "PolymarketSupervisor".
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install-supervisor.ps1
#   powershell -ExecutionPolicy Bypass -File .\install-supervisor.ps1 -IntervalMinutes 10

param(
    [int]$IntervalMinutes = 5,
    [string]$TaskName = 'PolymarketSupervisor'
)

$ErrorActionPreference = 'Stop'

$Launcher = Join-Path $PSScriptRoot 'run-supervisor.ps1'
if (-not (Test-Path $Launcher)) {
    throw "launcher missing: $Launcher"
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing task '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Launcher`""

$trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1))
$trigger.Repetition = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
    -RepetitionDuration (New-TimeSpan -Days 9999) | Select-Object -ExpandProperty Repetition

# Longer timeout than arena-tick because supervisor may invoke recoveries
# that themselves take several minutes (arena tick + portfolio snapshot
# stacked).
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 10) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Heartbeat supervisor — restarts stale PolymarketAutomation subsystems every $IntervalMinutes min." | Out-Null

Write-Host "Task '$TaskName' installed — runs every $IntervalMinutes minute(s)." -ForegroundColor Green
Write-Host '  Logs:   (repo)/data/scheduler/supervisor.(date).log'
Write-Host '  Stale thresholds (subsystem-specific, see src/lib/heartbeat.ts):'
Write-Host '    arena-tick           15 min'
Write-Host '    snapshot-evolution   30 min'
Write-Host '    portfolio-snapshot   28 hr (daily worker)'
Write-Host '    reconcile            45 min'
Write-Host ''
Write-Host 'To remove later:' -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:" + '$false'
