# Forge Console

> A local web UI that fronts `forge-launcher` (authoring) and `forge-launcher engine-run` → `workflow-engine` (build). Create a project, draft the PRD, generate the agent team, generate project skills, compile the manifest, and monitor/control the build - all from your browser.

> [!WARNING]
> The Visual Tour uses current-browser captures from a deterministic local
> fixture. Desktop and responsive media were collected from the current
> Console build; screenshots are evidence of layout and fixture state, not a
> substitute for interactive accessibility testing.

> **Screenshots:** see the [Visual Tour](forge-console-screenshots.md) for a walkthrough of every view.
>
> **Getting started:** follow the [Forge Console user guide](forge-console-user-guide.md) for a step-by-step walkthrough from startup to project switching and build monitoring.

---

## Overview

The Forge Console is a self-contained, loopback-only web app served by
`forge-launcher console`. It is a **projection layer** over the same files the
terminal tools already write (`docs/WORKFLOW-STATE.json`, `EXECUTION-AUDIT.jsonl`,
`engine-run.log`, `engine-control.json`, `engine.pid`, `docs/artifacts/`, …) and
a thin supervisor over the launcher and engine processes. It does not reimplement
authoring or execution - the terminal commands remain first-class and produce
identical results.

For a compiled project, Console build and team operations use the manifest's
`harnessRoot` before automatic discovery. An explicit authoring CLI selection
still takes priority. If the recorded root is stale, update the selection and
recompile the manifest; Console will not silently switch to another harness
root.

It is TypeScript, compiled with `tsc` (no framework or bundler), and embeds the
existing PixiJS **Forge Board** as one of its views.

---

## Quick start

```bash
forge-launcher console                  # opens the project picker in your browser
forge-launcher console --repo my-app    # opens a specific project directly
```

The server prints a `http://127.0.0.1:4300` URL and opens your default browser.
From there:

1. **Create a project** (New Project wizard) or **open an existing one**.
2. On the **Overview**, click **Continue** to advance the pipeline one stage at a
   time - draft the PRD, generate the agent team, generate project skills,
   compile the manifest, then start the build.
3. Watch it live on the **Board** / **Tasks** / **Logs** views, and use
   **Pause / Stop / Resume / Replay** to control a running build.

---

## Usage

```bash
forge-launcher console [--repo <path>] [--port <n>] [--no-open]
```

| Flag | Default | Purpose |
|------|---------|---------|
| `--repo <path>` | *(none)* | Open this forge repo. Omit to show the project picker. |
| `--port <n>` | `4300` | Preferred port; the next free port is used when busy. |
| `--no-open` | `false` | Do not auto-open the browser. |

