#Requires -Version 5.1
<#
.SYNOPSIS
    Interactive launcher that guides a user through the full Agent Forge
    lifecycle in one session.

.DESCRIPTION
    Orchestrates the following steps:
      1. Pre-flight check      -verify required tools
      2. Select harness        -GitHub Copilot | opencode | Claude Code | generic
      3. Create repository     -gh repo create (GitHub) or git init (others)
      4. Bootstrap Agent Forge -run bootstrap.ps1 into the new repo
      5. Capture idea          -write IDEA.md
      6. Add PRD / research    -optional: copy PRD and seed docs into docs/
      7. Commit + push         -commit bootstrapped forge, IDEA.md, PRD, and seed docs
      8. Launch auto-build     -harness-specific instructions or CLI spawn
      9. Completion summary

.PARAMETER NonInteractive
    Skip all interactive prompts (for CI/testing only).
    Requires environment variables to be set -see docs/forge-launcher.md.

.PARAMETER Headless
    Instead of opening an interactive CLI, drive the queued skill directly from
    the terminal via `opencode run --auto` or `copilot -p --yolo`. Configure
    with FORGE_RUN_WITH and FORGE_WORKFLOW_ENGINE (see docs/forge-launcher.md).

.PARAMETER DryRun
    Print the headless command without executing it.

.EXAMPLE
    .\scripts\forge-launcher.ps1
    .\scripts\forge-launcher.ps1 -NonInteractive
    .\scripts\forge-launcher.ps1 -Headless -DryRun
