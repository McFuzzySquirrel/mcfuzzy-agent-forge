# Forge Launcher

> One command from zero to auto-build. Guides you through creating a repo, bootstrapping Agent Forge, capturing your idea, and launching the full pipeline.

---

## Overview

`forge-launcher` is an interactive terminal script that orchestrates the complete Agent Forge onboarding flow in a single session:

1. **Pre-flight** -checks that `git` and optional tools (`gh`, `copilot`, `opencode`, `claude`) are installed.
2. **Harness selection** -choose GitHub Copilot, opencode, Claude Code, or generic `.agents`.
3. **Repo creation** -creates a GitHub repository (via `gh`) or initialises a local `git init`.
4. **Bootstrap** -runs the existing `bootstrap.sh` / `bootstrap.ps1` into the new repo.
5. **Idea capture** -prompts for your project idea and saves it to `docs/IDEA.md`.
6. **PRD & research** *(optional, recommended)* -add an existing PRD (`docs/PRD.md`) and/or research / seed documents (`docs/research/`).
7. **Commit + push** -commits the bootstrapped forge, idea file, PRD, and any research docs.
8. **Auto-build launch** -opens Copilot CLI, opencode, or Claude Code in a separate terminal when available, with clear fallback commands if not.
9. **Summary** -prints the repo path, harness, and next steps.

---

## Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| `git` | **Yes** | All harnesses |
| `gh` (GitHub CLI) | For GitHub harness | Creates and clones the GitHub repo |
| `opencode` | For opencode harness auto-launch | Spawns the opencode session |
| `claude` | For Claude Code harness auto-launch | Spawns the Claude Code session |
| Bash 4+ | For `forge-launcher.sh` | Linux / macOS |
| PowerShell 5.1+ | For `forge-launcher.ps1` | Windows |

---

## Usage

### Linux / macOS

```bash
./scripts/forge-launcher.sh
```

### Windows (PowerShell)

```powershell
.\scripts\forge-launcher.ps1
```

### Non-interactive mode (CI / automation)

```bash
export FORGE_HARNESS_CHOICE="2"                   # 1=GitHub Copilot, 2=opencode, 3=Claude Code, 4=agents
export FORGE_REPO_NAME="my-app"
export FORGE_REPO_PARENT_DIR="/home/user/projects"
export FORGE_IDEA="A task management web app with a React frontend and a Node.js API"
export FORGE_PRD_FILE="/path/to/my-prd.md"          # optional
export FORGE_RESEARCH_FILES="/path/to/research.md,/path/to/notes.md"  # optional
export FORGE_YN_DEFAULT="y"
./scripts/forge-launcher.sh --non-interactive
```

```powershell
$env:FORGE_IDEA = "A task management web app with a React frontend and a Node.js API"
$env:FORGE_PRD_FILE = "C:\path\to\my-prd.md"                              # optional
$env:FORGE_RESEARCH_FILES = "C:\path\to\research.md,C:\path\to\notes.md"  # optional
$env:FORGE_YN_DEFAULT = "y"
.\scripts\forge-launcher.ps1 -NonInteractive
```

---

## Step-by-step walkthrough

### Step 1 -Pre-flight check

The launcher checks each required and optional tool and reports its version or a warning. If `git` is missing the script exits immediately. Missing optional tools (`gh`, `opencode`, `claude`) only disable the features that depend on them.

```
▶ Step 1 of 9: Pre-flight check
  ✔  git 2.43.0
  ✔  gh 2.47.0
  ⚠  opencode not found -opencode harness auto-launch will be unavailable.
  ✔  claude (installed)
  ✔  bootstrap.sh found
```

### Step 2 -Select harness

```
▶ Step 2 of 9: Select agent harness

  Which agent harness will this project use?

    1) GitHub Copilot   (harness: github,    dir: .github/)
    2) opencode         (harness: opencode,  dir: .opencode/)
    3) Claude Code      (harness: claude,    dir: .claude/)
    4) Generic .agents  (harness: agents,    dir: .agents/)  [default]

Select [1-4] [4]:
```

Your choice determines:
- The `--harness` flag passed to `bootstrap.sh` / `bootstrap.ps1`.
- The directory where agent and skill templates are placed.
- How the auto-build launch is handled (CLI spawn vs. printed instructions).

### Step 3 -Create repository

For the **GitHub Copilot** harness (when `gh` is available):

```
▶ Step 3 of 9: Create repository
Repository name (no spaces): my-cool-app
Short description (optional): My cool app description
Visibility -public or private [private]:
Parent directory for the new repo [/home/user/projects]:

  Creating GitHub repository 'my-cool-app' (private) …
  ✔  GitHub repo created and cloned to: /home/user/projects/my-cool-app
```

For all other harnesses (or when `gh` is not installed):