Run it from anywhere (`npx forge-launcher@beta console …` before the npm package
is published). It requires Node 18+ and, for authoring steps, the harness CLI the
project was created with (`opencode` or `copilot`) - see
[Prerequisites](forge-launcher.md#prerequisites).

---

## Project picker & registry

Projects you create or open are remembered in a registry at
`~/.myforge/projects.json` (honors `FORGE_HOME`, then `XDG_CONFIG_HOME`). The
**Home** view lists recent projects (most-recent-first) and offers three actions:

- **Create a new project** - the New Project wizard collects a name, harness,
  visibility, parent directory, and idea, then spawns
  `forge-launcher --non-interactive` in the background (optionally
  auto-drafting the PRD). It also lets you **add an existing PRD and
  research/seed documents** (see *Adding a PRD and research/seed documents*
  below), mirroring the CLI's Step 6.
- **Open an existing project** - a dropdown of your projects plus an
  "Add folder" input for a forge repo you have on disk but haven't opened yet.
- **Bootstrap an existing repo** - copies MyForge into an existing application
  repository. Existing files are preserved unless overwrite is explicitly
  selected. A non-Git folder requires the explicit **Initialize git if needed**
  option.

The **Projects** tab has the same dropdown + add-folder flow.

---

## The pipeline (the Continue button)

Projects flow through five stages. The **Continue** button on the Overview
advances one stage at a time, running the same steps the terminal launcher runs,
so you can review each result and come back later:

| Stage | Continue does | Produces |
|---|---|---|
| Idea (no PRD) | **Draft PRD** (headless `forge-auto-build-prd`) | `docs/PRD.md` (or `product-vision.md` + `features/`) |
| PRD (no team) | **Generate team** (headless `forge-build-agent-team`) | agent files and ownership metadata |
| Team (skills incomplete) | **Generate project skills** | project skill candidates and review result |
| Skills ready (no manifest) | **Compile manifest** (`forge-execution-adapter`) | `docs/EXECUTION-MANIFEST.json` |
| Manifest ready | **Start build** (`forge-launcher engine-run`) | durable workflow-engine run |
| Paused/incomplete run | **Resume build** | engine resumes from `WORKFLOW-STATE.json` |

Each step runs detached in the background (output is appended to
`docs/engine-run.log`, visible in the **Logs** view). This includes bootstrap, PRD, team, skills, manifest-authoring jobs, and engine
output. The console now tracks
those detached jobs directly, so the Overview can show whether work is actively
creating the project, drafting the PRD, generating the team, running the build,
paused, complete, or failed. Nothing runs until you click it, and the generated
PRD/team are **view-only** in the console - review them in **Plan & Team** and
edit them in your editor.

Completed projects remain extensible. Use **Add a feature** on Overview to run
`forge-build-feature-prd`. The skill inspects the existing codebase, PRD, and
agent team and writes an additive document under `docs/features/`; it does not
replace the original PRD or start the engine.

The terminal counterparts are the new `draft-prd` / `draft-team` subcommands:

```bash
forge-launcher draft-prd  --repo <path>   # idea → PRD (headless)
forge-launcher draft-team --repo <path>   # PRD → agent team (headless)
```

They honor `FORGE_RUN_WITH` (`opencode`/`copilot`/`stub`) and derive the runner
from the project's harness (`github` → copilot, otherwise opencode).

---

## Adding a PRD and research/seed documents

The **New Project wizard** mirrors the CLI's Step 6 (`addPrdAndResearch`): after
you enter the idea, a **Project documents** section lets you supply an existing
PRD and research/seed documents (design specs, market research, technical
notes). Both fields accept either a **file-picker browse** or a **typed absolute
path** (comma-separated for multiple research docs):

- **Existing PRD** → copied to `docs/PRD.md` and used as-is, instead of the
  pipeline drafting one from the idea.
- **Research / seed documents** → copied to `docs/research/`, where the later
  PRD build (`forge-auto-build-prd`) reads them as extra context.

Picked files are uploaded to the server (`POST /api/uploads`, staged under the
OS temp dir) and the launcher is handed the paths via `FORGE_PRD_FILE` /
`FORGE_RESEARCH_FILES` — exactly the same env vars the terminal CLI uses.
After creation, research docs are listed in **Plan & Team** (kind `research`)
alongside the other project documents.

---

## Launching the harness CLI

A **Launch \<harness\> CLI** button on the **Tasks** view header and the
**Overview** header opens the project's harness CLI in a new terminal window,
working from the project folder — so you can watch the live run and take over
at any point. The CLI is chosen from the repo's harness root (`github` →
`copilot`, `claude` → `claude`, otherwise `opencode`). Backed by
`POST /api/launch-cli`; when no desktop terminal emulator is available, the
button shows the exact command to run manually.

---

## Views

| View | What it shows |
|---|---|
| **Home** | create a new project or open an existing one (landing), including live status labels for detached work. |
| **Overview** | run status, progress + counts, blockers, the pipeline next-step card with a **Manual build** checkbox, background-job status, run controls, an **auto-commit** toggle, and a **Launch \<harness\> CLI** button. |
| **Board** | the PixiJS Forge Board - a live kanban (To Do · In Progress · Done · Failed). |
| **Tasks** | every task in a filterable/sortable table with a detail drawer, editable per-task timeout, explicit/range selection controls for manual mode, and a **Launch \<harness\> CLI** button. |
| **Logs** | `docs/engine-run.log` tail + the audit event stream (live via SSE). |
| **Plan & Team** | the project documents (IDEA, PRD, vision, features, progress, model plan) + agents and skills, in collapsible sections. |
| **Artifacts** | the structured outputs tasks produced (`docs/artifacts/`), browsable by type/task with previews. |
| **Timeline** | chronological audit events, failures highlighted. |
| **Projects** | switch projects or add a folder. |

A **Help** button (top-right) explains the UI, the pipeline, each view, and key
terms.

---

## Run controls

The Overview's **Controls** panel drives a running build the same way the CLI
does:

