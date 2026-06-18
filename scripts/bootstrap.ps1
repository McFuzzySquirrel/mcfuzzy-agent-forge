#Requires -Version 5.1
<#
.SYNOPSIS
    Deploy mcfuzzy-agent-forge templates into a target repository.

.DESCRIPTION
    Copies agent and skill template files from this repository into a target
    repository so agent harnesses can use them.

    What it copies:
      templates/agents/*.md            -> TARGET/<root>/agents/*.agent.md
      templates/skills/<skill>/*       -> TARGET/<root>/skills/<skill>/** (recursive)
      docs/prompt-playbook.md          -> TARGET/docs/prompt-playbook.md

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
$DocsDir     = Join-Path $ScriptDir "..\docs" | Resolve-Path

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
# Helpers
# ---------------------------------------------------------------------------

function Copy-File {
    param ([string]$Src, [string]$Dest)

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

    # For non-default harness, adapt path references
    if ($Harness -ne "agents") {
        $content = Get-Content -Path $Dest -Raw
        $content = $content -replace '\.agents/', "$RootDir/"
        Set-Content -Path $Dest -Value $content -NoNewline
    }

    Write-Host "  Copied:   $Dest"
}

function Copy-SkillDirectory {
    param ([string]$SrcDir, [string]$DestDir, [string]$SkillName)

    if ((Test-Path $DestDir) -and -not $Force) {
        $answer = Read-Host "  Overwrite existing skill directory '$SkillName'? [y/N]"
        if ($answer -notin @('y', 'Y')) {
            Write-Host "  Skipped:  $SkillName/"
            return
        }
    }

    if (Test-Path $DestDir) {
        Remove-Item -Path $DestDir -Recurse -Force
    }

    $parent = Split-Path -Parent $DestDir
    if (-not (Test-Path $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    Copy-Item -Path $SrcDir -Destination $DestDir -Recurse -Force

    # Apply harness path rewrite to all .md files
    if ($Harness -ne "agents") {
        Get-ChildItem -Path $DestDir -Filter "*.md" -Recurse | ForEach-Object {
            $content = Get-Content -Path $_.FullName -Raw
            $content = $content -replace '\.agents/', "$RootDir/"
            Set-Content -Path $_.FullName -Value $content -NoNewline
        }
    }

    Write-Host "  Copied:   $SkillName/"
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
$docsDest   = Join-Path $Target "docs"

# --- Agents ---
Write-Host "Agents ($agentsDest):"
$agentsSource = Join-Path $TemplatesDir "agents"
if (Test-Path $agentsSource) {
    Get-ChildItem -Path $agentsSource -Filter "*.md" -File | ForEach-Object {
        $dest = Join-Path $agentsDest "$($_.BaseName).agent.md"
        Copy-File -Src $_.FullName -Dest $dest
    }
}

# --- Skills (full directory) ---
Write-Host ""
Write-Host "Skills ($skillsDest):"
$skillsSource = Join-Path $TemplatesDir "skills"
if (Test-Path $skillsSource) {
    Get-ChildItem -Path $skillsSource -Directory | ForEach-Object {
        $skillName = $_.Name
        $destDir = Join-Path $skillsDest $skillName
        Copy-SkillDirectory -SrcDir $_.FullName -DestDir $destDir -SkillName $skillName
    }
}

# --- Prompt playbook ---
Write-Host ""
Write-Host "Docs ($docsDest):"
$playbookSrc = Join-Path $DocsDir "prompt-playbook.md"
if (Test-Path $playbookSrc -PathType Leaf) {
    Copy-File -Src $playbookSrc -Dest (Join-Path $docsDest "prompt-playbook.md")
}

# --- Apply harness path rewrite to copied agent files ---
if ($Harness -ne "agents") {
    Get-ChildItem -Path $agentsDest -Filter "*.agent.md" | ForEach-Object {
        $content = Get-Content -Path $_.FullName -Raw
        $content = $content -replace '\.agents/', "$RootDir/"
        Set-Content -Path $_.FullName -Value $content -NoNewline
    }
}

Write-Host ""
Write-Host "Bootstrap complete."
Write-Host "Commit $RootDir\agents\ (.agent.md), $RootDir\skills\, and docs\ to your repository."
