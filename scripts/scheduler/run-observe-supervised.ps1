# run-observe-supervised.ps1
#
# Poor-man's PM2 for the late-window-scalp observer. Loops:
#   npm run observe:late-window-scalp
# restarting on exit with capped exponential backoff. Matches the
# pattern used for run-realtime-supervised.ps1 (the WS worker).
#
# Designed to be the action of a Windows Task Scheduler task registered
# via install-observer.ps1 — runs at user logon, single instance only.
#
# Safety: the observer script itself forces LATE_SCALP_LIVE=0 regardless
# of env, so this loop cannot fire real orders even if env is misconfigured.
#
# Exit behavior:
#   - Process exits 0  → restart after BackoffMin (default 1s)
#   - Process exits >0 → restart after exponential backoff capped at BackoffMax
#   - This script never exits on its own (intentional)
#   - SIGINT / Ctrl+C from the operator stops both observer and this script
#
# Logs land in <repo>/data/scheduler/observe-late-window-scalp.<yyyy-MM-dd>.log

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
    Join-Path $LogDir ("observe-late-window-scalp.{0:yyyy-MM-dd}.log" -f (Get-Date))
}
function Write-Log([string]$Line) {
    $stamp = (Get-Date).ToString('o')
    Add-Content -Path (LogFile) -Value "[$stamp] $Line"
}

Write-Log "-- supervised observer wrapper start --"
$backoff = $BackoffMin
while ($true) {
    try {
        Write-Log "starting npm run observe:late-window-scalp"
        $start = Get-Date
        & npm.cmd run observe:late-window-scalp 2>&1 | ForEach-Object { Write-Log $_ }
        $exitCode = $LASTEXITCODE
        $duration = (Get-Date) - $start
        Write-Log ("observer exited code=$exitCode after {0:N1}s" -f $duration.TotalSeconds)

        if ($exitCode -eq 0) {
            $backoff = $BackoffMin
        } else {
            $backoff = [Math]::Min($backoff * 2, $BackoffMax)
        }
    } catch {
        Write-Log "FATAL: $_"
        $backoff = [Math]::Min($backoff * 2, $BackoffMax)
    }
    Write-Log "waiting $backoff seconds before restart"
    Start-Sleep -Seconds $backoff
}
