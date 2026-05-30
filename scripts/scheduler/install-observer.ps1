# install-observer.ps1
#
# Registers a Windows Scheduled Task that runs the supervised late-window-
# scalp observer at user logon. The supervised wrapper (run-observe-
# supervised.ps1) loops + restarts the observer on any exit. Single
# instance only — re-running this installer cleans up any prior task
# with the same name.
#
# Default task name: "PolymarketLateScalpObserver".
#
# Pair with install-supervisor.ps1 for the full always-on stack.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install-observer.ps1
#   powershell -ExecutionPolicy Bypass -File .\install-observer.ps1 -TaskName "MyObserver"

param(
    [string]$TaskName = 'PolymarketLateScalpObserver'
)

$ErrorActionPreference = 'Stop'

$Launcher = Join-Path $PSScriptRoot 'run-observe-supervised.ps1'
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

# At-logon trigger; the supervised wrapper keeps restarting forever.
$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Days 9999) `
    -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Always-on late-window-scalp observer — runs the supervised observer wrapper at user logon. SIM-only by construction." | Out-Null

Write-Host "Task '$TaskName' installed — starts at logon, supervises forever." -ForegroundColor Green
Write-Host '  Logs:   (repo)/data/scheduler/observe-late-window-scalp.(date).log'
Write-Host '  Mode:   SIM-only (the observer script forces LATE_SCALP_LIVE=0)'
Write-Host ''
Write-Host 'Start it now (without waiting for logon):' -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host 'To remove later:' -ForegroundColor Yellow
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:" + '$false'
