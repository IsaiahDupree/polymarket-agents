# run-observe-scalp-supervised.ps1
#
# Poor-man's PM2 for the late-window-scalp observer. Loops:
#   npm run observe:late-window-scalp
# restarting on exit with capped exponential backoff. Mirrors the
# pattern used by run-realtime-supervised.ps1.
#
# Designed to be the action of a Windows Task Scheduler task registered
# with install-observe-scalp.ps1 (runs at user logon, single instance).
#
# Exit behavior:
#   - Observer exits 0  → restart after BackoffMin (default 1s)
#   - Observer exits >0 → restart after exponential backoff capped at BackoffMax
#   - This script never exits on its own (intentional — keep gathering data)
#   - SIGINT / Ctrl+C from operator stops both observer and this script
#
# Logs land in <repo>/data/scheduler/observe-scalp.<yyyy-MM-dd>.log
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\run-observe-scalp-supervised.ps1

param(
    [int]$BackoffMin = 1,
    [int]$BackoffMax = 30
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $RepoRoot

$LogDir = Join-Path $RepoRoot 'data\scheduler'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function LogFile {
    Join-Path $LogDir ("observe-scalp.{0:yyyy-MM-dd}.log" -f (Get-Date))
}
function Write-Log([string]$Line) {
    $stamp = (Get-Date).ToString('o')
    Add-Content -Path (LogFile) -Value "[$stamp] $Line"
}

$backoff = $BackoffMin
Write-Log "-- supervisor for observe-late-window-scalp starting --"

while ($true) {
    Write-Log "starting npm run observe:late-window-scalp"
    $start = Get-Date
    & npm.cmd run observe:late-window-scalp 2>&1 | ForEach-Object {
        Write-Log "  $_"
    }
    $exitCode = $LASTEXITCODE
    $duration = (New-TimeSpan -Start $start -End (Get-Date)).TotalSeconds
    Write-Log "observer exited (code=$exitCode, ran for $duration s)"

    if ($exitCode -eq 0) {
        $backoff = $BackoffMin
    } else {
        $backoff = [Math]::Min($backoff * 2, $BackoffMax)
    }
    Write-Log "restarting in $backoff seconds..."
    Start-Sleep -Seconds $backoff
}
