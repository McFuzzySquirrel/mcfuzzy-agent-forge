#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy mcfuzzy-agent-forge templates into a target repository.

.DESCRIPTION
    Copies agent and skill template files from this repository into a target
    repository's .github/ directory so GitHub Copilot can use them.

    What it copies:
      templates/agents/*.md          -> TARGET/.github/agents/
      templates/skills/*/SKILL.md    -> TARGET/.github/skills/{name}/SKILL.md

.PARAMETER Target
    Path to the target repository root. Prompted if not supplied.

.PARAMETER Force
    Overwrite existing files without prompting.

.EXAMPLE
    .\scripts\bootstrap.ps1 -Target C:\Projects\my-app
    .\scripts\bootstrap.ps1 -Target ../my-app -Force
#>
[CmdletBinding()]
param (
    [string]$Target = "",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$TemplatesDir = Join-Path $ScriptDir "..\templates" | Resolve-Path

# ---------------------------------------------------------------------------
# Resolve target directory
# ---------------------------------------------------------------------------
if (-not $Target) {
    $Target = Read-Host "Target repository path [.]"
    if (-not $Target) { $Target = "." }
}

$Target = Resolve-Path $Target -ErrorAction SilentlyContinue
if (-not $Target -or -not (Test-Path $Target -PathType Container)) {
    Write-Error "Target directory does not exist: $Target"
    exit 1
}

$Target = $Target.Path

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
    Write-Host "  Copied:   $Dest"
}

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Target: $Target"
Write-Host ""

Write-Host "Agents:"
$agentsSource = Join-Path $TemplatesDir "agents"
if (Test-Path $agentsSource) {
    Get-ChildItem -Path $agentsSource -Filter "*.md" -File | ForEach-Object {
        $dest = Join-Path $Target ".github\agents\$($_.Name)"
        Copy-TemplateFile -Src $_.FullName -Dest $dest
    }
}

Write-Host ""
Write-Host "Skills:"
$skillsSource = Join-Path $TemplatesDir "skills"
if (Test-Path $skillsSource) {
    Get-ChildItem -Path $skillsSource -Directory | ForEach-Object {
        $skillName = $_.Name
        $src = Join-Path $_.FullName "SKILL.md"
        if (Test-Path $src -PathType Leaf) {
            $dest = Join-Path $Target ".github\skills\$skillName\SKILL.md"
            Copy-TemplateFile -Src $src -Dest $dest
        }
    }
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Commit .github/agents/ and .github/skills/ to your repository to activate the agents."
