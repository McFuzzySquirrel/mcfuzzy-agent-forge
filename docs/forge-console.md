# Forge Console

> A local web UI that fronts `forge-launcher` (authoring) and `forge-launcher engine-run` → `workflow-engine` (build). Create a project, author a reviewed PRD interactively, generate the agent team, generate project skills, compile the manifest, and monitor/control the build - all from your browser.

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
   time - open interactive PRD authoring, generate the agent team, generate
   project skills, compile the manifest, then start the build.
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
  `forge-launcher --non-interactive` in the background. That run bootstraps and
  stops with the interactive PRD handoff; it never authors requirements
  (ADR-060). It also lets you **add an existing PRD and
  research/seed documents** (see *Adding a PRD and research/seed documents*
  below), mirroring the CLI's Step 6.
- **Open an existing project** - a table of your projects plus an
  "Add folder" input for a forge repo you have on disk but haven't opened yet.
- **Bootstrap an existing repo** - copies MyForge into an existing application
  repository. Existing files are preserved unless overwrite is explicitly
  selected. A non-Git folder requires the explicit **Initialize git if needed**
  option.

The **Projects** tab shows project name, state, and last accessed date/time,
without filesystem paths in the list. Use a row's **Open** action to switch
projects. Individual selection checkboxes and the header select-all checkbox
occupy the same column.

### Remove from Forge

Use a row's **Remove from Forge** action, or check projects and choose
**Remove selected (N)**. Review the selected rows and confirm the operation.
**No files inside project folders will be changed or deleted.**

Removal deletes the selected projects' registry entries and associated Console
job history, plus only verified Forge-owned job-result receipts outside project
repositories. It does not uninstall Forge or remove source code, Git data,
documentation, configuration, agents, skills, logs, or generated artifacts from
a repository. Shared Forge settings and other projects' data are preserved.

Each selected project receives its own **removed**, **blocked**, or **failed**
result; one blocked or failed project does not stop the rest. Unfinished
(running or paused) Console jobs with a live process, or a live engine PID,
block removal; no processes are terminated. Completed and failed jobs never
block, because the operating system may have reused their old PIDs for
unrelated programs. A running job without a verifiable PID also blocks removal
rather than guessing. Wait for work to finish before retrying. Corrupt
registry/history or unsafe storage locations produce failures rather than
discarding data.

Registry records with legacy relative paths (for example `.` from an older
`forge-launcher console --repo .`) do not block removal of other projects and
are kept as-is. They appear in the list and can be removed themselves; because
their real location is unknown, they match only their exact recorded text and
are never resolved against the Console's working directory. New registry
entries are always stored as absolute paths.

Missing project folders can still be removed. Removing the current project
clears the Console selection. To return later, use **Add folder** with the
existing folder; no new bootstrap is needed and repository history remains
intact.

The token-gated `POST /api/projects/remove` accepts `{ "paths": ["<registered
project path>"] }` (the path exactly as listed by `GET /api/projects`) and
returns `{ "results": [{ "path": "...", "name": "...",
"status": "removed|blocked|failed", "message": "..." }], "current": null }`
(`current` remains the selected path when it was not removed). Mixed outcomes
use HTTP 200; invalid request shapes use HTTP 400.

Receipts must match the Console's `job-results/<job-id>.json` location and
contain a matching terminal job ID. Linked, shared, missing, or unverified
receipts are left untouched and reported. If cleanup or persistence fails,
registration is retained and the failure is reported; already deleted verified
external receipts cannot be restored. Storage inside a project (including
through a filesystem link) is refused instead of breaking the repository
preservation guarantee.

---

## The pipeline (the Continue button)

Projects flow through five stages. The **Continue** button on the Overview
advances one stage at a time, running the same steps the terminal launcher runs,
so you can review each result and come back later:

| Stage | Continue does | Produces |
|---|---|---|
| Idea (no PRD) | **Author PRD (interactive)** opens `forge-auto-build-prd` in a terminal; there is no headless alternative (ADR-060). **Grill the idea first** runs `forge-grill-idea` the same way | `docs/PRD.md` + `docs/features/*.md` |
| PRD (no team) | **Generate team** (headless `forge-build-agent-team`) | agent files and ownership metadata |
| Team (skills incomplete) | **Generate project skills** | project skill candidates and review result |
| Skills ready (no manifest) | **Compile manifest** (`forge-execution-adapter`) | `docs/EXECUTION-MANIFEST.json` |
| Manifest ready | **Start build** (`forge-launcher engine-run`) | durable workflow-engine run |
| Paused/incomplete run | **Resume build** | engine resumes from `WORKFLOW-STATE.json` |