```
  Initialising local Git repository at: /home/user/projects/my-cool-app
  ✔  Local git repository initialised: /home/user/projects/my-cool-app
Add a Git remote for this repository now? [y/N]: y
Remote URL (e.g. https://github.com/user/repo.git): https://github.com/user/my-cool-app.git
  ✔  Remote 'origin' added
```

### Step 4 -Bootstrap Agent Forge

Runs `bootstrap.sh` (or `bootstrap.ps1`) with `--force` into the new repository, copying all agent and skill templates into the harness directory.

```
▶ Step 4 of 9: Bootstrap Agent Forge
  Running bootstrap.sh → /home/user/projects/my-cool-app (--harness github) …
  ✔  Agent Forge templates bootstrapped.
```

### Step 5 -Capture your idea

Enter your project idea in the terminal (press `Ctrl+D` or a blank line when done on Bash; press Enter twice on PowerShell). The text is saved to `docs/IDEA.md` (with a compatibility copy at repo root `IDEA.md`).

```
▶ Step 5 of 9: Capture your project idea

  Enter your idea (press Ctrl+D on an empty line when finished):
  ──────────────────────────────────────────────────────────────
  A task management web app. Users can create projects, add tasks with
  due dates and priorities, and track completion. React frontend, Node.js
  API, PostgreSQL database. Authentication via GitHub OAuth.
  ^D
  ✔  Idea saved to: /home/user/projects/my-cool-app/docs/IDEA.md
```

### Step 6 -Add PRD and research / seed documents *(optional -recommended)*

This step is optional but strongly recommended. Starting the pipeline with a well-defined PRD produces significantly better results than starting from an idea alone. Research and seed documents (design specs, market research, technical notes, etc.) give every downstream stage additional context.

```
▶ Step 6 of 9: Add PRD and research / seed documents (optional -recommended)

  Why this step matters:
  Starting with a well-defined PRD produces a far more accurate and
  complete build than starting from an idea alone.  Research / seed
  documents (design specs, market research, technical notes, etc.) give
  the pipeline additional context that improves every downstream stage.

  Do you have an existing PRD to add?

    1) Yes -provide a file path to copy in as docs/PRD.md
    2) Yes -paste the PRD content directly
    3) No  -skip (the pipeline will generate one from docs/IDEA.md)

Select [1-3] [3]: 1
Path to your PRD file: /home/user/documents/my-app-prd.md
  ✔  PRD copied → docs/PRD.md

Do you have research or seed documents to add (design specs, market research, technical notes…)? [y/N]: y

  Enter file paths one per line.
  Press Ctrl+D on an empty line when done:
  ──────────────────────────────────────────────────────────────
  /home/user/documents/market-research.md
  /home/user/documents/technical-notes.md
  ^D
  ✔  Research doc copied: market-research.md → docs/research/
  ✔  Research doc copied: technical-notes.md → docs/research/
```

If you skip this step, the `forge-build-prd` stage will generate a PRD interactively from `docs/IDEA.md` when `forge-auto-build` runs. For the best results, spend extra time on the PRD or spec first: you can run `/forge-build-prd` as a separate skill, then feed that PRD into the launcher or into `/forge-auto-build` as the initial spec. Adding research or seed documents in `docs/research/` also improves downstream quality.

### Step 7 -Commit bootstrapped forge and idea

```
▶ Step 7 of 9: Commit bootstrapped forge and idea
  ✔  Committed: 'chore: bootstrap agent forge'
  Pushing to remote …
  ✔  Pushed to remote.
```

### Step 8 -Launch auto-build

For harnesses with a spawnable CLI (`copilot`, `opencode`, `claude`):

```
▶ Step 8 of 9: Launch auto-build

  The repository is bootstrapped and ready for forge-auto-build.

Launch claude in the new repository now? [y/N]: y
  Launching claude in: /home/user/projects/my-cool-app
  ✔  claude launched. Use /forge-auto-build in the Claude Code chat to start the pipeline.
```

For GitHub Copilot, the launcher now tries to open the GitHub Copilot CLI in a separate terminal if `copilot` is installed. If that is not available, it falls back to the manual chat instructions below:

```
  Open the repository in GitHub Copilot Chat and run:

    @workspace /forge-auto-build A task management web app...

  The skill will present a pre-flight summary. Type GO to start the full pipeline.
```

### Step 9 -Summary

```
▶ Step 9 of 9: Summary

════════════════════════════════════════════════════════
  forge-launcher: Complete
════════════════════════════════════════════════════════

  Repository  : /home/user/projects/my-cool-app
  Harness     : Claude Code (--harness claude)
  Remote      : yes
  Idea file   : /home/user/projects/my-cool-app/docs/IDEA.md
  PRD         : /home/user/projects/my-cool-app/docs/PRD.md
  Research    : /home/user/projects/my-cool-app/docs/research/

  Next steps:

  1. Open the project in your agent harness.
  2. Run the auto-build skill:

      @workspace /forge-auto-build Use docs/IDEA.md as the project idea

  3. Review the pre-flight summary that the skill presents.
  4. Type GO to start the fully autonomous pipeline.
```

