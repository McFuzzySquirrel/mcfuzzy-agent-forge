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
6. **PRD & research** *(optional, recommended)* -add an existing PRD (`docs/PRD.md`) and/or research / seed documents (`docs/research/`). If skipped, the pipeline queues `forge-auto-build-prd` to build a reviewed PRD from the idea first.
7. **Commit + push** -commits the bootstrapped forge, idea file, PRD, and any research docs.
8. **Auto-build launch** -offers the optional **auto-draft** flow: generate the PRD (`forge-auto-build-prd`) and/or the agent team (`forge-build-agent-team`) non-interactively, with review boundaries in between, then run the workflow engine now (detached), print its command to run later, or build manually. It queues `forge-auto-build` when a PRD was captured (it generates the agent team then executes the build), or `forge-auto-build-prd` when it was not (it produces the reviewed PRD first). Opens Copilot CLI, opencode, or Claude Code in a separate terminal when available, with clear fallback commands if not.
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

### Draft (auto-author) mode

The optional **auto-draft** flow generates the PRD and/or the agent team
non-interactively (best answers, every unknown recorded as an Open Question),
stopping at review boundaries before any build execution. Use `--draft` to
pre-answer "yes" to both auto-draft prompts interactively:

```bash
./scripts/forge-launcher.sh --draft
.\scripts\forge-launcher.ps1 -Draft
```

In non-interactive runs, set `FORGE_AUTO_DRAFT=1` instead:

```bash
export FORGE_AUTO_DRAFT="1"
./scripts/forge-launcher.sh --non-interactive
```

