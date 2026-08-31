# Forge Launcher

> One command from zero to auto-build. Guides you through creating a repo, bootstrapping MyForge, capturing your idea, and launching the full pipeline.

---

## Overview

`forge-launcher` is an interactive terminal script that orchestrates the complete MyForge onboarding flow in a single session:

1. **Pre-flight** -checks that `git` and optional tools (`gh`, `copilot`, `opencode`, `claude`) are installed.
2. **Harness selection** -choose GitHub Copilot, opencode, Claude Code, or generic `.agents`.
3. **Repo creation** -creates a GitHub repository (via `gh`) or initialises a local `git init`.
4. **Bootstrap** -runs the bundled bootstrap into the new repo.
5. **Idea capture** -prompts for your project idea and saves it to `docs/IDEA.md`.
6. **PRD & research** *(optional, recommended)* -add an existing PRD (`docs/PRD.md`) and/or research / seed documents (`docs/research/`). If skipped, the pipeline queues `forge-auto-build-prd` to build a reviewed PRD from the idea first.
7. **Commit + push** -commits the bootstrapped forge, idea file, PRD, and any research docs.
8. **Auto-build launch** -offers the optional **auto-draft** flow: generate the PRD (`forge-auto-build-prd`) and/or the agent team (`forge-build-agent-team`) non-interactively, with review boundaries in between, then run the workflow engine now (detached), print its command to run later, or build manually. It queues `forge-auto-build` when a PRD was captured (it generates the agent team then executes the build), or `forge-auto-build-prd` when it was not (it produces the reviewed PRD first). Opens Copilot CLI, opencode, or Claude Code in a separate terminal when available, with clear fallback commands if not.
9. **Summary** -prints the repo path, harness, and next steps.

---

## Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| `node` (18+) | For the npm package | Runs the `forge-launcher` package (canonical implementation) |
| `git` | **Yes** | All harnesses |
| `gh` (GitHub CLI) | For GitHub harness | Creates and clones the GitHub repo |
| `opencode` | For opencode harness auto-launch | Spawns the opencode session |
| `claude` | For Claude Code harness auto-launch | Spawns the Claude Code session |
| Bash 4+ | For legacy `forge-launcher.sh` | Linux / macOS |
| PowerShell 5.1+ | For legacy `forge-launcher.ps1` | Windows |

> The launcher is implemented as the cross-platform **`forge-launcher` npm
> package** (see [ADR-023](adr/023-forge-launcher-npm-package.md)). The
> `.sh` / `.ps1` scripts in `scripts/` are thin delegating wrappers kept for
> compatibility and are scheduled for removal.

---

## Usage

### npm package (recommended, cross-platform)

> The npm package is a **pre-release** (`forge-launcher@beta`, v1.0.0-beta.3).
> Until it is published, install it locally from the clone (see the README
> "Try the npm launcher locally" section) or use the legacy wrappers below.

```bash
npx forge-launcher@beta [--non-interactive] [--headless] [--draft] [--dry-run] [--debug]
npx forge-launcher@beta bootstrap [TARGET_DIR] [--harness agents|github|claude|opencode] [--force]
npx forge-launcher@beta engine-run [--repo <path>] [--harness <h>] [--concurrency <n>]
                              [--task-timeout-ms <ms>] [--yes] [--dry-run]
                              [--keep-alive [--keep-alive-port <n>]] [--no-keep-alive] [--attach <url>]
                              [--allow-noop] [--run-validation]
                              [--auto-commit|--no-auto-commit] [--commit-message-template <tmpl>]
npx forge-launcher@beta resume [--repo <path>] [--non-interactive] [--dry-run]
npx forge-launcher@beta console [--repo <path>] [--port <n>] [--no-open]
```

When installed globally (`npm install -g forge-launcher@beta`), drop the `npx`.

#### Install locally before publishing

From the clone, install the packed tarball as a global command, or symlink for
development:

```bash
cd scripts/forge-launcher
npm install                               # build deps
npm pack                                  # build + stage templates → forge-launcher-1.0.0-beta.3.tgz
npm install -g ./forge-launcher-1.0.0-beta.3.tgz   # global `forge-launcher`

# dev alternative (once dist/ is built): global symlink
npm run build && npm link
```

Remove either install with:

```bash
npm uninstall -g forge-launcher            # removes a tarball install (or link)
cd scripts/forge-launcher && npm unlink    # drops the `npm link` symlink
```

**Update check.** On startup, `forge-launcher` checks the npm registry (honoring
your configured registry, e.g. a local Verdaccio) once a day and prints a notice
when a newer version is available - prereleases check the `beta` tag, releases
check `latest`. Disable it with `--no-update-check` or
`FORGE_SKIP_UPDATE_CHECK=1` (also skipped in CI).

### Linux / macOS (legacy script)

```bash
./scripts/forge-launcher.sh
```

### Windows (PowerShell, legacy script)

```powershell
.\scripts\forge-launcher.ps1
```

### Draft (auto-author) mode

The optional **auto-draft** flow generates the PRD and/or the agent team
non-interactively (best answers, every unknown recorded as an Open Question),
stopping at review boundaries before any build execution. Use `--draft` to
pre-answer "yes" to both auto-draft prompts interactively:

```bash
forge-launcher --draft
```

In non-interactive runs, set `FORGE_AUTO_DRAFT=1` instead:

```bash
export FORGE_AUTO_DRAFT="1"
forge-launcher --non-interactive
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
forge-launcher --non-interactive
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

The workflow engine executes **outside** any CLI session: the auto-build
engine path starts it **detached** (`child_process.spawn`, log:
`docs/engine-run.log`) and polls `docs/WORKFLOW-STATE.json` to completion, so
the build survives the session and resumes with `run`. Once the manifest exists
you can also run the engine directly as a standalone process:

```bash
forge-launcher engine-run --harness opencode --yes   # per-task: opencode run --auto
forge-launcher engine-run --harness copilot --yes    # per-task: copilot -p --yolo
```

A `--headless` launcher run can therefore go from idea to finished build without
opening any interactive CLI.

```bash
# Drive the queued skill now (prints and runs the command)
forge-launcher --headless

# Print the exact command without running it (CI / testing)
forge-launcher --headless --dry-run