The derivation steps run detached in the background (output is appended to
`docs/engine-run.log`, visible in the **Logs** view). This includes bootstrap,
team, skills, manifest-authoring jobs, and engine output. The console now tracks
those detached jobs directly, so the Overview can show whether work is actively
creating the project, generating the team, running the build, paused, complete,
or failed. Nothing runs until you click it, and the generated team and skills are
**view-only** in the console - review them in **Plan & Team** and edit them in
your editor.

Requirements stages are different: the PRD and feature documents are authored in
an interactive terminal session, not a background job. The Console therefore
cannot pause, cancel, or report on them, and completion is observed from the
repository after the skill commits.

Completed projects remain extensible. Use **Add a feature** on Overview to run
`forge-build-feature-prd`. The skill inspects the existing codebase, PRD, and
agent team and writes an additive document under `docs/features/`; it does not
replace the original PRD or start the engine. It interviews you, because a
feature document is requirements and requirements are never authored headlessly
(ADR-060). After authoring, choose **Continue after authoring** to update affected
agents and recompile the manifest; review the resulting tasks before running them.

### Interactive authoring

The **Overview** pipeline card leads with the interactive interview that the
pre-Console workflow was built around; these actions live only there. The primary
PRD and Feature PRD actions open your configured authoring runner in a new
terminal with the skill already queued, so the skill asks its clarifying
questions before drafting. Backed by `POST /api/authoring/session`, which
resolves the authoring runner and the PRD-stage model and falls back to printing
the manual command when no desktop terminal is available. This is the only way to
author requirements: the `draft-prd`, `draft-existing-prd`, and `feature-prd`
control actions report this handoff instead of starting a job.

- **Grill the idea first (interactive)** runs the `forge-grill-idea` skill,
  which interviews you in rounds to sharpen `docs/IDEA.md` before PRD authoring,
  then rewrites and commits it.
- **Author PRD (interactive)** runs `forge-auto-build-prd` (or
  `forge-build-prd` for an existing repository) with the interview enabled.
- **Validate PRD** runs the read-only `validate-prd` check and reports the
  result, for documents authored outside the Console. It appears on the pipeline
  card once a PRD exists.

Interactive sessions run outside the Console, so they are not tracked background
jobs: the skill validates and commits its own output, and the Console picks the
result up from the repository. Use **Refresh** on the pipeline card, or reopen
the view, to see newly authored documents.

The terminal counterparts of the headless derivation stages are the
`draft-team` / `draft-skills` / `compile-manifest` subcommands:

```bash
forge-launcher draft-team --repo <path>   # PRD → agent team (headless)
forge-launcher draft-skills --repo <path> # skill candidates → project skills (headless)
```

`draft-prd` and `draft-existing-prd` still exist but no longer author; they print
the interactive handoff (ADR-060).

They honor the `--runner` flag (`opencode`/`copilot`/`claude`/`inherit`) first,
then `FORGE_RUN_WITH` (the same values plus `stub`), then the `runner` saved in
`docs/authoring-config.json`, and otherwise derive the runner from the project's
harness (`github` → copilot, otherwise opencode). The one exception to that
order is `FORGE_RUN_WITH=stub`: it is an offline lock, so `--runner` cannot
override it and an offline run never spawns a real runner.

---

## Re-deriving the team and skills

Editing a PRD or feature document makes the agent team and the project skills
stale. The Console names the cause and runs the fix.

**Why it is stale.** Each authoring stage records the fingerprint of its inputs
and when it completed. When those no longer match, the Console compares each
input file's modification time against the stage's completion time and reports
the file — "*Inputs changed after this stage completed: docs/PRD.md*", *changed 3h
ago*. A stage whose generated output was deleted, or edited after completion, is
reported as such instead. The same detail appears on **Overview** and in
**Plan & Team → authoring settings**, and each stale stage links straight to its
card (`#/documents?stage=team`).

**Running the chain.** **Re-derive team & skills** runs the whole tail as one
background job:

1. regenerate the agent team from the PRD,
2. regenerate the project skills from the new team,
3. recompile the execution manifest.

Progress is shown per step and is persisted to `docs/rederive-state.json`, so
reloading the page mid-run resumes the step machine rather than losing it. A
failure stops the chain, names the step, and offers **Retry from \<step\>** — which
re-runs that step and everything after it, because a regenerated team
invalidates the skills and manifest derived from the previous one.

Two deliberate limits:

- **The chain never authors requirements.** ADR-060 makes requirements authoring
  interactive, so it starts at the team and refuses to run without a committed
  `docs/PRD.md` plus `docs/features/*.md`, pointing you at the interactive
  session instead.
