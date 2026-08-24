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

.PARAMETER Draft
    In the interactive flow, pre-answer "yes" to the optional auto-draft stages:
    generate the PRD and/or agent team non-interactively (with review
    boundaries), then choose how to run the workflow engine. Non-interactive
    runs use FORGE_AUTO_DRAFT=1 instead.

.PARAMETER DryRun
    Print the headless command without executing it.

.EXAMPLE
    .\scripts\forge-launcher.ps1
    .\scripts\forge-launcher.ps1 -NonInteractive
    .\scripts\forge-launcher.ps1 -Headless -DryRun
    .\scripts\forge-launcher.ps1 -Draft
#>
[CmdletBinding()]
param (
    [switch]$NonInteractive,
    [switch]$Headless,
    [switch]$Draft,
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

function Show-Activity {
    param([string]$Activity)
    # Indeterminate animated progress bar (auto-suppressed when output is
    # redirected, so CI/piped runs stay clean). Keeps console output visible.
    Write-Progress -Activity $Activity -Status "Working…" -PercentComplete -1
}

function Complete-Activity {
    param([string]$Activity)
    Write-Progress -Activity $Activity -Completed
}

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

function Read-PromptTab {
    param (
        [string]$Message,
        [string]$Default = ""
    )
    if ($NonInteractive) {
        # Caller is expected to have set the appropriate env var
        return $Default
    }
    $displayMsg = if ($Default) { "$Message [$Default]" } else { "$Message" }
    if ([System.Console]::IsInputRedirected) {
        # Piped / redirected stdin -PSReadLine cannot edit non-interactively.
        $value = Read-Host $displayMsg
        if (-not $value -and $Default) { return $Default }
        return $value
    }
    try {
        Import-Module PSReadLine -ErrorAction Stop
        # Write the prompt ourselves; PSReadLine then renders the editable buffer
        # after it and its Tab keybindings complete file/directory paths.
        Write-Host "$displayMsg " -NoNewline
        $value = [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine(
            [runspace]::DefaultRunspace,
            $ExecutionContext,
            $null
        )
        Write-Host ""
        if (-not $value -and $Default) { return $Default }
        return $value
    } catch {
        # PSReadLine unavailable or the console is not usable -fall back to
        # plain Read-Host (no Tab completion) rather than failing the launcher.
        $value = Read-Host $displayMsg
        if (-not $value -and $Default) { return $Default }
        return $value
    }
}

function Expand-Path {
    param (
        [string]$Path
    )
    # Normalises a user-typed path: trims whitespace, expands ~ / ~\ to the
    # home directory, and expands $env:VAR / ${env:VAR} / $VAR / ${VAR}
    # references (which are otherwise treated as literal text). Unknown
    # variables expand to empty, matching shell behaviour.
    if (-not $Path) { return $Path }
    $p = $Path.Trim()
    if ($p -match '^~([/\\].*)?$') {
        # ~ alone, or ~/... / ~\... -home-dir shorthand (both separators)
        $p = if ($Matches[1]) { $HOME + $Matches[1] } else { $HOME }
    }
    $p = [regex]::Replace(
        $p,
        '\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)',
        {
            param($m)
            if ($m.Groups[1].Success) { $v = [Environment]::GetEnvironmentVariable($m.Groups[1].Value) }
            elseif ($m.Groups[2].Success) { $v = [Environment]::GetEnvironmentVariable($m.Groups[2].Value) }
            elseif ($m.Groups[3].Success) { $v = Get-Variable -Name $m.Groups[3].Value -ValueOnly -ErrorAction SilentlyContinue }
            else { $v = Get-Variable -Name $m.Groups[4].Value -ValueOnly -ErrorAction SilentlyContinue }
            if ($null -eq $v) { "" } else { [string]$v }
        }
    )
    return $p
}

function Resolve-InputFile {
    param (
        [string]$Path
    )
    # Expands a user-typed path and reports whether it is an existing regular
    # file. Returns the resolved path (via ResolvedPath) and True/False.
    $script:ResolvedPath = if ($Path) { Expand-Path $Path } else { "" }
    if (-not $script:ResolvedPath) { $script:ResolveReason = "empty path"; return $false }
    $script:ResolveReason = ""
    if (Test-Path -LiteralPath $script:ResolvedPath) {
        if (Test-Path -LiteralPath $script:ResolvedPath -PathType Leaf) { return $true }
        $script:ResolveReason = "not a regular file: $script:ResolvedPath"
        return $false
    }
    $script:ResolveReason = "file not found: $script:ResolvedPath"
    return $false
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

function Get-HeadlessCommandFor {
    param([string]$Message)
    # Returns the non-interactive terminal command that drives a skill message
    # via `opencode run --auto` or `copilot -p --yolo`.
    $runner = if ($env:FORGE_RUN_WITH) { $env:FORGE_RUN_WITH } else { if ($script:Harness -eq "github") { "copilot" } else { "opencode" } }
    if ($runner -eq "copilot") {
        return "copilot -p `"$Message`" --yolo"
    }
    return "opencode run --auto `"$Message`""
}

function Get-HeadlessCommand {
    # Returns the non-interactive terminal command that drives the queued skill.
    return Get-HeadlessCommandFor (Get-HeadlessSkillMessage)
}

function Invoke-SkillHeadless {
    # Executes a skill message non-interactively in the repository (or prints it
    # with -DryRun). Used by the --headless queued-skill run and auto-draft stages.
    param([string]$Message)
    $cmd = Get-HeadlessCommandFor $Message
    Write-Host "    $cmd" -ForegroundColor White
    if ($DryRun) {
        Write-Warn "Dry-run: command printed, not executed."
        return
    }
    $activity = "Running the skill (may take a while)"
    Show-Activity $activity
    try {
        Push-Location $script:RepoDir
        try {
            Invoke-Expression $cmd
        } finally {
            Pop-Location
        }
    } finally {
        Complete-Activity $activity
    }
}

function Invoke-HeadlessBuild {
    # Executes the queued headless build (used by --headless mode).
    Invoke-SkillHeadless (Get-HeadlessSkillMessage)
}

# ---------------------------------------------------------------------------
# Optional auto-draft flow (idea -> PRD -> agent team -> engine), driven
# non-interactively through the harness CLI with review boundaries in between.
# ---------------------------------------------------------------------------

function Test-HasPrd {
    return ($script:PrdAdded -or (Test-Path (Join-Path $script:RepoDir "docs\PRD.md") -PathType Leaf) -or (Test-Path (Join-Path $script:RepoDir "docs\product-vision.md") -PathType Leaf))
}

function Get-HarnessAgentsDir {
    switch ($script:Harness) {
        "github"   { return (Join-Path $script:RepoDir ".github\agents") }
        "claude"   { return (Join-Path $script:RepoDir ".claude\agents") }
        "opencode" { return (Join-Path $script:RepoDir ".opencode\agents") }
        default    { return (Join-Path $script:RepoDir ".agents\agents") }
    }
}

function Test-HasGeneratedTeam {
    $agentsDir = Get-HarnessAgentsDir
    if (-not (Test-Path $agentsDir -PathType Container)) { return $false }
    $templateNames = @("forge-team-builder.md", "project-orchestrator.md", "workflow-orchestrator.md")
    $count = @(Get-ChildItem -Path $agentsDir -Filter *.md -File | Where-Object { $_.Name -notin $templateNames }).Count
    return ($count -gt 0)
}

function Get-AutoDraftPrdSource {
    # Returns the PRD source for the team auto-draft. Prefers the decomposed
    # representation (vision + features) when it exists so forge-build-agent-team
    # runs in Vision + Features mode and builds the team from the features;
    # otherwise falls back to the monolithic docs\PRD.md.
    if ((Test-Path (Join-Path $script:RepoDir "docs\product-vision.md") -PathType Leaf) -and @(Get-ChildItem (Join-Path $script:RepoDir "docs\features\*.md") -ErrorAction SilentlyContinue).Count -gt 0) {
        return "the decomposed PRD representation (docs\product-vision.md + docs\features\*.md)"
    }
    return "docs\PRD.md"
}

function Invoke-DraftCommit {
    param([string]$Message)
    # Commits the artifacts produced by an auto-draft stage so the repo stays
    # reviewable. Skips when nothing changed.
    & git -C $script:RepoDir add "."
    $staged = & git -C $script:RepoDir diff --cached --name-only
    if (-not $staged) {
        Write-Warn "No changes to commit after auto-draft."
        return
    }
    & git -C $script:RepoDir commit -m $Message | Out-Null
    Write-Ok "Committed: '$Message'"
}

function Invoke-AutoDraftPrd {
    # idea -> PRD (or decomposed PRD). Runs forge-auto-build-prd headless and
    # records default assumptions for every unknown (Open Questions).
    if (Test-HasPrd) { return }
    if ($NonInteractive) {
        if ($env:FORGE_AUTO_DRAFT -ne "1") { return }
    } else {
        $default = if ($Draft) { "y" } else { "n" }
        $answer = Read-YesNo "Generate the PRD from docs/IDEA.md automatically now (headless, auto-proceed with best answers)?" $default
        if ($answer -ne "y" -and $answer -ne "Y") { return }
    }
    Write-Host ""
    Write-Info "Auto-drafting the PRD from docs/IDEA.md (headless) …"
    Invoke-SkillHeadless "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD."
    Invoke-DraftCommit "docs: add auto-drafted PRD"
    if (Test-HasPrd) {
        $script:PrdAdded = $true
        Write-Ok "PRD generated."
        Write-Host ""
        Write-Host "  Review it before continuing:"
        Write-Host "    - $(Join-Path $script:RepoDir 'docs\PRD.md')"
        if (Test-Path (Join-Path $script:RepoDir "docs\product-vision.md") -PathType Leaf) {
            Write-Host "    - $(Join-Path $script:RepoDir 'docs\product-vision.md') (decomposed) + docs\features\*.md"
        } else {
            Write-Host "    - docs\PRD.md is monolithic (no decomposition)"
        }
    } else {
        Write-Warn "The auto-draft did not produce docs/PRD.md or the decomposed layout. Review the run output and re-run manually if needed."
    }
}

function Invoke-AutoDraftTeam {
    # PRD -> agent team + skills. Runs forge-build-agent-team headless so the
    # user can review the generated team before any build execution.
    if (-not (Test-HasPrd)) { return }
    if ($NonInteractive) {
        if ($env:FORGE_AUTO_DRAFT -ne "1") { return }
    } else {
        $default = if ($Draft) { "y" } else { "n" }
        $answer = Read-YesNo "Generate the agent team from the PRD automatically now (headless)?" $default
        if ($answer -ne "y" -and $answer -ne "Y") { return }
    }
    Write-Host ""
    Write-Info "Auto-drafting the agent team from the PRD (headless) …"
    $prdSource = Get-AutoDraftPrdSource
    Invoke-SkillHeadless "/forge-build-agent-team Use $prdSource to build the agent team. Auto-proceed with default assumptions and no questions."
    Invoke-DraftCommit "feat: generate auto-drafted agent team"
    if (Test-HasGeneratedTeam) {
        Write-Ok "Agent team generated."
        Write-Host ""
        Write-Host "  Review the generated team before building:"
        Write-Host "    - Agents : $(Get-HarnessAgentsDir)"
        Write-Host "    - Skills : $(Split-Path (Get-HarnessAgentsDir) -Parent)\skills"
    } else {
        Write-Warn "The auto-draft did not produce project-specific agent files under $(Get-HarnessAgentsDir)."
    }
    Invoke-EngineDecision
}

function Invoke-EngineDecision {
    # After team generation: offer to run the workflow engine now (detached),
    # print the command to run later, or skip.
    Write-Host ""
    Write-Host "  The agent team is ready. You can run the build now through the"
    Write-Host "  workflow engine, run it later, or build manually."
    Write-Host ""
    if ($NonInteractive) {
        if ($env:FORGE_AUTO_DRAFT -ne "1") { return }
        Write-EngineCommand
        return
    }
    Write-Host "    1) Run the workflow-engine build now (detached)"
    Write-Host "    2) Print the engine command to run later"
    Write-Host "    3) Skip - I will launch the CLI / build manually"
    Write-Host ""
    $choice = Read-Prompt "Select [1-3]" "2"
    switch ($choice) {
        "1" { Start-EngineDetached }
        "2" { Write-EngineCommand }
        default { Write-Info "Skipping the engine for now. Run the build manually or use the printed command later." }
    }
}

function Write-EngineCommand {
    $engineScript = Join-Path $ScriptDir "forge-engine-run.ps1"
    $harness = if ($env:FORGE_ENGINE_HARNESS) { $env:FORGE_ENGINE_HARNESS } else { "opencode" }
    Write-Host "    $engineScript -Repo `"$($script:RepoDir)`" -Harness $harness -Yes" -ForegroundColor White
    Write-Host ""
    Write-Info "Run it from anywhere later to execute the build through the workflow engine."
}

function Start-EngineDetached {
    $engineScript = Join-Path $ScriptDir "forge-engine-run.ps1"
    $harness = if ($env:FORGE_ENGINE_HARNESS) { $env:FORGE_ENGINE_HARNESS } else { "opencode" }
    if ($DryRun) {
        Write-Warn "Dry-run: would start the engine detached:"
        Write-EngineCommand
        return
    }
    $log = Join-Path $script:RepoDir "docs\engine-run.log"
    $args = @("-Repo", $script:RepoDir, "-Harness", $harness, "-Yes")
    Start-Process -FilePath $engineScript -ArgumentList $args -RedirectStandardOutput "$log.out" -RedirectStandardError "$log.err" -WindowStyle Hidden | Out-Null
    $script:EngineStarted = $true
    Write-Ok "Engine started detached. Log: $log (.out/.err)"
    Write-Host ""
    Write-Info "The engine runs in the background, even after this launcher exits."
    Write-Info "Monitor progress from another terminal with:"
    Write-Host "    Get-Content `"$(Join-Path $script:RepoDir 'docs\engine-run.log')`" -Wait" -ForegroundColor White
    Write-Host "    Get-Content `"$(Join-Path $script:RepoDir 'docs\PROGRESS.md')`" -Wait" -ForegroundColor White
}

function Invoke-AutoDraftMenu {
    # Offered at Step 8 in interactive runs (and FORGE_AUTO_DRAFT runs): generate
    # the PRD and/or agent team non-interactively, with review boundaries.
    if (-not (Test-Path (Join-Path $script:RepoDir "docs\IDEA.md") -PathType Leaf)) { return }
    Invoke-AutoDraftPrd
    Invoke-AutoDraftTeam
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
    $parentDirRaw    = if ($NonInteractive) { $env:FORGE_REPO_PARENT_DIR  ?? (Get-Location).Path } else { Read-PromptTab "Parent directory for the new repo" (Get-Location).Path }

    if (-not $repoName) {
        Write-Fail "Non-interactive mode: `$env:FORGE_REPO_NAME is not set."
        exit 1
    }

    $repoVisibility = $repoVisibility.ToLower()
    if ($repoVisibility -ne "public" -and $repoVisibility -ne "private") { $repoVisibility = "private" }

    if (-not $parentDirRaw) { $parentDirRaw = (Get-Location).Path }
    $parentDir = [System.IO.Path]::GetFullPath((Expand-Path $parentDirRaw))

    $script:RepoDir = Join-Path $parentDir $repoName
    $script:RemoteCreated = $false

    if ($script:Harness -eq "github" -and $script:GhAvailable) {
        Write-Info "Creating GitHub repository '$repoName' ($repoVisibility) …"
        $ghArgs = @("repo", "create", $repoName, "--$repoVisibility", "--clone")
        if ($repoDescription) { $ghArgs += @("--description", $repoDescription) }
        $activity = "Creating GitHub repository '$repoName'"
        Show-Activity $activity
        try {
            & gh @ghArgs
        } finally {
            Complete-Activity $activity
        }
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
    Show-Activity "Bootstrapping Agent Forge (copying templates)"
    try {
        & $BootstrapPs1 -Target $script:RepoDir -Harness $script:Harness -Force
    } finally {
        Complete-Activity "Bootstrapping Agent Forge (copying templates)"
    }
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
            if (Resolve-InputFile $prdFile) {
                New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
                Copy-Item $script:ResolvedPath (Join-Path $docsDir "PRD.md")
                Write-Ok "PRD copied from `$env:FORGE_PRD_FILE → docs/PRD.md"
                $script:PrdAdded = $true
            } else {
                Write-Warn "FORGE_PRD_FILE is set but $script:ResolveReason -skipping PRD."
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
                $prdSrc = Read-PromptTab "Path to your PRD file" ""
                if ($prdSrc -and (Resolve-InputFile $prdSrc)) {
                    New-Item -ItemType Directory -Path $docsDir -Force | Out-Null
                    Copy-Item $script:ResolvedPath (Join-Path $docsDir "PRD.md")
                    Write-Ok "PRD copied → docs/PRD.md"
                    $script:PrdAdded = $true
                } else {
                    Write-Warn "$script:ResolveReason -skipping PRD."
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
                if ($f -and (Resolve-InputFile $f)) {
                    Copy-Item $script:ResolvedPath $researchDir
                    Write-Ok "Research doc copied: $(Split-Path $script:ResolvedPath -Leaf) → docs/research/"
                    $script:ResearchAdded = $true
                } elseif ($f) {
                    Write-Warn "FORGE_RESEARCH_FILES: $script:ResolveReason -skipping."
                }
            }
        }
    } else {
        Write-Host ""
        $addResearch = Read-YesNo "Do you have research or seed documents to add (design specs, market research, technical notes…)?" "n"
        if ($addResearch -eq "y" -or $addResearch -eq "Y") {
            New-Item -ItemType Directory -Path $researchDir -Force | Out-Null
            Write-Host ""
            Write-Host "  Enter file paths one per line (Tab to complete existing paths)."
            Write-Host "  Press Enter on a blank line when done:"
            Write-Host "  ──────────────────────────────────────────────────────────────"
            while ($true) {
                $resPath = Read-PromptTab "  path" ""
                if (-not $resPath) { break }
                $resPath = $resPath.Trim()
                if (Resolve-InputFile $resPath) {
                    Copy-Item $script:ResolvedPath $researchDir
                    Write-Ok "Research doc copied: $(Split-Path $script:ResolvedPath -Leaf) → docs/research/"
                    $script:ResearchAdded = $true
                } else {
                    Write-Warn "$script:ResolveReason -skipping."
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
        Show-Activity "Pushing to remote"
        try {
            try {
                & git -C $script:RepoDir push -u origin HEAD 2>$null
            } catch {
                $branch = & git -C $script:RepoDir rev-parse --abbrev-ref HEAD
                & git -C $script:RepoDir push -u origin $branch
            }
        } finally {
            Complete-Activity "Pushing to remote"
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

    # Optional auto-draft flow: generate the PRD and/or agent team non-interactively
    # (with review boundaries), then decide how to run the workflow engine.
    Invoke-AutoDraftMenu

    if ($script:EngineStarted) {
        Write-Host ""
        Write-Info "The workflow engine is already running this build in the background."
        Write-Info "Skipping the interactive CLI launch prompt - no need to run forge-auto-build."
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
    if ($script:EngineStarted) {
        $engineHarness = if ($env:FORGE_ENGINE_HARNESS) { $env:FORGE_ENGINE_HARNESS } else { "opencode" }
        $engineScript = Join-Path $ScriptDir "forge-engine-run.ps1"
        Write-Host "  1. The workflow engine is building the project in the background"
        Write-Host "     (it keeps running after this launcher exits)."
        Write-Host "  2. Monitor progress from another terminal:"
        Write-Host ""
        Write-Host "       Get-Content `"$(Join-Path $script:RepoDir 'docs\engine-run.log')`" -Wait" -ForegroundColor White
        Write-Host "       Get-Content `"$(Join-Path $script:RepoDir 'docs\PROGRESS.md')`" -Wait" -ForegroundColor White
        Write-Host ""
        Write-Host "  3. Re-run or resume the engine later if needed:"
        Write-Host ""
        Write-Host "       $engineScript -Repo `"$($script:RepoDir)`" -Harness $engineHarness -Yes" -ForegroundColor White
    } else {
        Write-Host "  1. Open the project in your agent harness."
        Write-Host "  2. Run the queued pipeline command:"
        Write-Host ""
        Write-Host "       @workspace $(Get-AutobuildCommand)" -ForegroundColor White
        Write-Host ""
        Write-Host "  3. Review the pre-flight summary that the skill presents."
        Write-Host "  4. Type GO to start the autonomous pipeline (add --workflow-engine to"
        Write-Host "     run the build through the workflow engine once the agent team is generated)."
    }
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
$script:EngineStarted     = $false

Invoke-PreflightCheck
Select-Harness
New-Repository
Invoke-BootstrapForge
Invoke-CaptureIdea
Invoke-AddPrdAndResearch
Invoke-CommitBootstrap
Invoke-LaunchAutobuild
Write-CompletionSummary
