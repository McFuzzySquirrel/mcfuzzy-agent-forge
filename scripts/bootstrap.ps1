#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy mcfuzzy-agent-forge templates into a target repository.

.DESCRIPTION
    Copies agent and skill template files from this repository into a target
    repository so agent harnesses can use them.

    What it copies:
      templates/agents/*.md          -> TARGET/<root>/agents/
      templates/skills/*/SKILL.md    -> TARGET/<root>/skills/{name}/SKILL.md

    Adapts internal path references when a non-default harness is selected.

.PARAMETER Target
    Path to the target repository root. Prompted if not supplied.

.PARAMETER Harness
    Target harness: agents (default), github, claude.

.PARAMETER Force
    Overwrite existing files without prompting.

.EXAMPLE
    .\scripts\bootstrap.ps1 -Target C:\Projects\my-app
    .\scripts\bootstrap.ps1 -Target ..\my-app -Harness github -Force
#>
[CmdletBinding()]
param (
    [string]$Target = "",
    [ValidateSet("agents", "github", "claude")]
    [string]$Harness = "agents",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$TemplatesDir = Join-Path $ScriptDir "..\templates" | Resolve-Path

# Map harness to root directory
$RootDir = switch ($Harness) {
    "agents" { ".agents" }
    "github" { ".github" }
    "claude" { ".claude" }
}

# ---------------------------------------------------------------------------
# Resolve target directory
# ---------------------------------------------------------------------------
if (-not $Target) {
    $Target = Read-Host "Target repository path [.]"
    if (-not $Target) { $Target = "." }
}

$Target = Convert-Path $Target -ErrorAction SilentlyContinue
if (-not $Target -or -not (Test-Path $Target -PathType Container)) {
    Write-Error "Target directory does not exist: $Target"
    exit 1
}

# ---------------------------------------------------------------------------
# Helper: copy a single file, respecting -Force / interactive prompt
# ---------------------------------------------------------------------------
function Copy-TemplateFile {
    param (
        [string]$Src,
        [string]$Dest
    )

    if ((Test-Path $Dest -PathType Leaf) -and -not $Force) {
        $answer = Read-Host "  Overwrite existing $(Split-Path -Leaf $Dest)? [y/N]"
        if ($answer -notin @('y', 'Y')) {
            Write-Host "  Skipped:  $Dest"
            return
        }
    }

    $destDir = Split-Path -Parent $Dest
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    Copy-Item -Path $Src -Destination $Dest -Force

    # For non-default harnesses, adapt internal path references
    if ($Harness -ne "agents") {
        $content = Get-Content -Path $Dest -Raw
        $content = $content -replace '\.agents/', "$RootDir/"
        Set-Content -Path $Dest -Value $content -NoNewline
    }

    Write-Host "  Copied:   $Dest"
}

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Target:  $Target"
Write-Host "Harness: $Harness ($RootDir)"
Write-Host ""

$agentsDest = Join-Path $Target "$RootDir\agents"
$skillsDest = Join-Path $Target "$RootDir\skills"

Write-Host "Agents ($agentsDest):"
$agentsSource = Join-Path $TemplatesDir "agents"
if (Test-Path $agentsSource) {
    Get-ChildItem -Path $agentsSource -Filter "*.md" -File | ForEach-Object {
        $dest = Join-Path $agentsDest $_.Name
        Copy-TemplateFile -Src $_.FullName -Dest $dest
    }
}

Write-Host ""
Write-Host "Skills ($skillsDest):"
$skillsSource = Join-Path $TemplatesDir "skills"
if (Test-Path $skillsSource) {
    Get-ChildItem -Path $skillsSource -Directory | ForEach-Object {
        $skillName = $_.Name
        $src = Join-Path $_.FullName "SKILL.md"
        if (Test-Path $src -PathType Leaf) {
            $dest = Join-Path $skillsDest "$skillName\SKILL.md"
            Copy-TemplateFile -Src $src -Dest $dest
        }
    }
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Commit $RootDir\agents\ and $RootDir\skills\ to your repository to activate the agents and skills."