---

## Harness support matrix

| Harness | Repo create | Bootstrap flag | Auto-build launch |
|---------|------------|----------------|-------------------|
| GitHub Copilot | `gh repo create` | `--harness github` | Printed instructions (manual) |
| opencode | `git init` + optional remote | `--harness opencode` | `opencode .` spawn (optional) |
| Claude Code | `git init` + optional remote | `--harness claude` | `claude .` spawn (optional) |
| Generic `.agents` | `git init` + optional remote | `--harness agents` | Printed instructions |

---

## Non-interactive environment variables

| Variable | Used in step | Description |
|----------|-------------|-------------|
| `FORGE_HARNESS_CHOICE` | 2 | Harness selection: `1`=GitHub Copilot, `2`=opencode, `3`=Claude Code, `4`=generic `.agents` (default: `4`) |
| `FORGE_REPO_NAME` | 3 | Repository name (required in non-interactive mode) |
| `FORGE_REPO_DESCRIPTION` | 3 | Short repository description (optional) |
| `FORGE_REPO_VISIBILITY` | 3 | `public` or `private` (default: `private`) |
| `FORGE_REPO_PARENT_DIR` | 3 | Parent directory in which the repo directory is created (default: current working directory) |
| `FORGE_IDEA` | 5 | Project idea text written to `docs/IDEA.md` (and mirrored to `IDEA.md`) |
| `FORGE_PRD_FILE` | 6 | Absolute path to an existing PRD file to copy in as `docs/PRD.md` |
| `FORGE_RESEARCH_FILES` | 6 | Comma-separated list of absolute paths to research/seed documents copied to `docs/research/` |
| `FORGE_YN_DEFAULT` | 3, 7 | Default answer for yes/no prompts (`y` or `n`) |

All other step inputs (repo name, description, visibility, parent directory) use their defaults in non-interactive mode. Override them by setting the variables before running:

```bash
export REPO_NAME="my-app"           # Step 3: set via prompt default or pre-set env var
```

> **Note:** In non-interactive mode `FORGE_IDEA` is required. The script exits with an error if it is not set.

---

## docs/IDEA.md format

The launcher creates `docs/IDEA.md` (and mirrors it to `IDEA.md`) with the following structure:

```markdown
# Project Idea

<your idea text>

---

> Generated by forge-launcher on 2026-08-05T19:00:00Z
> Use this file as input for: `@workspace /forge-auto-build Use docs/IDEA.md as the project idea`
```

Pass this file to `forge-auto-build` by referencing it in the chat:

```
@workspace /forge-auto-build Use docs/IDEA.md as the project idea
```

Or invoke without arguments and let `forge-auto-build` detect the best source from the repo:

```
@workspace /forge-auto-build
```

When invoked without arguments, the skill checks in this order: `docs/PRD.md`, `docs/IDEA.md`, `IDEA.md`. If multiple inputs are available, it asks you to choose which source to use for that run.

Or paste the idea text directly -all three approaches work.

---

## Troubleshooting

### "bootstrap.sh not found or not executable"

The launcher expects to be run from within the `mcfuzzy-agent-forge` clone. Make sure you run it as `./scripts/forge-launcher.sh` from the repo root, or that the script's relative path to `bootstrap.sh` resolves correctly.

### "gh not found" on GitHub harness

Install the GitHub CLI: <https://cli.github.com/>. Authenticate with `gh auth login` before running the launcher.

### The launcher created the repo but bootstrap failed

The repository directory was created before bootstrap ran. You can re-run bootstrap manually:

```bash
./scripts/bootstrap.sh /path/to/your/repo --harness <harness>
```

Then continue from Step 5 (create `docs/IDEA.md` manually and commit).

### CLI did not launch

Check that the relevant CLI is on your `PATH` and executable. For GitHub Copilot CLI, install the CLI and make sure `copilot` resolves from your shell. For Claude Code: <https://claude.ai/code>. For opencode: follow the opencode installation guide.

If the launcher cannot open a terminal automatically, run the fallback command manually:

```bash
cd /path/to/your/repo && copilot
# or
cd /path/to/your/repo && opencode .
# or
cd /path/to/your/repo && claude .
```

Then in the chat or terminal, run `/forge-auto-build <your idea>`.

---

## Design decisions

See [ADR-010: Forge Launcher](adr/010-forge-launcher.md) for the full rationale, including why a script-first (Tier 1) approach was chosen, why harness selection is step 2, and why `IDEA.md` is the hand-off artifact.
