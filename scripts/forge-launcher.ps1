#Requires -Version 5.1
<#
.SYNOPSIS
    Interactive launcher that guides a user through the full Agent Forge
    lifecycle in one session.

.DESCRIPTION
    Orchestrates the following steps:
      1. Pre-flight check      — verify required tools
      2. Select harness        — GitHub Copilot | opencode | Claude Code | generic
      3. Create repository     — gh repo create (GitHub) or git init (others)
      4. Bootstrap Agent Forge — run bootstrap.ps1 into the new repo
      5. Capture idea          — write IDEA.md
      6. Add PRD / research    — optional: copy PRD and seed docs into docs/
      7. Commit + push         — commit bootstrapped forge, IDEA.md, PRD, and seed docs
      8. Launch auto-build     — harness-specific instructions or CLI spawn
      9. Completion summary

.PARAMETER NonInteractive
    Skip all interactive prompts (for CI/testing only).
    Requires environment variables to be set — see docs/forge-launcher.md.

.EXAMPLE
    .\scripts\forge-launcher.ps1
    .\scripts\forge-launcher.ps1 -NonInteractive
#>
[CmdletBinding()]
param (
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$BootstrapPs1 = Join-Path $ScriptDir "bootstrap.ps1"

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
function Write-Header {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "  McFuzzy Agent Forge — Launcher" -ForegroundColor Cyan
    Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Step   { param([string]$msg); Write-Host ""; Write-Host "▶ $msg" -ForegroundColor White }
function Write-Ok     { param([string]$msg); Write-Host "  ✔  $msg" -ForegroundColor Green }
function Write-Warn   { param([string]$msg); Write-Host "  ⚠  $msg" -ForegroundColor Yellow }
function Write-Fail   { param([string]$msg); Write-Host "  ✖  $msg" -ForegroundColor Red }
function Write-Info   { param([string]$msg); Write-Host "  $msg" }

function Read-Prompt {
    param (
        [string]$Message,
        [string]$Default = ""
    )
    if ($NonInteractive) {
        # Caller is expected to have set the appropriate env var
        return $Default
    }
    $displayMsg = if ($Default) { "$Message [$Default]" } else { $Message }
    $value = Read-Host $displayMsg
    if (-not $value -and $Default) { return $Default }
    return $value
}

function Read-YesNo {
    param (
        [string]$Message,
        [string]$Default = "n"
    )
    if ($NonInteractive) {
        return ($env:FORGE_YN_DEFAULT ?? $Default)
    }
    $value = Read-Host "$Message [y/N]"
    if (-not $value) { return $Default }
    return $value
}

function Start-CliInTerminal {
    param (
        [string]$Executable,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory
    )

    if ($IsWindows) {
        Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Normal | Out-Null
        return $true
    }

    $terminalCandidates = @("gnome-terminal", "x-terminal-emulator", "konsole", "mate-terminal")
    foreach ($candidate in $terminalCandidates) {
        $term = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($term) {
            $quotedArgs = $Arguments | ForEach-Object { "'$(($_ -replace "'", "''"))'" }
            $launchCommand = "cd '$(($WorkingDirectory -replace "'", "''"))' && '$($Executable -replace "'", "''")'"
            if ($quotedArgs.Count -gt 0) { $launchCommand += " $($quotedArgs -join ' ')" }
            $launchCommand += "; exec bash"

            switch ($candidate) {
                "gnome-terminal" { Start-Process -FilePath $candidate -ArgumentList @("--working-directory=$WorkingDirectory", "--", "bash", "-lc", $launchCommand) | Out-Null }
                "x-terminal-emulator" { Start-Process -FilePath $candidate -ArgumentList @("-e", "bash", "-lc", $launchCommand) | Out-Null }
                "konsole" { Start-Process -FilePath $candidate -ArgumentList @("--workdir", $WorkingDirectory, "-e", "bash", "-lc", $launchCommand) | Out-Null }
                "mate-terminal" { Start-Process -FilePath $candidate -ArgumentList @("--working-directory=$WorkingDirectory", "--", "bash", "-lc", $launchCommand) | Out-Null }
            }
            return $true
        }
    }

    $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
    if ($pwsh) {
        $launchScript = "Set-Location '$($WorkingDirectory -replace "'", "''")'; & '$($Executable -replace "'", "''")'"
        if ($Arguments.Count -gt 0) { $launchScript += " " + (($Arguments | ForEach-Object { "'$(($_ -replace "'", "''"))'" }) -join ' ') }
        Start-Process -FilePath $pwsh.Source -ArgumentList @("-NoExit", "-Command", $launchScript) -WorkingDirectory $WorkingDirectory | Out-Null
        return $true
    }

    Write-Warn "No supported desktop terminal emulator found. Open a terminal manually and run:"
    Write-Host "    cd `"$WorkingDirectory`"; $Executable $($Arguments -join ' ')"
    return $false
}

# ---------------------------------------------------------------------------
# Step 1: Pre-flight check
# ---------------------------------------------------------------------------
function Invoke-PreflightCheck {
    Write-Step "Step 1 of 9: Pre-flight check"

    $script:GhAvailable        = $false
    $script:CopilotAvailable   = $false
    $script:OpencodeAvailable  = $false
    $script:ClaudeAvailable    = $false

    # git
    $gitPath = Get-Command git -ErrorAction SilentlyContinue
    if ($gitPath) {
        $gitVer = & git --version 2>$null
        Write-Ok "git $($gitVer -replace 'git version ','')"
    } else {
        Write-Fail "git not found — install Git before running this launcher."
        exit 1
    }

    # gh
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $ghVer = (& gh --version 2>$null | Select-Object -First 1) -replace 'gh version ',''
        Write-Ok "gh $ghVer"
        $script:GhAvailable = $true
    } else {
        Write-Warn "gh (GitHub CLI) not found — GitHub harness repo creation will be unavailable."
    }

    # copilot
    if (Get-Command copilot -ErrorAction SilentlyContinue) {
        Write-Ok "copilot (installed)"
        $script:CopilotAvailable = $true
    } else {
        Write-Warn "copilot not found — GitHub Copilot CLI auto-launch will be unavailable."
    }

    # opencode
    if (Get-Command opencode -ErrorAction SilentlyContinue) {
        Write-Ok "opencode (installed)"
        $script:OpencodeAvailable = $true
    } else {
        Write-Warn "opencode not found — opencode harness auto-launch will be unavailable."
    }

    # claude
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        Write-Ok "claude (installed)"
        $script:ClaudeAvailable = $true
    } else {
        Write-Warn "claude not found — Claude Code harness auto-launch will be unavailable."
    }

    # bootstrap.ps1
    if (Test-Path $BootstrapPs1 -PathType Leaf) {
        Write-Ok "bootstrap.ps1 found"
    } else {
        Write-Fail "bootstrap.ps1 not found: $BootstrapPs1"
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Step 2: Select harness
# ---------------------------------------------------------------------------
function Select-Harness {
    Write-Step "Step 2 of 9: Select agent harness"

    Write-Host ""
    Write-Host "  Which agent harness will this project use?" -ForegroundColor White
    Write-Host ""
    Write-Host "    1) GitHub Copilot   (harness: github,  dir: .github/)"
    Write-Host "    2) opencode         (harness: agents,  dir: .agents/)"
    Write-Host "    3) Claude Code      (harness: claude,  dir: .claude/)"
    Write-Host "    4) Generic .agents  (harness: agents,  dir: .agents/)  [default]"
    Write-Host ""

    $choice = Read-Prompt "Select [1-4]" "4"

    switch ($choice) {
        "1" { $script:Harness = "github"; $script:HarnessLabel = "GitHub Copilot" }
        "2" { $script:Harness = "agents"; $script:HarnessLabel = "opencode" }
        "3" { $script:Harness = "claude"; $script:HarnessLabel = "Claude Code" }
        "4" { $script:Harness = "agents"; $script:HarnessLabel = "Generic .agents" }
        default {
            Write-Warn "Unrecognised choice '$choice', defaulting to generic .agents"
            $script:Harness = "agents"; $script:HarnessLabel = "Generic .agents"
        }
    }

    Write-Ok "Harness: $($script:HarnessLabel) (--harness $($script:Harness))"
}

# ---------------------------------------------------------------------------
# Step 3: Create repository
# ---------------------------------------------------------------------------
function New-Repository {
    Write-Step "Step 3 of 9: Create repository"

    $repoName = Read-Prompt "Repository name (no spaces)" ""
    if (-not $repoName) {
        Write-Fail "Repository name cannot be empty."
        exit 1
    }

    $repoDescription = Read-Prompt "Short description (optional)" ""

    $repoVisibility = Read-Prompt "Visibility — public or private" "private"
    $repoVisibility = $repoVisibility.ToLower()
    if ($repoVisibility -ne "public" -and $repoVisibility -ne "private") {
        $repoVisibility = "private"
    }

    $parentDir = Read-Prompt "Parent directory for the new repo" (Get-Location).Path
    if (-not $parentDir) { $parentDir = (Get-Location).Path }
    $parentDir = [System.IO.Path]::GetFullPath($parentDir)

    $script:RepoDir = Join-Path $parentDir $repoName
    $script:RemoteCreated = $false

    if ($script:Harness -eq "github" -and $script:GhAvailable) {
        Write-Info "Creating GitHub repository '$repoName' ($repoVisibility) …"
        $ghArgs = @("repo", "create", $repoName, "--$repoVisibility", "--clone")
        if ($repoDescription) { $ghArgs += @("--description", $repoDescription) }
        & gh @ghArgs
        $script:RepoDir = Join-Path (Get-Location).Path $repoName
        Write-Ok "GitHub repo created and cloned to: $($script:RepoDir)"
        $script:RemoteCreated = $true
    } else {
        Write-Info "Initialising local Git repository at: $($script:RepoDir)"
        New-Item -ItemType Directory -Path $script:RepoDir -Force | Out-Null
        Push-Location $script:RepoDir
        & git init
        Pop-Location

        if ($repoDescription) {
            $readmePath = Join-Path $script:RepoDir "README.md"
            "# $repoName`n`n$repoDescription" | Set-Content $readmePath -NoNewline
        }
        Write-Ok "Local git repository initialised: $($script:RepoDir)"

        if ($script:Harness -eq "github" -and -not $script:GhAvailable) {
            Write-Warn "gh is not installed — skipped remote creation."
            Write-Warn "Run 'gh repo create' or 'git remote add origin <url>' manually."
        } else {
            $addRemote = Read-YesNo "Add a Git remote for this repository now?" "n"
            if ($addRemote -eq "y" -or $addRemote -eq "Y") {
                $remoteUrl = Read-Prompt "Remote URL (e.g. https://github.com/user/repo.git)" ""
                if ($remoteUrl) {
                    & git -C $script:RepoDir remote add origin $remoteUrl
                    Write-Ok "Remote 'origin' added: $remoteUrl"
                    $script:RemoteCreated = $true
                }
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Step 4: Bootstrap Agent Forge
# ---------------------------------------------------------------------------
function Invoke-BootstrapForge {
    Write-Step "Step 4 of 9: Bootstrap Agent Forge"

    Write-Info "Running bootstrap.ps1 → $($script:RepoDir) (-Harness $($script:Harness)) …"
    & $BootstrapPs1 -Target $script:RepoDir -Harness $script:Harness -Force
    Write-Ok "Agent Forge templates bootstrapped."
}

# ---------------------------------------------------------------------------
# Step 5: Capture idea
# ---------------------------------------------------------------------------
function Invoke-CaptureIdea {
    Write-Step "Step 5 of 9: Capture your project idea"

    $ideaFile = Join-Path $script:RepoDir "IDEA.md"

    Write-Host ""
    Write-Host "  Describe your project idea below." -ForegroundColor White
    Write-Host "  This will be saved to IDEA.md and used as the starting prompt"
    Write-Host "  for forge-auto-build."
    Write-Host ""

    $ideaText = ""

    if ($NonInteractive) {
        $ideaText = $env:FORGE_IDEA
        if (-not $ideaText) {
            Write-Fail "Non-interactive mode: `$env:FORGE_IDEA is not set."
            exit 1
        }
    } else {
        Write-Host "  Enter your idea (press Enter twice on a blank line when finished):"
        Write-Host "  ──────────────────────────────────────────────────────────────"
        $lines = @()
        $blankCount = 0
        while ($true) {
            $line = Read-Host ""
            if ($line -eq "") {
                $blankCount++
                if ($blankCount -ge 1) { break }
            } else {
                $blankCount = 0
            }
            $lines += $line
        }
        $ideaText = $lines -join "`n"
    }

    if (-not $ideaText.Trim()) {
        Write-Warn "No idea text entered. IDEA.md will be created as a placeholder."
        $ideaText = "*(Replace this with your project idea before running forge-auto-build.)*"
    }

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $content = @"
# Project Idea

$ideaText

---

> Generated by forge-launcher on $timestamp
> Use this file as input for: ``@workspace /forge-auto-build``
"@
    $content | Set-Content -Path $ideaFile -NoNewline
    Write-Ok "Idea saved to: $ideaFile"
}

# ---------------------------------------------------------------------------
# Step 6: Add PRD and research / seed documents (optional — recommended)
# ---------------------------------------------------------------------------
function Invoke-AddPrdAndResearch {
    Write-Step "Step 6 of 9: Add PRD and research / seed documents (optional — recommended)"

    $docsDir     = Join-Path $script:RepoDir "docs"
    $researchDir = Join-Path $docsDir "research"
    $script:PrdAdded      = $false
    $script:ResearchAdded = $false

    Write-Host ""
    Write-Host "  Why this step matters:" -ForegroundColor White
    Write-Host "  Starting with a well-defined PRD produces a far more accurate and"
    Write-Host "  complete build than starting from an idea alone.  Research / seed"
    Write-Host "  documents (design specs, market research, technical notes, etc.) give"
    Write-Host "  the pipeline additional context that improves every downstream stage."
    Write-Host ""

    # --- PRD ---------------------------------------------------------------
    if ($NonInteractive) {
        $prdFile = $env:FORGE_PRD_FILE
        if ($prdFile) {
            if (Test-Path $prdFile -PathType Leaf) {
                New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
                Copy-Item $prdFile (Join-Path $docsDir "PRD.md")
                Write-Ok "PRD copied from `$env:FORGE_PRD_FILE → docs/PRD.md"
                $script:PrdAdded = $true
            } else {
                Write-Warn "FORGE_PRD_FILE is set but file not found: $prdFile — skipping PRD."
            }
        }
    } else {
        Write-Host "  Do you have an existing PRD to add?" -ForegroundColor White
        Write-Host ""
        Write-Host "    1) Yes — provide a file path to copy in as docs/PRD.md"
        Write-Host "    2) Yes — paste the PRD content directly"
        Write-Host "    3) No  — skip (the pipeline will generate one from IDEA.md)"
        Write-Host ""
        $prdChoice = Read-Prompt "Select [1-3]" "3"

        switch ($prdChoice) {
            "1" {
                $prdSrc = Read-Prompt "Path to your PRD file" ""
                if ($prdSrc -and (Test-Path $prdSrc -PathType Leaf)) {
                    New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
                    Copy-Item $prdSrc (Join-Path $docsDir "PRD.md")
                    Write-Ok "PRD copied → docs/PRD.md"
                    $script:PrdAdded = $true
                } else {
                    Write-Warn "File not found: $prdSrc — skipping PRD."
                }
            }
            "2" {
                Write-Host ""
                Write-Host "  Paste your PRD content below."
                Write-Host "  Press Enter twice on a blank line when finished:"
                Write-Host "  ──────────────────────────────────────────────────────────────"
                $lines = @()
                while ($true) {
                    $line = Read-Host ""
                    if ($line -eq "") { break }
                    $lines += $line
                }
                $prdText = $lines -join "`n"
                if ($prdText.Trim()) {
                    New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
                    $prdText | Set-Content -Path (Join-Path $docsDir "PRD.md") -NoNewline
                    Write-Ok "PRD saved → docs/PRD.md"
                    $script:PrdAdded = $true
                } else {
                    Write-Warn "No content entered — skipping PRD."
                }
            }
            default {
                Write-Info "Skipping PRD — the pipeline will generate one from IDEA.md."
            }
        }
    }

    # --- Research / seed documents -----------------------------------------
    if ($NonInteractive) {
        $researchFiles = $env:FORGE_RESEARCH_FILES
        if ($researchFiles) {
            New-Item -ItemType Directory -Path $researchDir -Force | Out-Null
            $researchFiles -split ',' | ForEach-Object {
                $f = $_.Trim()
                if ($f -and (Test-Path $f -PathType Leaf)) {
                    Copy-Item $f $researchDir
                    Write-Ok "Research doc copied: $(Split-Path $f -Leaf) → docs/research/"
                    $script:ResearchAdded = $true
                } elseif ($f) {
                    Write-Warn "FORGE_RESEARCH_FILES: file not found: $f — skipping."
                }
            }
        }
    } else {
        Write-Host ""
        $addResearch = Read-YesNo "Do you have research or seed documents to add (design specs, market research, technical notes…)?" "n"
        if ($addResearch -eq "y" -or $addResearch -eq "Y") {
            New-Item -ItemType Directory -Path $researchDir -Force | Out-Null
            Write-Host ""
            Write-Host "  Enter file paths one per line."
            Write-Host "  Press Enter on a blank line when done:"
            Write-Host "  ──────────────────────────────────────────────────────────────"
            while ($true) {
                $resPath = Read-Host ""
                if (-not $resPath) { break }
                $resPath = $resPath.Trim()
                if (Test-Path $resPath -PathType Leaf) {
                    Copy-Item $resPath $researchDir
                    Write-Ok "Research doc copied: $(Split-Path $resPath -Leaf) → docs/research/"
                    $script:ResearchAdded = $true
                } else {
                    Write-Warn "File not found: $resPath — skipping."
                }
            }
        } else {
            Write-Info "Skipping research documents."
        }
    }
}

# ---------------------------------------------------------------------------
# Step 7: Commit bootstrapped forge + idea
# ---------------------------------------------------------------------------
function Invoke-CommitBootstrap {
    Write-Step "Step 7 of 9: Commit bootstrapped forge and idea"

    & git -C $script:RepoDir add "."
    & git -C $script:RepoDir commit -m "chore: bootstrap agent forge"
    Write-Ok "Committed: 'chore: bootstrap agent forge'"

    if ($script:RemoteCreated) {
        Write-Info "Pushing to remote …"
        try {
            & git -C $script:RepoDir push -u origin HEAD 2>$null
        } catch {
            $branch = & git -C $script:RepoDir rev-parse --abbrev-ref HEAD
            & git -C $script:RepoDir push -u origin $branch
        }
        Write-Ok "Pushed to remote."
    } else {
        Write-Warn "No remote configured — skipping push. Add a remote and run 'git push -u origin HEAD' manually."
    }
}

# ---------------------------------------------------------------------------
# Step 7: Launch auto-build
# ---------------------------------------------------------------------------
function Invoke-LaunchAutobuild {
    Write-Step "Step 8 of 9: Launch auto-build"

    Write-Host ""
    Write-Host "  The repository is bootstrapped and ready for forge-auto-build." -ForegroundColor White
    Write-Host ""

    switch ($script:Harness) {
        "github" {
            if ($script:CopilotAvailable) {
                $launch = Read-YesNo "Launch GitHub Copilot CLI in the new repository now?" "y"
                if ($launch -eq "y" -or $launch -eq "Y") {
                    Write-Info "Launching GitHub Copilot CLI in: $($script:RepoDir)"
                    if (Start-CliInTerminal -Executable "copilot" -WorkingDirectory $script:RepoDir) {
                        Write-Ok "GitHub Copilot CLI launched in a separate terminal. Use /forge-auto-build in the chat to start the pipeline."
                    } else {
                        Write-Warn "GitHub Copilot CLI did not open automatically. Run:"
                        Write-Host "    cd `"$($script:RepoDir)`"; copilot"
                    }
                } else {
                    Write-Info "To launch manually:"
                    Write-Host "    cd `"$($script:RepoDir)`"; copilot"
                    Write-Host "    Then: /forge-auto-build <your idea>"
                }
            } else {
                Write-Info "Open the repository in GitHub Copilot Chat and run:"
                Write-Host ""
                Write-Host "    @workspace /forge-auto-build <your idea>" -ForegroundColor White
                Write-Host ""
                Write-Info "The skill will present a pre-flight summary. Type GO to start the full pipeline."
            }
        }
        "claude" {
            if ($script:ClaudeAvailable) {
                $launch = Read-YesNo "Launch claude in the new repository now?" "y"
                if ($launch -eq "y" -or $launch -eq "Y") {
                    Write-Info "Launching claude in: $($script:RepoDir)"
                    if (Start-CliInTerminal -Executable "claude" -Arguments @(".") -WorkingDirectory $script:RepoDir) {
                        Write-Ok "claude launched in a separate terminal. Use /forge-auto-build in the Claude Code chat to start the pipeline."
                    } else {
                        Write-Warn "claude did not open automatically. Run:"
                        Write-Host "    cd `"$($script:RepoDir)`"; claude ."
                    }
                } else {
                    Write-Info "To launch manually:"
                    Write-Host "    cd `"$($script:RepoDir)`"; claude ."
                    Write-Host "    Then: /forge-auto-build <your idea>"
                }
            } else {
                Write-Warn "claude CLI is not installed. Install it from https://claude.ai/code then run:"
                Write-Host "    cd `"$($script:RepoDir)`"; claude ."
                Write-Host "    Then: /forge-auto-build <your idea>"
            }
        }
        default {
            if ($script:OpencodeAvailable -and $script:HarnessLabel -eq "opencode") {
                $launch = Read-YesNo "Launch opencode in the new repository now?" "y"
                if ($launch -eq "y" -or $launch -eq "Y") {
                    Write-Info "Launching opencode in: $($script:RepoDir)"
                    if (Start-CliInTerminal -Executable "opencode" -Arguments @(".") -WorkingDirectory $script:RepoDir) {
                        Write-Ok "opencode launched in a separate terminal. Use /forge-auto-build in the chat to start the pipeline."
                    } else {
                        Write-Warn "opencode did not open automatically. Run:"
                        Write-Host "    cd `"$($script:RepoDir)`"; opencode ."
                    }
                } else {
                    Write-Info "To launch manually:"
                    Write-Host "    cd `"$($script:RepoDir)`"; opencode ."
                    Write-Host "    Then: /forge-auto-build <your idea>"
                }
            } else {
                Write-Info "Open the repository in your agent harness and run:"
                Write-Host ""
                Write-Host "    @workspace /forge-auto-build <your idea>" -ForegroundColor White
                Write-Host ""
                Write-Info "Agent templates are in:"
                Write-Host "    $($script:RepoDir)\.agents\agents\"
            }
        }
    }
}

# ---------------------------------------------------------------------------
# Step 8: Completion summary
# ---------------------------------------------------------------------------
function Write-CompletionSummary {
    Write-Step "Step 9 of 9: Summary"

    Write-Host ""
    Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  forge-launcher: Complete" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Repository  : $($script:RepoDir)"
    Write-Host "  Harness     : $($script:HarnessLabel) (--harness $($script:Harness))"
    Write-Host "  Remote      : $( if ($script:RemoteCreated) { 'yes' } else { 'none configured' } )"
    Write-Host "  Idea file   : $(Join-Path $script:RepoDir 'IDEA.md')"
    Write-Host "  PRD         : $( if ($script:PrdAdded) { Join-Path $script:RepoDir 'docs\PRD.md' } else { 'none (will be generated from IDEA.md)' } )"
    Write-Host "  Research    : $( if ($script:ResearchAdded) { Join-Path $script:RepoDir 'docs\research\' } else { 'none' } )"
    Write-Host ""
    Write-Host "  Next steps:"
    Write-Host ""
    Write-Host "  1. Open the project in your agent harness."
    Write-Host "  2. Run the auto-build skill:"
    Write-Host ""
    Write-Host "       @workspace /forge-auto-build  (paste your idea or reference IDEA.md)" -ForegroundColor White
    Write-Host ""
    Write-Host "  3. Review the pre-flight summary that the skill presents."
    Write-Host "  4. Type GO to start the fully autonomous pipeline."
    Write-Host ""
    Write-Host "  References:"
    Write-Host "   • Prompt playbook : $(Join-Path $script:RepoDir 'docs\prompt-playbook.md')"
    Write-Host "   • forge-auto-build: $(Join-Path $script:RepoDir '.agents\skills\forge-auto-build\SKILL.md')"
    Write-Host "       (path may vary by harness)"
    Write-Host ""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Write-Header

$script:Harness        = "agents"
$script:HarnessLabel   = "Generic .agents"
$script:RepoDir        = ""
$script:RemoteCreated  = $false
$script:GhAvailable      = $false
$script:CopilotAvailable = $false
$script:OpencodeAvailable = $false
$script:ClaudeAvailable   = $false
$script:PrdAdded          = $false
$script:ResearchAdded     = $false

Invoke-PreflightCheck
Select-Harness
New-Repository
Invoke-BootstrapForge
Invoke-CaptureIdea
Invoke-AddPrdAndResearch
Invoke-CommitBootstrap
Invoke-LaunchAutobuild
Write-CompletionSummary
