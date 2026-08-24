#Requires -Version 5.1
<#
.SYNOPSIS
    Run the forge-workflow-engine as a standalone process, from outside any
    interactive CLI session (second terminal, CI, nohup / Start-Process).

.DESCRIPTION
    This is the "execution" half of Agent Forge's author/execute split:
    authoring (PRD -> team -> manifest) happens in a chat session; execution
    happens here, with the engine driving every task through a harness adapter.

.PARAMETER Repo
    Repository root. Default: detected by walking up from cwd for .git.

.PARAMETER Harness
    Per-task harness: opencode (default), copilot, openai, stub, flowforge-kernel.
    Defaults to the FORGE_ENGINE_HARNESS environment variable, else "opencode".

.PARAMETER Yes
    Skip the engine's pre-run gate (same as FORGE_ENGINE_YES=1).

.PARAMETER DryRun
    Print the commands without executing them.

.EXAMPLE
    .\scripts\forge-engine-run.ps1 -Harness copilot -Yes
#>
[CmdletBinding()]
param (
    [string]$Repo = "",
    [ValidateSet("opencode", "copilot", "openai", "stub", "flowforge-kernel")]
    [string]$Harness = "",
    [switch]$Yes,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $Harness) {
    $Harness = if ($env:FORGE_ENGINE_HARNESS) { $env:FORGE_ENGINE_HARNESS } else { "opencode" }
}

# Resolve repo root: --Repo, or walk up from cwd looking for .git.
function Get-RepoRoot {
    param ([string]$Start)
    $current = $Start
    for ($i = 0; $i -lt 12; $i++) {
        if (Test-Path (Join-Path $current ".git")) { return $current }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
    return $current
}

if (-not $Repo) { $Repo = Get-RepoRoot -Start (Get-Location).Path }
$Repo = (Resolve-Path $Repo -ErrorAction SilentlyContinue).Path
if (-not $Repo -or -not (Test-Path (Join-Path $Repo ".git"))) {
    Write-Error "Not a git repository: $Repo"
    exit 1
}

# Locate the bootstrapped skill packages under the harness directory.
$engineDir = $null
$adapterDir = $null
foreach ($root in @(".agents", ".opencode", ".claude", ".github")) {
    if (-not $engineDir -and (Test-Path (Join-Path $Repo "$root\skills\forge-workflow-engine"))) {
        $engineDir = Join-Path $Repo "$root\skills\forge-workflow-engine"
    }
    if (-not $adapterDir -and (Test-Path (Join-Path $Repo "$root\skills\forge-execution-adapter"))) {
        $adapterDir = Join-Path $Repo "$root\skills\forge-execution-adapter"
    }
}

if (-not $engineDir) {
    Write-Error "forge-workflow-engine not found under $Repo (looked in .agents/.opencode/.claude/.github skills dirs)."
    exit 1
}

$manifest = Join-Path $Repo "docs\EXECUTION-MANIFEST.json"

Write-Host "forge-engine-run: repo=$Repo harness=$Harness"
Write-Host "  engine : $engineDir"
Write-Host "  adapter: $(if ($adapterDir) { $adapterDir } else { '<not bootstrapped; manifest must already exist>' })"

function Invoke-Run {
    param ([string]$Command)
    if ($DryRun) {
        Write-Host "  [dry-run] $Command"
        return
    }
    Invoke-Expression $Command
}

# 1. Prepare: install the execution adapter (if present) and compile the manifest.
if ($adapterDir -and -not (Test-Path $manifest)) {
    Invoke-Run "(cd '$adapterDir'; npm install; npm run forge-execution-adapter -- compile)"
}
elseif ($adapterDir) {
    Invoke-Run "(cd '$adapterDir'; npm install)"
}

if (Test-Path $manifest) {
    Write-Host "  manifest: $manifest (exists)"
}
elseif ($DryRun) {
    Write-Host "  manifest: $manifest (will be compiled by the adapter step above)"
}
else {
    Write-Error "$manifest not found. Compile it via forge-execution-adapter (or bootstrapped adapter + run again)."
    exit 1
}

# 2. Install engine dependencies (node module bootstrap happens here, not at bootstrap.ps1 time).
Invoke-Run "(cd '$engineDir'; npm install)"

# 3. Run the engine as a foreground, standalone process.
$yesFlag = ""
if ($Yes -or $env:FORGE_ENGINE_YES -eq "1") { $yesFlag = "--yes" }

if ($DryRun) {
    Write-Host "  [dry-run] (cd '$engineDir'; npm run workflow-engine -- run --harness $Harness $yesFlag)"
}
else {
    Push-Location $engineDir
    try {
        npm run workflow-engine -- run --harness $Harness $yesFlag
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    finally {
        Pop-Location
    }
}