| Action | Equivalent |
|---|---|
| **Pause** | writes `docs/engine-control.json` (`request: pause`); the engine stops after the current task. |
| **Stop** | writes `request: stop` **and** SIGTERMs `docs/engine.pid`. |
| **Resume** | `forge-launcher engine-run --repo <path> …` (resumes from `WORKFLOW-STATE.json`). |
| **Replay** | `workflow-engine replay <task-id> --repo <path>` for a failed task. |
| **Create manifest** *(pipeline card, manual pre-build only)* | `forge-launcher compile-manifest --repo <path>` (installs the adapter if needed and writes `docs/EXECUTION-MANIFEST.json` without starting the engine). |

### Execution mode

The Overview pipeline card now exposes just one pre-build gate: a **Manual build**
checkbox. Turn it on when you want to prevent the team → build step from
immediately running the full workflow.

When **Manual build** is enabled and the repo has a generated team but no
manifest yet, the pipeline action changes from **Start build** to **Create
manifest**. That compiles `docs/EXECUTION-MANIFEST.json` without starting the
engine, so task selection can happen only after the manifest exists.

Once the manifest exists, the Overview **Controls** panel persists how the next
run should behave:

- **Auto** - the engine runs the full ready workflow.
- **Manual** - the engine runs only the selected task set saved from the
  **Tasks** view. The primary button text changes to **Run selected** /
  **Resume selected**.

Manual selections are stored in `docs/engine-config.json` with the run mode, the
selection scope (`single`, `range`, or `list`), and the selected task IDs. The
engine expands dependencies automatically when a selected task needs them, so
targeted runs still obey the DAG and phase ordering.

The **Auto-commit after each task** checkbox (Controls panel) toggles
`autoCommit` in `docs/engine-config.json`, which the console's run/resume
command passes to the engine. It defaults to **on** (see
[ADR-035](adr/035-auto-commit-after-task.md)); the engine commits one commit per
completed task. Disable it if the working tree is dirty and you don't want agent
output mixed with your uncommitted changes.

### Task timeouts

The Console can edit timeouts without leaving the browser, so a task that
outruns its budget (a slow build or test) can be retried with a larger one:

- **Per task** - open a task's detail drawer in **Tasks** (or use the task picker
  in the Overview **Controls** panel) and set its timeout, then **Replay** it.
- **All tasks** - the Tasks view header and the Overview Controls panel both have
  a "set all" control that gives every task the same timeout.

Storage and precedence (same as the CLI):

- A per-task value is written as `timeoutMs` on that task in
  `docs/EXECUTION-MANIFEST.json`, and overrides the engine default.
- The "set all" action writes `timeoutMs` to every manifest task **and** updates
  `taskTimeoutMs` in `docs/engine-config.json` (the engine-wide default).

> **Note:** `replay` and `run`/`resume` preserve these edits, *except* that
> `run`/`resume` recompiles the manifest from the PRD when a granularity is
> explicitly set - which regenerates `timeoutMs`. The engine-config default is
> always preserved.

### Background job tracking

Detached console actions now share one background-job model:

- project creation
- PRD drafting
- team generation
- engine run / resume
- replay of a failed task

Each job records its PID, repo path, log path, timestamps, status, and latest
message. The console derives completion from the process plus repo/run state, so
job status keeps updating even if you switch between **Home**, **Projects**, and
**Overview**.

---

## Security

- The server binds to **`127.0.0.1` only** (loopback) - it is never exposed to
  the network.
- All `POST` endpoints require an **`X-Forge-Token`** header holding a
  per-server random token embedded in the served page, so cross-origin web pages
  cannot trigger actions.
- File reads are confined to `docs/`, the harness `agents/`/`skills/` dirs, and
  `docs/artifacts/` with path-traversal guards.
- "Open externally" (`POST /api/open`) only opens a whitelisted path in the
  current repo.

---

## Relationship to the CLI

The console does not replace `forge-launcher`, `forge-launcher engine-run`, or
`workflow-engine`. It is a convenience front end over them:

- The terminal is still the canonical path for scripting, CI, and headless runs.
- A run started from the terminal is visible in the console (and vice versa),
  because both read the same `docs/*` artifacts.
- The Forge Board is still available standalone via `workflow-engine run --viz`
  (see [workflow-engine](workflow-engine.md)).

See [ADR-034](adr/034-forge-console-web-ui.md) for the design decisions
(web-first, tsc-only client, iframe board embed, registry, CSRF guard).