See the [Auto-draft (optional)](#auto-draft-optional-idea--prd--team-with-review-boundaries)
section below for the full flow.

### Non-interactive mode (CI / automation)

```bash
export FORGE_HARNESS_CHOICE="2"                   # 1=GitHub Copilot, 2=opencode, 3=Claude Code, 4=agents
export FORGE_REPO_NAME="my-app"
export FORGE_REPO_PARENT_DIR="/home/user/projects"
export FORGE_IDEA="A task management web app with a React frontend and a Node.js API"
export FORGE_PRD_FILE="/path/to/my-prd.md"          # optional
export FORGE_RESEARCH_FILES="/path/to/research.md,/path/to/notes.md"  # optional
export FORGE_AUTO_DRAFT="1"                        # optional: run the auto-draft stages headlessly
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

### Headless mode (terminal-driven, no interactive CLI)

By default Step 8 opens an interactive CLI (`opencode`, `claude`, `copilot`) in a
separate terminal and prints the skill command to run there. With `--headless`
the launcher instead drives the queued skill directly from the terminal via
`opencode run --auto` or `copilot -p --yolo`, so you never enter a chat session.

The workflow engine executes **outside** any CLI session: `forge-auto-build`'s
engine path starts it **detached** (`nohup`, log: `docs/engine-run.log`) and
polls `docs/WORKFLOW-STATE.json` to completion, so the build survives the
session and resumes with `run`. Once the manifest exists you can also run the
engine directly as a standalone process:

```bash
./scripts/forge-engine-run.sh --harness opencode --yes   # per-task: opencode run --auto
./scripts/forge-engine-run.sh --harness copilot --yes    # per-task: copilot -p --yolo
```

A `--headless` launcher run can therefore go from idea to finished build without
opening any interactive CLI.

```bash
# Drive the queued skill now (prints and runs the command)
./scripts/forge-launcher.sh --headless

# Print the exact command without running it (CI / testing)
./scripts/forge-launcher.sh --headless --dry-run

# PowerShell
.\scripts\forge-launcher.ps1 -Headless
.\scripts\forge-launcher.ps1 -Headless -DryRun
```

What gets queued:

| Repo state | Queued command |
|---|---|
| PRD captured in Step 6 (or a decomposed PRD exists) | `opencode run --auto "/forge-auto-build Use docs/PRD.md as the project PRD. GO [--workflow-engine]"` |
| No PRD captured | `opencode run --auto "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD."` |

The embedded `GO` satisfies `forge-auto-build`'s pre-flight gate, and the
headless `forge-auto-build-prd` invocation skips its interactive confirmation
and clarifying questions (every unknown is recorded as an Open Question with a
default assumption in the PRD). Use `FORGE_RUN_WITH=copilot` to emit
`copilot -p "..." --yolo` instead of `opencode run --auto` (defaults to
`copilot` for the GitHub Copilot harness, `opencode` otherwise), and
`FORGE_WORKFLOW_ENGINE=1` to append `GO --workflow-engine` so the build executes
through the workflow engine. On that path the engine runs **detached** (not as a
blocking child of the session) and the per-task harness is selected with
`FORGE_ENGINE_HARNESS=opencode|copilot|openai|stub|flowforge-kernel`.

> **Headless + engine:** the engine's own pre-run gate is interactive-only. It
> auto-skips when stdin is not a TTY, and `--yes` (or `FORGE_ENGINE_YES=1`)
> skips it explicitly for CI/headless runs.

### Auto-draft (optional): idea → PRD → team, with review boundaries

The **auto-draft** option lets you run the authoring stages non-interactively
("best answers provided", every unknown recorded as an Open Question with a
default assumption) and still keep human review between stages:

1. **Idea → PRD.** With no PRD yet, Step 8 asks *"Generate the PRD from
   `docs/IDEA.md` automatically now?"*. Answering yes runs `forge-auto-build-prd`
   headless (via `opencode run --auto` / `copilot -p --yolo`), producing
   `docs/PRD.md` (plus `docs/product-vision.md` + `docs/features/*.md` when it
   qualifies for decomposition), committed as `docs: add auto-drafted PRD`.
   Review it, then choose: draft the team now, launch the harness CLI to be
   interviewed/refine interactively, or stop.
2. **PRD → team.** With a PRD present, Step 8 asks *"Generate the agent team
   from the PRD automatically now?"*. Answering yes runs `forge-build-agent-team`
   headless, producing the agent + skill files under the harness directory,
   committed as `feat: generate auto-drafted agent team`. When a decomposed
   layout exists (`docs/product-vision.md` + `docs/features/*.md`), the team is
   built **from the feature documents** (Vision + Features mode); otherwise it is
   built from the monolithic `docs/PRD.md`. Review them, then:
   - run the workflow-engine build **now** (detached via `forge-engine-run.sh`),
   - **print the engine command** to run later, or
   - launch the CLI for a manual build.

Use `--draft` to pre-answer "yes" to both auto-draft prompts (interactive), or
set `FORGE_AUTO_DRAFT=1` in non-interactive runs. The workflow-engine run later:

```bash
./scripts/forge-engine-run.sh --repo "<repo-dir>" --harness opencode --yes
```

> Auto-draft drives the harness CLI directly, so it needs `opencode` (or
> `copilot` via `FORGE_RUN_WITH=copilot`). It commits each generated artifact so
> your repo stays reviewable at every boundary.

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
```

Path prompts (like the parent directory) support **Tab completion** to existing
file/directory locations (via bash readline on Bash and PSReadLine on
PowerShell), so you can autocomplete rather than hand-typing paths. Typed paths
also accept shell-style shorthand: `~`/`~/...` and `$VAR`/`${VAR}` (e.g.
`$HOME/projects`) are expanded before the path is checked.

```
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
    3) No  -skip (the pipeline will build a PRD from docs/IDEA.md first)

Select [1-3] [3]: 1
Path to your PRD file: /home/user/documents/my-app-prd.md
  ✔  PRD copied → docs/PRD.md

Do you have research or seed documents to add (design specs, market research, technical notes…)? [y/N]: y

  Enter file paths one per line (Tab to complete existing paths).
  Press Ctrl+D on an empty line when done:
  ──────────────────────────────────────────────────────────────
  /home/user/documents/market-research.md
  /home/user/documents/technical-notes.md
  ^D
  ✔  Research doc copied: market-research.md → docs/research/
  ✔  Research doc copied: technical-notes.md → docs/research/
```

The PRD path and the research/seed paths accept **Tab completion** to existing
files and folders (bash readline on Bash, PSReadLine on PowerShell), plus
`~`/`~/...` and `$VAR`/`${VAR}` (e.g. `$HOME/...`) expansion - so you can point
at external PRD or seed documents with their usual shorthand instead of typing a
full absolute path.

If you skip this step, the pipeline queues `forge-auto-build-prd`, which builds a reviewed PRD from `docs/IDEA.md` (including the automatic decomposition check) before the build pipeline runs. For the best results, spend extra time on the PRD or spec first: you can run `/forge-build-prd` as a separate skill, then feed that PRD into the launcher or into `/forge-auto-build` as the initial spec. Adding research or seed documents in `docs/research/` also improves downstream quality.

### Step 7 -Commit bootstrapped forge and idea

```
▶ Step 7 of 9: Commit bootstrapped forge and idea
  ✔  Committed: 'chore: bootstrap agent forge'
  Pushing to remote …
  ✔  Pushed to remote.
```

### Step 8 -Launch auto-build

Step 8 first offers the optional **auto-draft** stages. When no PRD was captured,
it asks whether to generate one non-interactively; when a PRD exists, it asks
whether to generate the agent team non-interactively (from the decomposed
vision + features when present, otherwise from `docs/PRD.md`). Each stage commits
its artifacts and stops for review before the next step, then asks how to run
the workflow engine - now (detached), later (prints the command), or manually:

```
Generate the PRD from docs/IDEA.md automatically now (headless, auto-proceed with best answers)? [y/N]: y
  Auto-drafting the PRD from docs/IDEA.md (headless) …
    opencode run --auto "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD."
  ✔  Committed: 'docs: add auto-drafted PRD'
  ✔  PRD generated.
  Review it before continuing:
    - /home/user/projects/my-cool-app/docs/PRD.md
Generate the agent team from the PRD automatically now (headless)? [y/N]: y
  Auto-drafting the agent team from the PRD (headless) …
    opencode run --auto "/forge-build-agent-team Use docs/PRD.md to build the agent team. Auto-proceed with default assumptions and no questions."
  ✔  Committed: 'feat: generate auto-drafted agent team'
  ✔  Agent team generated.
  Review the generated team before building:
    - Agents : /home/user/projects/my-cool-app/.agents/agents/
    - Skills : /home/user/projects/my-cool-app/.agents/skills/
  The agent team is ready. You can run the build now through the
  workflow engine, run it later, or build manually.
    1) Run the workflow-engine build now (detached)
    2) Print the engine command to run later
    3) Skip -I will launch the CLI / build manually
Select [1-3] [2]: 2
    /home/user/mcfuzzysquirrel/Projects/experiments/mcfuzzy-agent-forge/scripts/forge-engine-run.sh --repo "/home/user/projects/my-cool-app" --harness opencode --yes
```

Then, for harnesses with a spawnable CLI (`copilot`, `opencode`, `claude`):

```
▶ Step 8 of 9: Launch auto-build

  The repository is bootstrapped. The queued command depends on whether a PRD
  was captured in Step 6.

Launch claude in the new repository now? [y/N]: y
  Launching claude in: /home/user/projects/my-cool-app
  ✔  claude launched. Use /forge-auto-build-prd in the Claude Code chat to build
     the reviewed PRD, then /forge-auto-build for the agent team and build.
```

For GitHub Copilot, the launcher now tries to open the GitHub Copilot CLI in a separate terminal if `copilot` is installed. If that is not available, it falls back to the manual chat instructions below:

```
  Open the repository in GitHub Copilot Chat and run:

    @workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea

  The skill will build a reviewed PRD from your idea (with automatic
  decomposition when it qualifies), then direct you to forge-auto-build for
  the agent team and build execution.
```

When a PRD **was** captured in Step 6, the queued command is instead:

```
  @workspace /forge-auto-build Use docs/PRD.md as the project PRD
```

`forge-auto-build` requires the PRD to already exist. It generates the agent team, optionally assigns models, then executes the build - type `GO` at its pre-flight gate, or `GO --workflow-engine` to run the build through the workflow engine instead of the prompt-driven orchestrator. On the engine path the engine starts detached (`docs/engine-run.log`), `forge-auto-build` polls `docs/WORKFLOW-STATE.json` until the run is `complete` or `failed`, and you can run or resume it standalone with `scripts/forge-engine-run.sh`.

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
  2. Run the queued pipeline command:

      @workspace /forge-auto-build Use docs/PRD.md as the project PRD

  3. Review the pre-flight summary that the skill presents.
  4. Type GO to start the autonomous pipeline (add --workflow-engine to run
     the build through the workflow engine once the agent team is generated).
     On the engine path the engine runs detached (docs/engine-run.log); run or
     resume it standalone with scripts/forge-engine-run.sh.
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
| `FORGE_REPO_PARENT_DIR` | 3 | Parent directory in which the repo directory is created (default: current working directory). Accepts `~`/`~/...` and `$VAR` expansion |
| `FORGE_IDEA` | 5 | Project idea text written to `docs/IDEA.md` (and mirrored to `IDEA.md`) |
| `FORGE_PRD_FILE` | 6 | Path to an existing PRD file to copy in as `docs/PRD.md`. Accepts relative, `~`/`~/...`, and `$VAR`/`${VAR}` paths (e.g. `~/docs/prd.md`) |
| `FORGE_RESEARCH_FILES` | 6 | Comma-separated list of paths to research/seed documents copied to `docs/research/`. Each path accepts relative, `~`/`~/...`, and `$VAR`/`${VAR}` forms |
| `FORGE_YN_DEFAULT` | 3, 7 | Default answer for yes/no prompts (`y` or `n`) |
| `FORGE_AUTO_DRAFT` | 8 | `1` to run the applicable auto-draft stages (PRD and/or agent team) non-interactively |
| `FORGE_RUN_WITH` | 8 | Headless runner: `opencode` or `copilot` (default: `copilot` for the GitHub harness, `opencode` otherwise) |
| `FORGE_WORKFLOW_ENGINE` | 8 | `1` to append `GO --workflow-engine` to the queued headless command (build executes via the workflow engine) |
| `FORGE_ENGINE_HARNESS` | 8 | Per-task harness for the workflow engine: `opencode` (default), `copilot`, `openai`, `stub`, or `flowforge-kernel` |

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
> Use this file as input for: `@workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea`
```

Pass this file to `forge-auto-build-prd` by referencing it in the chat:

```
@workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea
```

`forge-auto-build-prd` builds a reviewed PRD from the idea (with automatic decomposition when it qualifies) and stops there. Once `docs/PRD.md` exists, run `forge-auto-build` for the agent team and build execution:

```
@workspace /forge-auto-build Use docs/PRD.md as the project PRD
```

Or invoke `forge-auto-build` without arguments and let it detect the best PRD representation from the repo (`docs/PRD.md`, or the decomposed `docs/product-vision.md` + `docs/features/*.md`):

```
@workspace /forge-auto-build
```

When invoked without arguments, the skill uses an explicit PRD path if one was supplied, then `docs/PRD.md`, then the decomposed layout. If no PRD representation exists, it stops and directs you to `forge-auto-build-prd` or `forge-build-prd`.

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

Then in the chat or terminal, run `/forge-auto-build-prd <your idea>` to build the reviewed PRD first, or `/forge-auto-build docs/PRD.md` once a PRD exists.

---

## Design decisions

See [ADR-010: Forge Launcher](adr/010-forge-launcher.md) for the full rationale, including why a script-first (Tier 1) approach was chosen, why harness selection is step 2, and why `IDEA.md` is the hand-off artifact.
