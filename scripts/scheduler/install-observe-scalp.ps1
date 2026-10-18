# install-observe-scalp.ps1
#
# Registers a Windows Scheduled Task that runs the supervised observe
# wrapper at user logon. The wrapper keeps the late-window-scalp observer
# alive (auto-restart on death) so data gathering NEVER stops.
#
# Default task name: 'PolymarketObserveScalp'
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install-observe-scalp.ps1
#   powershell -ExecutionPolicy Bypass -File .\install-observe-scalp.ps1 -TaskName "MyObserver"

param(
    [string]$TaskName = 'PolymarketObserveScalp'
)

$ErrorActionPreference = 'Stop'

$Launcher = Join-Path $PSScriptRoot 'run-observe-scalp-supervised.ps1'
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

# Trigger: at user logon. The supervised wrapper handles all restart logic
# internally so we don't need a repeating trigger.
$trigger = New-ScheduledTaskTrigger -AtLogon

# Run forever, never stop on battery or idle, single instance.
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Continuously gathers late-window-scalp opportunity + sim-execution data. Sim-only (LATE_SCALP_LIVE forced off)." | Out-Null

Write-Host "Task '$TaskName' installed — starts at user logon, auto-restarts on death." -ForegroundColor Green
Write-Host '  Logs: (repo)/data/scheduler/observe-scalp.(date).log'
Write-Host ''
Write-Host 'To start immediately without logging out:' -ForegroundColor Cyan
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host ''
Write-Host 'To remove later:' -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:" + '$false'
