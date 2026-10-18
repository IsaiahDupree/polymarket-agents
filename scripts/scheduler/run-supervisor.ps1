# run-supervisor.ps1
#
# Wrapper for the heartbeat supervisor. Triggered by Windows Task Scheduler
# every 5 minutes. Reads recent heartbeats and restarts stale subsystems
# (arena tick, snapshot:evolution, worker:portfolio-snapshot, reconcile).
#
# Self-recovery loop — if Task Scheduler is healthy, this runs even when
# all other tasks have stopped. The only thing that can stop the system
# entirely is Task Scheduler itself being disabled (operator action).
#
# Logs land in <repo>/data/scheduler/supervisor.<yyyy-MM-dd>.log
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\run-supervisor.ps1

$ErrorActionPreference = 'Continue'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $RepoRoot

$LogDir = Join-Path $RepoRoot 'data\scheduler'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir ("supervisor.{0:yyyy-MM-dd}.log" -f (Get-Date))

function Write-Log([string]$Line) {
    $stamp = (Get-Date).ToString('o')
    Add-Content -Path $LogFile -Value "[$stamp] $Line"
}

try {
    Write-Log "-- supervisor start --"
    $out = & npm.cmd run supervisor 2>&1
    $exitCode = $LASTEXITCODE
    $out | ForEach-Object { Write-Log "  $_" }
    if ($exitCode -ne 0) {
        Write-Log "supervisor exited non-zero ($exitCode)"
        exit $exitCode
    }
    Write-Log "-- supervisor ok --"
    exit 0
} catch {
    Add-Content -Path $LogFile -Value "[$([DateTime]::Now.ToString('o'))] FATAL: $_"
    exit 3
}
