# Forge Console

> A local web UI that fronts `forge-launcher` (authoring) and `forge-launcher engine-run` → `workflow-engine` (build). Create a project, draft the PRD and agent team, run the build, and monitor/control it - all from your browser.

> **Screenshots:** see the [Visual Tour](forge-console-screenshots.md) for a walkthrough of every view.

---

## Overview

The Forge Console is a self-contained, loopback-only web app served by
`forge-launcher console`. It is a **projection layer** over the same files the
terminal tools already write (`docs/WORKFLOW-STATE.json`, `EXECUTION-AUDIT.jsonl`,
`engine-run.log`, `engine-control.json`, `engine.pid`, `docs/artifacts/`, …) and
a thin supervisor over the launcher and engine processes. It does not reimplement
authoring or execution - the terminal commands remain first-class and produce
identical results.

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
   time - draft the PRD, generate the agent team, then start the build.
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
**Home** view lists recent projects (most-recent-first) and offers two actions:

- **Create a new project** - the New Project wizard collects a name, harness,
  visibility, parent directory, and idea, then spawns
  `forge-launcher --non-interactive` in the background (optionally
  auto-drafting the PRD).
- **Open an existing project** - a dropdown of your projects plus an
  "Add folder" input for a forge repo you have on disk but haven't opened yet.

The **Projects** tab has the same dropdown + add-folder flow.

---

## The pipeline (the Continue button)

Projects flow through four stages. The **Continue** button on the Overview
advances one stage at a time, running the same steps the terminal launcher runs,
so you can review each result and come back later:

| Stage | Continue does | Produces |
|---|---|---|
| Idea (no PRD) | **Draft PRD** (headless `forge-auto-build-prd`) | `docs/PRD.md` (or `product-vision.md` + `features/`) |
| PRD (no team) | **Generate team** (headless `forge-build-agent-team`) | agent + skill files under the harness root |
| Team (no run) | **Start build** (`forge-launcher engine-run`) | compiles the manifest, then runs the engine |
| Paused/incomplete run | **Resume build** | engine resumes from `WORKFLOW-STATE.json` |

Each step runs detached in the background (output is appended to
`docs/engine-run.log`, visible in the **Logs** view); the Overview polls until
the stage advances and updates the button label. Nothing runs until you click it,
and the generated PRD/team are **view-only** in the console - review them in
**Plan & Team** and edit them in your editor.

The terminal counterparts are the new `draft-prd` / `draft-team` subcommands:

```bash
forge-launcher draft-prd  --repo <path>   # idea → PRD (headless)
forge-launcher draft-team --repo <path>   # PRD → agent team (headless)
```

They honor `FORGE_RUN_WITH` (`opencode`/`copilot`/`stub`) and derive the runner
from the project's harness (`github` → copilot, otherwise opencode).

---

## Views

| View | What it shows |
|---|---|
| **Home** | create a new project or open an existing one (landing). |
| **Overview** | run status, progress + counts, blockers, the pipeline **Continue** button, and run controls. |
| **Board** | the PixiJS Forge Board - a live kanban (To Do · In Progress · Done · Failed). |
| **Tasks** | every task in a filterable/sortable table with a detail drawer (including an editable per-task timeout). |
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
