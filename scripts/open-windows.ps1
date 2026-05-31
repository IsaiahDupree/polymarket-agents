# open-windows.ps1 — pop separate terminals showing the factory views.
#
# Two views by default:
#   - Dashboard (progress bar, distribution, top 5, cycle ETAs)
#   - Monitor   (status + last 5 log lines per factory, 2s refresh)
#
# Layout preference:
#   1. If Windows Terminal (`wt.exe`) is installed → ONE window with a
#      vertical split: dashboard on left, monitor on right.
#   2. Otherwise → TWO independent PowerShell windows via Start-Process.
#
# The terminals run `pwsh -NoExit` so they stay open if a command exits.
# Press Ctrl-C in each window to stop the loop; close the window to exit.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\open-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\open-windows.ps1 -ForceSeparate
#   powershell -ExecutionPolicy Bypass -File scripts\open-windows.ps1 -Views dashboard,monitor,logs
#
# Args:
#   -Views          Comma list of views to spawn. Valid:
#                     dashboard | monitor | logs | logs-btc | logs-multi
#                   Default: dashboard,monitor
#   -ForceSeparate  Skip the Windows Terminal split-pane attempt and use
#                   Start-Process for every view (one window each).

param(
    [string[]] $Views = @("dashboard", "monitor"),
    [switch]   $ForceSeparate
)

$ErrorActionPreference = "Stop"

# Resolve project root from the script location.
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $projectRoot "package.json"))) {
    Write-Error "open-windows: package.json not found at $projectRoot"
    exit 1
}

# Prefer pwsh (PowerShell 7+) when available — better ANSI handling. Fall back
# to powershell (5.1) so this works on a stock Windows install.
$shellExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }

# View → friendly title + the command to run inside the spawned shell.
$catalog = @{
    "dashboard"  = @{ title = "Factory Dashboard"; cmd = "npm run factory:dashboard" }
    "monitor"    = @{ title = "Factory Monitor";   cmd = "npm run factory:monitor"   }
    "logs"       = @{ title = "Factory Logs (both)"; cmd = "Get-Content -Path logs/factory-btc-5m.log, logs/factory-multi.log -Wait -Tail 30" }
    "logs-btc"   = @{ title = "Logs: btc-5m";      cmd = "Get-Content -Path logs/factory-btc-5m.log -Wait -Tail 30" }
    "logs-multi" = @{ title = "Logs: multi";       cmd = "Get-Content -Path logs/factory-multi.log -Wait -Tail 30" }
}

# Normalize the requested view list. Unknown names emit a warning and are
# dropped — same forgiving shape as the `factory` PS function.
#
# Note: PowerShell variable names are case-INSENSITIVE, so we cannot reuse
# the lowercase $selected — it would alias the input $Views and reassigning
# to @() would silently zero out the parameter. Use a distinct name.
$selected = @()
foreach ($v in $Views) {
    $key = $v.Trim().ToLower()
    if ($catalog.ContainsKey($key)) {
        if ($selected -notcontains $key) { $selected += $key }
    } else {
        Write-Warning "open-windows: unknown view '$v' — valid: $($catalog.Keys -join ', ')"
    }
}
if ($selected.Count -eq 0) {
    Write-Error "open-windows: no valid views requested. Pass -Views dashboard,monitor"
    exit 1
}

# Builds the per-view command the spawned shell will execute. Pushed into a
# try/finally so the working directory is restored if the user cd's around.
function Build-Command([string] $cmd) {
    # The single quotes wrap the project root so spaces in the path don't
    # split the argument. `Set-Location` is the PS-native form of `cd`.
    return "Set-Location '$projectRoot'; $cmd"
}

# Detect Windows Terminal — wt.exe lives under WindowsApps and is on PATH on
# any Win 11 install + most recent Win 10s. The split-pane flow lets us put
# all views in one window with vertical splits.
$haveWt = $false
if (-not $ForceSeparate) {
    $haveWt = $null -ne (Get-Command wt.exe -ErrorAction SilentlyContinue)
}

if ($haveWt) {
    # Build a single `wt` invocation that opens a new tab, splits it for
    # every additional view, and runs the command in each pane.
    #
    # Syntax: `wt new-tab --title T -d D pwsh -NoExit -Command "..." `; split-pane -V -d D pwsh ...`
    # The literal `;` between actions is escaped with backtick in PS so it
    # reaches wt as a separator rather than terminating our PS statement.
    $first, $rest = $selected[0], $selected[1..$selected.Count]
    $firstTitle = $catalog[$first].title
    $firstCmd   = Build-Command $catalog[$first].cmd
    $args = @(
        "new-tab", "--title", $firstTitle, "-d", $projectRoot,
        $shellExe, "-NoExit", "-Command", $firstCmd
    )
    foreach ($v in $rest) {
        $args += "`;"  # wt action separator
        $args += "split-pane"
        $args += "-V"
        $args += "--title"
        $args += $catalog[$v].title
        $args += "-d"
        $args += $projectRoot
        $args += $shellExe
        $args += "-NoExit"
        $args += "-Command"
        $args += (Build-Command $catalog[$v].cmd)
    }

    Write-Host "Opening Windows Terminal with $($selected.Count) pane(s):"
    foreach ($v in $selected) { Write-Host "  - $($catalog[$v].title)  ->  $($catalog[$v].cmd)" }
    Start-Process -FilePath "wt.exe" -ArgumentList $args
}
else {
    # Fallback: one Start-Process per view → one window per view.
    Write-Host "Opening $($selected.Count) separate PowerShell window(s):"
    foreach ($v in $selected) {
        Write-Host "  - $($catalog[$v].title)  ->  $($catalog[$v].cmd)"
        $launchCmd = Build-Command $catalog[$v].cmd
        # -NoExit so the window stays after the command finishes / Ctrl-C.
        # -Command rather than -File so we can pass an inline script block.
        Start-Process -FilePath $shellExe -ArgumentList "-NoExit", "-Command", $launchCmd
    }
}

Write-Host ""
Write-Host "Tip: Ctrl-C in each window stops the loop; close the window to exit."