#>
[CmdletBinding()]
param (
    [switch]$NonInteractive,
    [switch]$Headless,
    [switch]$DryRun
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
    Write-Host "  McFuzzy Agent Forge -Launcher" -ForegroundColor Cyan
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
        # Build a PowerShell command that cd's to the repo then runs the CLI
        $escapedDir = $WorkingDirectory -replace "'", "''"
        $escapedExe = $Executable -replace "'", "''"
        $launchScript = "Set-Location '$escapedDir'; & '$escapedExe'"
        if ($Arguments.Count -gt 0) {
            $launchScript += " " + (($Arguments | ForEach-Object { "'$(($_ -replace "'", "''"))'" }) -join ' ')
        }

        # Prefer Windows Terminal, then pwsh (PS 7), then powershell (PS 5)
        $wt   = Get-Command wt   -ErrorAction SilentlyContinue
        $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
        $ps5  = Get-Command powershell -ErrorAction SilentlyContinue

        if ($wt) {
            # wt spawns a new tab/window and runs the inner shell command
            $psExe = if ($pwsh) { $pwsh.Source } else { $ps5.Source }
            Start-Process -FilePath $wt.Source -ArgumentList @("new-tab", "--", $psExe, "-NoExit", "-Command", $launchScript) | Out-Null
        } elseif ($pwsh) {
            Start-Process -FilePath $pwsh.Source -ArgumentList @("-NoExit", "-Command", $launchScript) | Out-Null
        } elseif ($ps5) {
            Start-Process -FilePath $ps5.Source -ArgumentList @("-NoExit", "-Command", $launchScript) | Out-Null
        } else {
            return $false
        }
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

function Get-AutobuildCommand {
    # forge-auto-build requires an existing PRD. If one was captured (or a
    # decomposed PRD layout already exists), queue the build. Otherwise queue
    # forge-auto-build-prd to create the PRD first.
    if ($script:PrdAdded -or (Test-Path (Join-Path $script:RepoDir "docs\PRD.md") -PathType Leaf) -or (Test-Path (Join-Path $script:RepoDir "docs\product-vision.md") -PathType Leaf)) {
        return "/forge-auto-build Use docs/PRD.md as the project PRD"
    } else {
        return "/forge-auto-build-prd Use docs/IDEA.md as the project idea"
    }
}

function Get-HeadlessSkillMessage {
    # Returns the skill invocation message used by the headless terminal command.
    $hasPrd = $script:PrdAdded -or (Test-Path (Join-Path $script:RepoDir "docs\PRD.md") -PathType Leaf) -or (Test-Path (Join-Path $script:RepoDir "docs\product-vision.md") -PathType Leaf)
    if ($hasPrd) {
        if ($env:FORGE_WORKFLOW_ENGINE -eq "1") {
            return "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine"
        }
        return "/forge-auto-build Use docs/PRD.md as the project PRD. GO"
    }
    return "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD."
}

function Get-HeadlessCommand {
    # Returns the non-interactive terminal command that drives the queued skill
    # via `opencode run --auto` or `copilot -p --yolo`.
    $runner = if ($env:FORGE_RUN_WITH) { $env:FORGE_RUN_WITH } else { if ($script:Harness -eq "github") { "copilot" } else { "opencode" } }
    $msg = Get-HeadlessSkillMessage
    if ($runner -eq "copilot") {
        return "copilot -p `"$msg`" --yolo"
    }
    return "opencode run --auto `"$msg`""
}

function Invoke-HeadlessBuild {
    # Executes the headless command in the repository (or prints it with -DryRun).
    $cmd = Get-HeadlessCommand
    Write-Host "    $cmd" -ForegroundColor White
    if ($DryRun) {
        Write-Warn "Dry-run: command printed, not executed."
        return
    }
    Push-Location $script:RepoDir
    try {
        Invoke-Expression $cmd
    } finally {
        Pop-Location
    }
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
        Write-Fail "git not found -install Git before running this launcher."
        exit 1
    }

    # gh
    if (Get-Command gh -ErrorAction SilentlyContinue) {
        $ghVer = (& gh --version 2>$null | Select-Object -First 1) -replace 'gh version ',''
        Write-Ok "gh $ghVer"
        $script:GhAvailable = $true
    } else {
        Write-Warn "gh (GitHub CLI) not found -GitHub harness repo creation will be unavailable."
    }

    # copilot
    if (Get-Command copilot -ErrorAction SilentlyContinue) {
        Write-Ok "copilot (installed)"
        $script:CopilotAvailable = $true
    } else {
        Write-Warn "copilot not found -GitHub Copilot CLI auto-launch will be unavailable."
    }

    # opencode
    if (Get-Command opencode -ErrorAction SilentlyContinue) {
        Write-Ok "opencode (installed)"
        $script:OpencodeAvailable = $true
    } else {
        Write-Warn "opencode not found -opencode harness auto-launch will be unavailable."
    }

    # claude
    if (Get-Command claude -ErrorAction SilentlyContinue) {
        Write-Ok "claude (installed)"
        $script:ClaudeAvailable = $true
    } else {
        Write-Warn "claude not found -Claude Code harness auto-launch will be unavailable."
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
    Write-Host "    1) GitHub Copilot   (harness: github,    dir: .github/)"
    Write-Host "    2) opencode         (harness: opencode,  dir: .opencode/)"
    Write-Host "    3) Claude Code      (harness: claude,    dir: .claude/)"
    Write-Host "    4) Generic .agents  (harness: agents,    dir: .agents/)  [default]"
    Write-Host ""

    $choice = if ($NonInteractive) {
        if ($env:FORGE_HARNESS_CHOICE) { $env:FORGE_HARNESS_CHOICE } else { "4" }
    } else {
        Read-Prompt "Select [1-4]" "4"
    }

    switch ($choice) {
        "1" { $script:Harness = "github";   $script:HarnessLabel = "GitHub Copilot" }
        "2" { $script:Harness = "opencode"; $script:HarnessLabel = "opencode" }
        "3" { $script:Harness = "claude";   $script:HarnessLabel = "Claude Code" }
        "4" { $script:Harness = "agents";   $script:HarnessLabel = "Generic .agents" }
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

    $repoName        = if ($NonInteractive) { $env:FORGE_REPO_NAME        ?? "" } else { Read-Prompt "Repository name (no spaces)" "" }
    $repoDescription = if ($NonInteractive) { $env:FORGE_REPO_DESCRIPTION ?? "" } else { Read-Prompt "Short description (optional)" "" }
    $repoVisibility  = if ($NonInteractive) { $env:FORGE_REPO_VISIBILITY  ?? "private" } else { Read-Prompt "Visibility -public or private" "private" }
    $parentDirRaw    = if ($NonInteractive) { $env:FORGE_REPO_PARENT_DIR  ?? (Get-Location).Path } else { Read-Prompt "Parent directory for the new repo" (Get-Location).Path }

    if (-not $repoName) {
        Write-Fail "Non-interactive mode: `$env:FORGE_REPO_NAME is not set."
        exit 1
    }

    $repoVisibility = $repoVisibility.ToLower()
    if ($repoVisibility -ne "public" -and $repoVisibility -ne "private") { $repoVisibility = "private" }

    if (-not $parentDirRaw) { $parentDirRaw = (Get-Location).Path }
    $parentDir = [System.IO.Path]::GetFullPath($parentDirRaw)

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
            "# $repoName`n`n$repoDescription" | Set-Content $readmePath -Encoding UTF8
        }
        Write-Ok "Local git repository initialised: $($script:RepoDir)"

        if ($script:Harness -eq "github" -and -not $script:GhAvailable) {
            Write-Warn "gh is not installed -skipped remote creation."
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

    $ideaFileRoot = Join-Path $script:RepoDir "IDEA.md"
    $ideaFileDocs = Join-Path (Join-Path $script:RepoDir "docs") "IDEA.md"

    Write-Host ""
    Write-Host "  Describe your project idea below." -ForegroundColor White
    Write-Host "  This will be saved to docs/IDEA.md (and mirrored to IDEA.md)"
    Write-Host "  and used as the starting prompt"
    Write-Host "  for forge-auto-build-prd (which turns it into docs/PRD.md)."
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
            $line = Read-Host
            if ($line -eq "") {
                $blankCount++
                if ($blankCount -ge 2) { break }
            } else {
                $blankCount = 0
            }
            $lines += $line
        }
        while ($lines.Count -gt 0 -and $lines[-1] -eq "") { $lines = $lines[0..($lines.Count - 2)] }
        $ideaText = $lines -join "`n"
    }

    if (-not $ideaText.Trim()) {
        Write-Warn "No idea text entered. docs/IDEA.md will be created as a placeholder."
        $ideaText = "*(Replace this with your project idea before running forge-auto-build-prd.)*"
    }

    New-Item -ItemType Directory -Path (Split-Path $ideaFileDocs -Parent) -Force | Out-Null

    $timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $content = @"
# Project Idea

$ideaText

---

> Generated by forge-launcher on $timestamp
> Use this file as input for: ``@workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea``
"@
    $content | Set-Content -Path $ideaFileDocs -Encoding UTF8
    Copy-Item -Path $ideaFileDocs -Destination $ideaFileRoot -Force
    Write-Ok "Idea saved to: $ideaFileDocs"
    Write-Info "Compatibility copy written to: $ideaFileRoot"
}

# ---------------------------------------------------------------------------
# Step 6: Add PRD and research / seed documents (optional -recommended)
# ---------------------------------------------------------------------------
function Invoke-AddPrdAndResearch {
    Write-Step "Step 6 of 9: Add PRD and research / seed documents (optional -recommended)"

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
                Write-Warn "FORGE_PRD_FILE is set but file not found: $prdFile -skipping PRD."
            }
        }
    } else {
        Write-Host "  Do you have an existing PRD to add?" -ForegroundColor White
        Write-Host ""
        Write-Host "    1) Yes -provide a file path to copy in as docs/PRD.md"
        Write-Host "    2) Yes -paste the PRD content directly"
        Write-Host "    3) No  -skip (the pipeline will build a PRD from docs/IDEA.md first)"
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
                    Write-Warn "File not found: $prdSrc -skipping PRD."
                }
            }
            "2" {
                Write-Host ""
                Write-Host "  Paste your PRD content below."
                Write-Host "  Press Enter twice on a blank line when finished:"
                Write-Host "  ──────────────────────────────────────────────────────────────"
                $lines = @()
                $blankCount = 0
                while ($true) {
                    $line = Read-Host
                    if ($line -eq "") {
                        $blankCount++
                        if ($blankCount -ge 2) { break }
                    } else {
                        $blankCount = 0
                    }
                    $lines += $line
                }
                while ($lines.Count -gt 0 -and $lines[-1] -eq "") { $lines = $lines[0..($lines.Count - 2)] }
                $prdText = $lines -join "`n"
                if ($prdText.Trim()) {
                    New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
                    $prdText | Set-Content -Path (Join-Path $docsDir "PRD.md") -Encoding UTF8
                    Write-Ok "PRD saved → docs/PRD.md"
                    $script:PrdAdded = $true
                } else {
                    Write-Warn "No content entered -skipping PRD."
                }
            }
            default {
                Write-Info "Skipping PRD -the pipeline will build a PRD from docs/IDEA.md first (via forge-auto-build-prd)."
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
                    Write-Warn "FORGE_RESEARCH_FILES: file not found: $f -skipping."
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
                $resPath = Read-Host
                if (-not $resPath) { break }
                $resPath = $resPath.Trim()
                if (Test-Path $resPath -PathType Leaf) {
                    Copy-Item $resPath $researchDir
                    Write-Ok "Research doc copied: $(Split-Path $resPath -Leaf) → docs/research/"
                    $script:ResearchAdded = $true
                } else {
                    Write-Warn "File not found: $resPath -skipping."
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
        Write-Warn "No remote configured -skipping push. Add a remote and run 'git push -u origin HEAD' manually."
    }
}

# ---------------------------------------------------------------------------
# Step 7: Launch auto-build
# ---------------------------------------------------------------------------
function Invoke-LaunchAutobuild {
    Write-Step "Step 8 of 9: Launch auto-build"

    Write-Host ""
    if ($script:PrdAdded -or (Test-Path (Join-Path $script:RepoDir "docs\PRD.md") -PathType Leaf) -or (Test-Path (Join-Path $script:RepoDir "docs\product-vision.md") -PathType Leaf)) {
        Write-Host "  The repository is bootstrapped and ready for forge-auto-build." -ForegroundColor White
        Write-Host "  forge-auto-build will generate the agent team, then execute the build"
        Write-Host "  (add 'GO --workflow-engine' at its pre-flight gate to run via the"
        Write-Host "  workflow engine instead of the prompt-driven orchestrator)."
    } else {
        Write-Host "  The repository is bootstrapped. forge-auto-build-prd will turn your idea" -ForegroundColor White
        Write-Host "  into a reviewed PRD, then forge-auto-build will generate the agent team"
        Write-Host "  and execute the build."
    }
    Write-Host ""

    if ($Headless) {
        Write-Info "Headless mode: driving the queued skill directly from the terminal"
        Write-Host "  (no interactive CLI session will be opened)."
        Write-Host ""
        Invoke-HeadlessBuild
        return
    }

    switch ($script:Harness) {
        "github" {
            if ($script:CopilotAvailable) {
                $launch = Read-YesNo "Launch GitHub Copilot CLI in the new repository now?" "y"
                if ($launch -eq "y" -or $launch -eq "Y") {
                    Write-Info "Launching GitHub Copilot CLI in: $($script:RepoDir)"
                    if (Start-CliInTerminal -Executable "copilot" -WorkingDirectory $script:RepoDir) {
                        Write-Ok "GitHub Copilot CLI launched in a separate terminal."
                        Write-Host "    Then run: $(Get-AutobuildCommand)"
                    } else {
                        Write-Warn "GitHub Copilot CLI did not open automatically. Run:"
                        Write-Host "    cd `"$($script:RepoDir)`"; copilot"
                        Write-Host "    Then: $(Get-AutobuildCommand)"
                    }
                } else {
                    Write-Info "To launch manually:"
                    Write-Host "    cd `"$($script:RepoDir)`"; copilot"
                    Write-Host "    Then: $(Get-AutobuildCommand)"
                }
            } else {
                Write-Info "Open the repository in GitHub Copilot Chat and run:"
                Write-Host ""
                Write-Host "    @workspace $(Get-AutobuildCommand)" -ForegroundColor White
                Write-Host ""
                Write-Info "The skill will present a pre-flight summary. Type GO to start the pipeline (use GO --workflow-engine for the workflow-engine build path)."
            }
        }
        "claude" {
            if ($script:ClaudeAvailable) {
                $launch = Read-YesNo "Launch claude in the new repository now?" "y"
                if ($launch -eq "y" -or $launch -eq "Y") {
                    Write-Info "Launching claude in: $($script:RepoDir)"
                    if (Start-CliInTerminal -Executable "claude" -Arguments @(".") -WorkingDirectory $script:RepoDir) {
                        Write-Ok "claude launched in a separate terminal."
                        Write-Host "    Then run: $(Get-AutobuildCommand)"
                    } else {
                        Write-Warn "claude did not open automatically. Run:"
                        Write-Host "    cd `"$($script:RepoDir)`"; claude ."
                        Write-Host "    Then: $(Get-AutobuildCommand)"
                    }
                } else {
                    Write-Info "To launch manually:"
                    Write-Host "    cd `"$($script:RepoDir)`"; claude ."
                    Write-Host "    Then: $(Get-AutobuildCommand)"
                }
            } else {
                Write-Warn "claude CLI is not installed. Install it from https://claude.ai/code then run:"
                Write-Host "    cd `"$($script:RepoDir)`"; claude ."
                Write-Host "    Then: $(Get-AutobuildCommand)"
            }
        }
        "agents" {
            Write-Info "Open the repository in your agent harness and run:"
            Write-Host ""
            Write-Host "    @workspace $(Get-AutobuildCommand)" -ForegroundColor White
            Write-Host ""
            Write-Info "Agent templates are in:"
            Write-Host "    $($script:RepoDir)\.agents\agents\"
        }
        "opencode" {
            if ($script:OpencodeAvailable) {
                $launch = Read-YesNo "Launch opencode in the new repository now?" "y"
                if ($launch -eq "y" -or $launch -eq "Y") {
                    Write-Info "Launching opencode in: $($script:RepoDir)"
                    if (Start-CliInTerminal -Executable "opencode" -Arguments @(".") -WorkingDirectory $script:RepoDir) {
                        Write-Ok "opencode launched in a separate terminal."
                        Write-Host "    Then run: $(Get-AutobuildCommand)"
                    } else {
                        Write-Warn "opencode did not open automatically. Run:"
                        Write-Host "    cd `"$($script:RepoDir)`"; opencode ."
                        Write-Host "    Then: $(Get-AutobuildCommand)"
                    }
                } else {
                    Write-Info "To launch manually:"
                    Write-Host "    cd `"$($script:RepoDir)`"; opencode ."
                    Write-Host "    Then: $(Get-AutobuildCommand)"
                }
            } else {
                Write-Warn "opencode CLI is not installed. Install it from https://opencode.ai then run:"
                Write-Host "    cd `"$($script:RepoDir)`"; opencode ."
                Write-Host "    Then: $(Get-AutobuildCommand)"
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
    Write-Host "  Idea file   : $(Join-Path $script:RepoDir 'docs\IDEA.md')"
    Write-Host "  PRD         : $( if ($script:PrdAdded) { Join-Path $script:RepoDir 'docs\PRD.md' } else { 'none (will be built from docs/IDEA.md by forge-auto-build-prd)' } )"
    Write-Host "  Research    : $( if ($script:ResearchAdded) { Join-Path $script:RepoDir 'docs\research\' } else { 'none' } )"
    if ($Headless) {
        Write-Host "  Mode        : headless (terminal-driven; no interactive CLI)"
    }
    Write-Host ""
    Write-Host "  Next steps:"
    Write-Host ""
    Write-Host "  1. Open the project in your agent harness."
    Write-Host "  2. Run the queued pipeline command:"
    Write-Host ""
    Write-Host "       @workspace $(Get-AutobuildCommand)" -ForegroundColor White
    Write-Host ""
    Write-Host "  3. Review the pre-flight summary that the skill presents."
    Write-Host "  4. Type GO to start the autonomous pipeline (add --workflow-engine to"
    Write-Host "     run the build through the workflow engine once the agent team is generated)."
    Write-Host ""
    Write-Host "  References:"
    Write-Host "   • Prompt playbook : $(Join-Path $script:RepoDir 'docs\prompt-playbook.md')"
    $skillsRoot = switch ($script:Harness) {
        "github"   { ".github" }
        "claude"   { ".claude" }
        "opencode" { ".opencode" }
        default    { ".agents" }
    }
    Write-Host "   • forge-auto-build    : $(Join-Path $script:RepoDir "$skillsRoot\skills\forge-auto-build\SKILL.md")"
    Write-Host "   • forge-auto-build-prd: $(Join-Path $script:RepoDir "$skillsRoot\skills\forge-auto-build-prd\SKILL.md")"
    Write-Host "       (paths may vary by harness)"
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