- **The chain never resets completed tasks.** That discards their recorded
  outputs and artifacts, so it stays a separate, confirmed action (below).

The same CLI chain is available directly:

```bash
forge-launcher rederive --repo <path> [--from team|skills|manifest]
```

---

## Resetting changed tasks for review

Stable task IDs preserve completed work across a recompile. When a task's
*contract* changed, its record is stale and it must run again. **Reset changed
tasks for review** lives in the Overview **Manifest** panel, beside the
reconciliation data it acts on: it lists the changed and new task IDs, each
linking into **Tasks**, and the reset is behind a confirmation naming every task
it will discard. It clears those tasks' status, timings, outputs and artifacts,
setting them back to pending.

The Overview **Controls** panel points here rather than duplicating the button.

---

## The Forge Board

The Board is the engine's PixiJS dashboard, framed inside the Console. It has
two modes, chosen above the frame and remembered per project.

**Kanban** is the original board: one band per phase, four status columns, task
cards flowing left to right.

**Gantt** plots the same run against time on its dependencies:

- **Filled bars are measured; outlined, hatched bars are forecast.** A forecast
  is an inference from observed durations, and the tooltip names its source — the
  task's own attempts, the same agent's other tasks, or a default.
- **Bars respect the engine's own dispatch rule** (direct dependencies plus every
  task of a depended-on phase) and the configured concurrency, so the forecast
  never promises a sequence the engine will not run.
- **Phase rollups** span each phase; **human-review tasks** appear as milestone
  diamonds, since a review is a decision rather than a duration.
- **The critical path** is highlighted: the longest chain of remaining work.
- **A "now" line** advances continuously; the axis follows your local clock.

Filters dim tasks rather than hiding them, so the shape of the build stays
visible. **Table** renders the same data as a real table for keyboard and
screen-reader use. Hovering a card or bar offers **Open in Tasks**, **Logs** and
**Artifacts**, so the board is not a dead end. Failures stay listed in the lower
left with a link into Tasks, rather than only flashing once.

The Board is still available standalone via `workflow-engine run --viz`, where
it keeps its own mode switch and Table toggle.

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
| **Overview** | run status, progress + counts, blockers, the pipeline next-step card with a **Manual build** checkbox, background-job status, run controls, an **auto-commit** toggle, a **Log harness activity** toggle, and a **Launch \<harness\> CLI** button. Also the **Re-derive team & skills** panel when authoring is stale, and manifest reconciliation with a confirmed **Reset changed tasks for review**. |
| **Board** | the PixiJS Forge Board in **Kanban** or **Gantt** mode, with status filters and a **Table** view of the same data. |
| **Tasks** | every task in a filterable/sortable table with a detail drawer, editable per-task timeout, explicit/range selection controls for manual mode, and a **Launch \<harness\> CLI** button. |
| **Logs** | `docs/engine-run.log` tail + the audit event stream (live via SSE). |
| **Plan & Team** | authoring settings and stage cards — always actionable, each stating why it is stale — plus the project documents (IDEA, PRD, features, progress, model plan) as a table that opens a document in a wide popup, and agents and skills in collapsible card sections. Requirement and task blocks render as tables. |
| **Artifacts** | the structured outputs tasks produced (`docs/artifacts/`), browsable by type/task with previews. |
| **Timeline** | chronological audit events, failures highlighted. |
| **Projects** | switch projects, add a folder, or remove one or more projects from Forge. |

A **Help** button (top-right) explains the UI, the pipeline, each view, and key
terms.

For human-review tasks, **Complete human review** lists unverified checks from
all upstream task and prerequisite-phase dependencies, including transitive
ones. Exercise the required journey and applicable live checks before approving,
and record what you checked and found in at least 40 characters after trimming.
These reported gaps are advisory, not proof of validation; see the
[human-review walkthrough](forge-console-user-guide.md#human-review-when-it-pauses-and-how-to-prove-approval).

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

The **Log harness activity** checkbox (Controls panel) toggles
`logHarnessActivity` in `docs/engine-config.json`. It defaults to **off** and
applies to subsequently started runs; the Console's run/resume command passes it
to the engine as `--log-harness-activity` or `--no-log-harness-activity`, so it
takes precedence over `FORGE_ENGINE_LOG_HARNESS_ACTIVITY`. When enabled, harness
CLI stdout/stderr streams into `docs/engine-run.log` and appears live in the
**Logs** view. It can contain sensitive repository content and increase log
volume; command invocation logging is always on regardless of this setting (see
[workflow-engine.md](workflow-engine.md#harness-invocation-and-activity-logging)
and [ADR-052](adr/052-harness-invocation-activity-logging.md)).

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