# PowerShell
.\scripts\forge-launcher.ps1 -Headless
.\scripts\forge-launcher.ps1 -Headless -DryRun
```

What gets queued:

| Repo state | Queued command |
|---|---|
| PRD captured in Step 6 (or a decomposed PRD exists) | `opencode run --auto --dir "<repo>" "/forge-auto-build Use docs/PRD.md as the project PRD. GO [--workflow-engine]"` |
| No PRD captured | `opencode run --auto --dir "<repo>" "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD. After drafting, run a PRD gap check: every major component must have clear acceptance criteria, a defined tech stack, non-functional requirements (performance, security, privacy), and implementation phases; fill any gaps before approving."` |

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

> **Headless skill runs set `FORGE_HEADLESS=1`** for the spawned harness CLI, so
> the forge skills' headless gate fires deterministically (they also detect the
> embedded "headless / auto-proceed" text). Headless `opencode run` calls also
> pass `--dir "<repo>"`: `opencode run` resolves its project directory from its
> **parent process**, not the child's spawn `cwd`, so without `--dir` the skill
> would run in the launcher's own directory (where `docs/IDEA.md` does not
> exist) and its input would be reported missing. If an auto-draft stage finishes
> without its expected artifact (`docs/PRD.md` / the decomposed layout, or
> generated agents), the launcher prints the run-log tail, the repo's `git
> status`, and whether the skill file resolved, then offers (interactive) to
> open the harness CLI to run the skill manually. Use `--debug` /
> `FORGE_LAUNCHER_DEBUG=1` to always see the log tail.

### Resume (pick up where you left off)

Reviews take time. `forge-launcher resume` re-enters an existing project at its
current stage (idea → PRD → team → build) as a full interactive wizard, so you
can walk away at any review boundary and come back later:

```bash
forge-launcher resume [--repo <path>]     # interactive wizard
forge-launcher resume --repo <path> --non-interactive   # print state + next commands
```

It detects what's already drafted, prints where you are (with clickable review
links to `docs/IDEA.md`, `docs/PRD.md`, the agent/skills dirs, and
`docs/WORKFLOW-STATE.json` when a run exists), then offers the right next action:

- Nothing captured yet → capture the idea / open the harness for `forge-auto-build-prd`.
- Idea, no PRD → auto-draft the PRD headlessly, or open the harness to draft it manually.
- PRD, no team → auto-draft the agent team headlessly, or open the harness for `forge-build-agent-team`.
- Team, no manifest → start the engine (`engine-run`), print the command, or open the harness for the orchestrator.
- Manifest + engine state → report the run status (running / paused / complete / failed, task counts, failed tasks, blockers) and offer to **resume the engine run**, tail the logs, or open the harness CLI. A `running` run warns against starting a second one and offers **"Stop the engine after the current task"** (writes `docs/engine-control.json` and SIGTERMs the PID in `docs/engine.pid` - the engine finishes the in-flight task, saves state as `paused`, and exits; resume with `engine-run`). A `complete` run points you at monitoring rather than resuming.

The same "where am I / what's next" checks make the launcher's queued in-harness
command **conditional**: when a team already exists it queues
`/forge-orchestrate-build` (project-orchestrator); when no team exists yet it
keeps queueing `/forge-auto-build` (which generates the team in-chat). Headless
runs keep using `/forge-auto-build` as the terminal fast-path.

### Forge Console (local web UI)

The **Forge Console** is a self-contained, loopback-only web UI that fronts the
launcher and the workflow engine from one browser app:

```bash
forge-launcher console [--repo <path>] [--port <n>] [--no-open]
```

From it you can pick or create a project, advance the pipeline one stage at a
time (draft the PRD → generate the agent team → start the build), and
monitor/control a run (board, tasks, logs, artifacts, timeline; pause/stop/
resume/replay). It is a projection over the same `docs/*` files the terminal
tools write, so the CLI paths stay first-class and interchangeable.

Full reference (views, the Continue pipeline, the project registry, the
`draft-prd`/`draft-team` headless subcommands, and security):
**[docs/forge-console.md](forge-console.md)**.

### Stop here and resume later

After each launcher checkpoint - idea captured, PRD added/drafted, team
generated, execution plan drafted, build configured - the interactive flow asks
**"Stop here and resume later?"** and, when you say yes, prints the resume
command and stops at the "where to pick up" summary:

```
  Stopped. Resume later from anywhere with:
    forge-launcher resume --repo "/home/user/projects/my-cool-app"
```

The repo keeps everything it has so far (committed per stage), so coming back is
just re-running that command. Non-interactive runs skip the prompts.

### Post-team plan & validate step

After the agent team is generated, the launcher runs project-orchestrator (via
`forge-orchestrate-build`, headless) with the prompt-playbook 5a prompt to
produce the **execution plan** in `docs/PROGRESS.md`:

- The monolithic or feature-based 5a prompt is selected from the repo layout
  (`docs/PRD.md` vs. `docs/product-vision.md` + `docs/features/`).
- The plan is committed (`docs: add execution plan`) and the launcher stops for
  review - a "Stop here and resume later?" checkpoint - before offering the
  engine build.
- If the headless run fails or writes no plan document, the launcher prints the
  manual `@project-orchestrator` command (and offers to open the harness CLI)
  instead.

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
    - run the workflow-engine build **now** (detached via
      `forge-launcher engine-run`),
    - **print the engine command** to run later, or
    - launch the CLI for a manual build.

Choosing *run now* or *print the command* opens the **engine configuration**
step - a set of defaults you can press Enter through:

- **Per-task harness** - `opencode` (default), `copilot`, `openai`, `stub`
  (offline testing), or `flowforge-kernel`.
- **Task granularity** - `fine` (default: sub-bullets + oversized-bullet
  splits) or `coarse` (one task per PRD bullet). Choosing a granularity
  recompiles `docs/EXECUTION-MANIFEST.json` at that granularity.
- **Max agents to run in parallel** - `1` (sequential, default) or higher for
  bounded waves (harness-gated via `supportsConcurrency`, see
  [ADR-021](adr/021-parallel-task-dispatch.md)).
- **Per-task timeout (ms)** - default `600000`.
- **Max retries per task** - default `2`.
- **Live Forge Board dashboard** - launch the visualization during the run
  (default on). A port prompt follows (blank = `4299`). The dashboard starts
  when the engine starts - after the manifest is prepared - and its URL is
  printed in `docs/engine-run.log`.

Esc/Ctrl+C keeps the current defaults. The configured values are written into
both the detached run and the printed command, and persisted to
`docs/engine-config.json` so `forge-launcher resume` and monitor commands reuse
them (env vars still win over the persisted file). All options also have
env-var equivalents (`FORGE_ENGINE_HARNESS`, `FORGE_ENGINE_GRANULARITY`,
`FORGE_ENGINE_CONCURRENCY`, `FORGE_ENGINE_TASK_TIMEOUT_MS`,
`FORGE_ENGINE_MAX_RETRIES`, `FORGE_ENGINE_RETRY_DELAY_MS`,
`FORGE_ENGINE_HEARTBEAT_MS`, `FORGE_ENGINE_VIZ`, `FORGE_ENGINE_VIZ_PORT`).

Use `--draft` to pre-answer "yes" to both auto-draft prompts (interactive), or
set `FORGE_AUTO_DRAFT=1` in non-interactive runs. The workflow-engine run later:

```bash
forge-launcher engine-run --repo "<repo-dir>" --harness opencode --yes
forge-launcher engine-run --repo "<repo-dir>" --harness opencode --yes --viz  # live dashboard
forge-launcher engine-run --repo "<repo-dir>" --harness opencode --yes --keep-alive  # one warm server
```

Pass `--viz` (or `--viz-port <n>`) to `forge-launcher engine-run` to launch the
**live Forge Board dashboard** (a kanban of agent name-tag cards flowing through
To Do / In Progress / Done / Failed) alongside the engine run. Add `--no-open`
to skip auto-opening the browser. `FORGE_ENGINE_VIZ=1` and
`FORGE_ENGINE_VIZ_PORT` set the same defaults. To attach the dashboard to an
already-running or detached engine run instead, use
`npm run workflow-engine -- viz --repo "<repo-dir>"`
inside the repo's engine package.

**Cut per-task cold boots with keep-alive.** By default every `opencode run`
task cold-starts its own project instance (config, AGENTS.md, skills, and every
MCP server). The engine now defaults to **adaptive keep-alive**: it boots one
headless `opencode serve` for the run and attaches every task to it when more
than one task remains, and cold-starts a single remaining task (short resumes
don't pay the server boot). Force the behavior with `--keep-alive` /
`FORGE_ENGINE_ATTACH=1`, or `--no-keep-alive` / `FORGE_ENGINE_ATTACH=0`
(`--keep-alive-port <n>` pins the port; each task still gets a fresh, isolated
session). To reuse a server you already keep running, pass `--attach <url>` (or
`FORGE_ENGINE_ATTACH_URL`). See the workflow-engine
[keep-alive attach mode](workflow-engine.md#keep-alive-attach-mode-opencode-harness).

The engine run honours parallel dispatch too: set `FORGE_ENGINE_CONCURRENCY=<n>`
(or pass `--concurrency <n>` to `forge-launcher engine-run`) to run ready tasks in
bounded waves (harness-gated via `supportsConcurrency`, default `1` = sequential;
see [ADR-021](adr/021-parallel-task-dispatch.md)).

**Auto-commit is on by default.** Each completed task is committed to git (one
commit per task, including the engine-owned `docs/*` files). Disable with
`--no-auto-commit` / `FORGE_ENGINE_AUTO_COMMIT=0`, and customise the message
with `--commit-message-template "<tmpl>"` (`{taskId}` / `{taskTitle}`
placeholders). The same setting persists in `docs/engine-config.json`
(`autoCommit`) — the interactive launcher asks about it, the console exposes it
as a checkbox on the Overview, and `resume`/monitor commands honour it. See
[ADR-035](adr/035-auto-commit-after-task.md).

> Auto-draft drives the harness CLI directly, so it needs `opencode` (or
> `copilot` via `FORGE_RUN_WITH=copilot`). It commits each generated artifact so
> your repo stays reviewable at every boundary.
>
> Long-running steps (bootstrap, headless/auto-draft skill runs, GitHub repo
> creation, push) show a spinner in a terminal, so you can tell the launcher is
> working rather than hung. Their output is tee'd to a per-run log
> (`/tmp/forge-launcher-<pid>.log`) and the log tail is printed on failure.
> The spinner is skipped for piped/CI output. The elapsed message honours
> `FORGE_HEARTBEAT_INTERVAL` (default `15` seconds).
>
> Want a quick way to try it? The [testing guide Part 8](testing-guide.md#part-8--launcher-auto-draft-smoke-test-reusable-test-idea)
> ships a copy-paste test idea (a small expense-tracker CLI) that exercises the
> whole auto-draft → decompose → team → engine flow.

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
```

The launcher bundles its own bootstrap logic (the `forge-launcher bootstrap`
module), so there is no separate bootstrap script to check.

### Step 2 -Select harness

In a terminal the harness choice renders as an interactive **menu** (clack
`select`); the layout below shows the options in plain form:

```
▶ Step 2 of 9: Select agent harness

  Which agent harness will this project use?

    1) GitHub Copilot   (harness: github,    dir: .github/)
    2) opencode         (harness: opencode,  dir: .opencode/)
    3) Claude Code      (harness: claude,    dir: .claude/)
    4) Generic .agents  (harness: agents,    dir: .agents/)  [default]
```

Your choice determines:
- The `--harness` flag passed to the bundled bootstrap.
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

Path prompts use a clack autocomplete **path picker** (Tab-complete to
existing file/directory locations), so you can navigate rather than hand-typing
paths. Typed paths also accept shell-style shorthand: `~`/`~/...` and
`$VAR`/`${VAR}` (e.g. `$HOME/projects`) are expanded before the path is
checked.

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

### Step 4 -Bootstrap MyForge

Runs the bundled bootstrap with `--force` into the new repository, copying all
agent and skill templates into the harness directory (shown here with a
spinner in a terminal; output is also tee'd to a per-run log).

```
▶ Step 4 of 9: Bootstrap MyForge
  Running bootstrap → /home/user/projects/my-cool-app (--harness github) …
  ✔  MyForge templates bootstrapped.
```

### Step 5 -Capture your idea

Enter your project idea in the terminal (interactive TUI: press **Enter twice**
on a blank line to finish; piped/CI input uses a blank line). The text is saved
to `docs/IDEA.md` (with a compatibility copy at repo root `IDEA.md`).

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
files and folders (a clack autocomplete path picker when interactive, with a
readline fallback for piped input), plus `~`/`~/...` and `$VAR`/`${VAR}`
(e.g. `$HOME/...`) expansion - so you can point at external PRD or seed
documents with their usual shorthand instead of typing a full absolute path.

If you skip this step, the pipeline queues `forge-auto-build-prd`, which builds a reviewed PRD from `docs/IDEA.md` (including the automatic decomposition check) before the build pipeline runs. For the best results, spend extra time on the PRD or spec first: you can run `/forge-build-prd` as a separate skill, then feed that PRD into the launcher or into `/forge-auto-build` as the initial spec. Adding research or seed documents in `docs/research/` also improves downstream quality.

### Step 7 -Commit bootstrapped forge and idea

```
▶ Step 7 of 9: Commit bootstrapped forge and idea
  ✔  Committed: 'chore: bootstrap MyForge'
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
    opencode run --auto --dir "/home/user/projects/my-cool-app" "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD. After drafting, run a PRD gap check: every major component must have clear acceptance criteria, a defined tech stack, non-functional requirements (performance, security, privacy), and implementation phases; fill any gaps before approving."
  ✔  Committed: 'docs: add auto-drafted PRD'
  ✔  PRD generated.
  Review it before continuing:
    - /home/user/projects/my-cool-app/docs/PRD.md
Generate the agent team from the PRD automatically now (headless)? [y/N]: y
  Auto-drafting the agent team from the PRD (headless) …
    opencode run --auto --dir "/home/user/projects/my-cool-app" "/forge-build-agent-team Use docs/PRD.md to build the agent team. Auto-proceed with default assumptions and no questions."
  ✔  Committed: 'feat: generate auto-drafted agent team'
  ✔  Agent team generated.
  Review the generated team before building:
    - Agents : /home/user/projects/my-cool-app/.agents/agents/
    - Skills : /home/user/projects/my-cool-app/.agents/skills/
  The agent team is ready. You can run the build now through the
  workflow engine, run it later, or build manually.
    1) Run the workflow-engine build now (detached)
    2) Print the engine command to run later
    3) Skip - I will launch the CLI / build manually
Select [1-3] [2]: 2
    npx forge-launcher@beta engine-run --repo "/home/user/projects/my-cool-app" --harness opencode --yes
```

Choosing **1) Run the workflow-engine build now (detached)** starts the engine in the
background and skips the rest of the interactive launch prompt - the build is
already running, so the launcher no longer offers to open a CLI or re-run
`forge-auto-build`:

```
    1) Run the workflow-engine build now (detached)
    2) Print the engine command to run later
    3) Skip - I will launch the CLI / build manually
Select [1-3] [2]: 1
  ✔  Engine started detached. Log: /home/user/projects/my-cool-app/docs/engine-run.log

  The engine runs in the background, even after this launcher exits.
  Monitor progress from another terminal with:
    tail -f /home/user/projects/my-cool-app/docs/engine-run.log
    tail -f /home/user/projects/my-cool-app/docs/PROGRESS.md

  The workflow engine is already running this build in the background.
  Skipping the interactive CLI launch prompt - no need to run forge-auto-build.
```

Then, for harnesses with a spawnable CLI (`copilot`, `opencode`, `claude`):

```
▶ Step 8 of 9: Launch auto-build

  The repository is bootstrapped. The queued command depends on whether a PRD
  was captured in Step 6.

Launch claude in the new repository now? [y/N]: y
  Launching claude in: /home/user/projects/my-cool-app
  ✔  claude launched. Use /forge-auto-build-prd in the Claude Code chat to build
     the reviewed PRD, then the launcher/team step for the agent team and build.
```

For GitHub Copilot, the launcher now tries to open the GitHub Copilot CLI in a separate terminal if `copilot` is installed. If that is not available, it falls back to the manual chat instructions below:

```
  Open the repository in GitHub Copilot Chat and run:

    @workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea

  The skill will build a reviewed PRD from your idea (with automatic
  decomposition when it qualifies), then direct you to team generation and
  build execution.
```

When a PRD **was** captured in Step 6, the queued command is **conditional on
whether the agent team exists**:

```
  # team already generated (auto-draft):
  @workspace /forge-orchestrate-build Use docs/PRD.md as the project PRD
  # no team yet:
  @workspace /forge-auto-build Use docs/PRD.md as the project PRD
```

`/forge-orchestrate-build` (project-orchestrator) drives the interactive build
with per-phase approval. `/forge-auto-build` is the **terminal/headless
fast-path**: it requires the PRD to already exist, generates the agent team,
optionally assigns models, then executes the build - type `GO` at its
pre-flight gate, or `GO --workflow-engine` to run the build through the
workflow engine instead of the prompt-driven orchestrator. On the engine path
the engine starts detached (`docs/engine-run.log`), `forge-auto-build` polls
`docs/WORKFLOW-STATE.json` until the run is `complete` or `failed`, and you can
run or resume it standalone with `forge-launcher engine-run`.

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
  2. Run the queued command (conditional on the agent team):

      @workspace /forge-orchestrate-build Use docs/PRD.md as the project PRD
      # (or, if no team exists yet: /forge-auto-build Use docs/PRD.md as the
      #  project PRD - it generates the team in-chat)

  3. Drive the build interactively (project-orchestrator), or run it
     autonomously with forge-launcher engine-run.
```

When the engine was started in Step 8, the summary's **Next steps** instead
reflect the running build (monitor + resume) rather than the manual
`@workspace /forge-orchestrate-build` path:

```
  Next steps:

  1. The workflow engine is building the project in the background
     (it keeps running after this launcher exits).
  2. Monitor progress from another terminal:

      tail -f /home/user/projects/my-cool-app/docs/engine-run.log
      tail -f /home/user/projects/my-cool-app/docs/PROGRESS.md

  3. Re-run or resume the engine later if needed:

      npx forge-launcher@beta engine-run --repo "/home/user/projects/my-cool-app" --harness opencode --yes
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
| `FORGE_RUN_WITH` | 8 | Headless runner: `opencode`, `copilot`, or `stub` (default: `copilot` for the GitHub harness, `opencode` otherwise). `stub` runs the auto-draft stages offline against canned artifacts - combine with `FORGE_STUB_NOOP=1` to test the failure path |
| `FORGE_STUB_NOOP` | 8 | `1` makes the stub skill runner (`FORGE_RUN_WITH=stub`) write nothing, exercising the auto-draft failure diagnostics |
| `FORGE_LAUNCHER_DEBUG` | 8 | `1` (or the `--debug` flag) prints the skill-run log tail after every headless skill run; also passes `--print-logs` to `opencode` |
 | `FORGE_ENGINE_CONCURRENCY` | 8 | Max ready tasks the workflow engine runs in parallel (default `1` = sequential; harness-gated, see ADR-021) |
 | `FORGE_ENGINE_TASK_TIMEOUT_MS` | 8 | Per-task timeout for the workflow engine in ms (default `600000` / 10 min; a task's manifest `timeoutMs` overrides it, see ADR-022) |
 | `FORGE_ENGINE_GRANULARITY` | 8 | Task granularity for the adapter compile: `fine` (default) or `coarse`. Setting it recompiles the manifest at that granularity |
 | `FORGE_ENGINE_MAX_RETRIES` | 8 | Max retries per engine task (default `2`) |
 | `FORGE_ENGINE_RETRY_DELAY_MS` | 8 | Delay between task retries in ms (default `5000`) |
 | `FORGE_ENGINE_HEARTBEAT_MS` | 8 | Engine heartbeat interval in ms while a task runs (default `60000`; `0` disables) |
 | `FORGE_WORKFLOW_ENGINE` | 8 | `1` to append `GO --workflow-engine` to the queued headless command (build executes via the workflow engine) |
  | `FORGE_ENGINE_HARNESS` | 8 | Per-task harness for the workflow engine: `opencode` (default), `copilot`, `openai`, `stub`, or `flowforge-kernel` |
  | `FORGE_ENGINE_VIZ` | 8 | `1` to launch the live Forge Board dashboard with the engine run |
  | `FORGE_ENGINE_VIZ_PORT` | 8 | Dashboard port when `FORGE_ENGINE_VIZ=1` (default `4299`) |
  | `FORGE_ENGINE_ALLOW_NOOP` | 8 | `1` to relax the engine's output-verification no-op heuristic (`engine-run --allow-noop`) |
  | `FORGE_ENGINE_RUN_VALIDATION` | 8 | `1` to run each task's manifest `validationCommands` before marking it complete (`engine-run --run-validation`) |

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

`forge-auto-build-prd` builds a reviewed PRD from the idea (with automatic decomposition when it qualifies) and stops there. Once `docs/PRD.md` exists, generate the team and build - from the terminal, re-enter at the right stage:

```
forge-launcher resume [--repo <path>]     # picks up at the team/build stage
```

Or in the harness, generate the team first, then drive the build interactively
or autonomously:

```
@workspace /forge-build-agent-team Use docs/PRD.md to build the agent team
@workspace @project-orchestrator Execute the full build      # interactive
@workspace @workflow-orchestrator Run the workflow           # autonomous
```

`forge-auto-build` remains available as the **terminal/headless fast-path** -
the launcher's `--headless` / auto-draft drives it via `opencode run --auto`
(queued as `/forge-auto-build Use docs/PRD.md as the project PRD. GO
[--workflow-engine]`). It requires a PRD representation to exist and never
generates one.

---

## Troubleshooting

### "bootstrap.sh not found or not executable"

The launcher no longer shells out to a `bootstrap.sh` - bootstrap logic is
bundled in the package (`forge-launcher bootstrap`), so this error should not
occur. If you are running the package from a source checkout, make sure the
package dependencies are installed first (`npm install` in
`scripts/forge-launcher/`).

### "gh not found" on GitHub harness

Install the GitHub CLI: <https://cli.github.com/>. Authenticate with `gh auth login` before running the launcher.

### The launcher created the repo but bootstrap failed

The repository directory was created before bootstrap ran. You can re-run bootstrap manually:

```bash
forge-launcher bootstrap /path/to/your/repo --harness <harness>
# or the legacy wrapper:
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

See [ADR-010: Forge Launcher](adr/010-forge-launcher.md) for the original
rationale (now **superseded** for the implementation layer by
[ADR-023](adr/023-forge-launcher-npm-package.md): the launcher is a Node npm
package with a clack TUI rather than dual shell scripts). The flow-level
decisions still stand - harness selection is step 2, `IDEA.md` is the hand-off
artifact, and bootstrap is delegated rather than reimplemented.
