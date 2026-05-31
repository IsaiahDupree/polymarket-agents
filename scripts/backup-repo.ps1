# backup-repo.ps1 — mirror this repo to a destination drive using robocopy.
#
# This is a LOCAL filesystem backup (machine-to-machine on the same box),
# NOT a push to a remote. Unlike `git push`, it includes:
#   - .env.local (real credentials — restored intact)
#   - data/polymarket.db (the 196 MB snapshot corpus)
#   - logs/ (factory output)
#   - the .git/ directory (full history, branches, refs)
#
# What's excluded (regenerable via `npm install` / build):
#   - node_modules/      (large, restored by `npm install`)
#   - .next/             (Next.js build cache)
#   - dist/, build/, out/
#   - .vitest/, coverage/, test-results/
#   - .turbo/, .cache/
#   - apps/web/.next/   (workspace build cache)
#
# robocopy is preferred over Copy-Item or `cp -r` because:
#   - /MIR mirrors changed files only (incremental, fast)
#   - /MT multi-threads the copy (uses 8+ threads by default)
#   - /XJ skips junctions/symlinks (avoid loops)
#   - /R:2 /W:2 — short retries on transient locks (Windows AV / OneDrive)
#   - exit codes: 0–7 are success (8+ are real errors)
#
# Usage:
#   pwsh -NoProfile -File scripts\backup-repo.ps1
#   pwsh -NoProfile -File scripts\backup-repo.ps1 -Destination E:\Coding\PolymarketAutomation
#   pwsh -NoProfile -File scripts\backup-repo.ps1 -Versioned
#       → writes to E:\Coding\PolymarketAutomation-YYYY-MM-DD-HHMMSS
#       → keeps prior backups (rotate manually)
#   pwsh -NoProfile -File scripts\backup-repo.ps1 -DryRun
#       → robocopy /L: list what would be copied, don't touch anything

param(
    [string] $Destination = "E:\Coding\PolymarketAutomation",
    [switch] $Versioned,
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

# Resolve the source from the script's location so the user can invoke this
# from any directory and still back up the right repo.
$source = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $source "package.json"))) {
    Write-Error "backup-repo: source root invalid — package.json not found at $source"
    exit 1
}

if ($Versioned) {
    $stamp = (Get-Date -Format "yyyy-MM-dd-HHmmss")
    $Destination = "$Destination-$stamp"
}

# Refuse to back up onto the same drive as the source — the user almost
# certainly meant a different drive. Catches the common "typed C:\Coding by
# accident" mistake.
$srcRoot = (Get-Item $source).PSDrive.Name
$dstRoot = ($Destination.Substring(0, 2))
$dstDrive = if ($dstRoot -match "^[A-Za-z]:$") { $dstRoot.Substring(0, 1) } else { "" }
if ($dstDrive -eq $srcRoot -and -not $DryRun) {
    Write-Warning "Destination drive (${dstDrive}:) matches source (${srcRoot}:). Backup to a DIFFERENT drive."
    Write-Warning "Override by passing -Destination explicitly to a path on the same drive."
    # Don't exit — operator may have meant it on purpose for testing.
}

# Verify destination's parent exists (E:\Coding) — robocopy will create the
# leaf folder but not arbitrary parents.
$dstParent = Split-Path -Parent $Destination
if (-not (Test-Path $dstParent)) {
    Write-Host "Creating destination parent: $dstParent"
    if (-not $DryRun) {
        New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
    }
}

# Exclusions. Robocopy takes /XD (exclude dirs by full path or basename)
# and /XF (exclude files by name/pattern). Basenames match anywhere in the
# tree, which is exactly what we want for node_modules / .next / etc.
$excludeDirs = @(
    "node_modules",
    ".next",
    "dist",
    "build",
    "out",
    ".vitest",
    ".turbo",
    ".cache",
    "coverage",
    "test-results",
    ".nyc_output",
    ".pnp"
)
$excludeFiles = @(
    "*.tsbuildinfo",
    ".DS_Store",
    "Thumbs.db"
)

$robocopyArgs = @($source, $Destination)
$robocopyArgs += "/MIR"        # mirror (incl. deletes on destination)
$robocopyArgs += "/MT:8"       # 8 threads
$robocopyArgs += "/XJ"         # skip junctions + symlinks
$robocopyArgs += "/R:2"        # retry 2x on lock
$robocopyArgs += "/W:2"        # 2s wait between retries
$robocopyArgs += "/NP"         # no per-file progress percentage
$robocopyArgs += "/NDL"        # no directory listing
$robocopyArgs += "/NJH"        # no job header
$robocopyArgs += "/NJS"        # no job summary (we print our own)
$robocopyArgs += "/XD"
$robocopyArgs += $excludeDirs
$robocopyArgs += "/XF"
$robocopyArgs += $excludeFiles
if ($DryRun) { $robocopyArgs += "/L" }  # /L = list only

Write-Host "===================================================="
Write-Host "  Repo backup"
Write-Host "===================================================="
Write-Host "  Source:      $source"
Write-Host "  Destination: $Destination"
Write-Host "  Mode:        $(if ($DryRun) { 'DRY RUN (no changes)' } else { 'MIRROR' })"
Write-Host "  Excluded:    $($excludeDirs -join ', ')"
Write-Host ""

$start = Get-Date
& robocopy @robocopyArgs
$exit = $LASTEXITCODE
$duration = (Get-Date) - $start

# Robocopy exit-code semantics (bitfield):
#   0  Nothing copied, no failures.
#   1  Files copied.
#   2  Extra files/dirs in destination (will be deleted by /MIR).
#   3  Some files copied, extras present.
#   4  Mismatched files/dirs.
#   8+ Real failures.
if ($exit -ge 8) {
    Write-Host ""
    Write-Host "Backup FAILED — robocopy exit code $exit" -ForegroundColor Red
    exit $exit
}

# Compute size + file count of the destination so the operator sees what
# they got. Skipping this on dry runs (no destination to measure).
if (-not $DryRun -and (Test-Path $Destination)) {
    $files = Get-ChildItem -Path $Destination -Recurse -File -ErrorAction SilentlyContinue
    $totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
    $totalMB = [math]::Round($totalBytes / 1MB, 1)
    Write-Host ""
    Write-Host "  Backup complete in $($duration.TotalSeconds.ToString('F1'))s" -ForegroundColor Green
    Write-Host "  Files:       $($files.Count)"
    Write-Host "  Total size:  ${totalMB} MB"
    Write-Host "  Destination: $Destination"
    Write-Host ""
    Write-Host "  Restore:     copy back to C:\... or open from $Destination directly"
} else {
    Write-Host ""
    Write-Host "  Dry run complete in $($duration.TotalSeconds.ToString('F1'))s" -ForegroundColor Cyan
}
