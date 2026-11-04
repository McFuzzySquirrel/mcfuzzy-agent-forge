# Forge Console

> A local web UI that fronts `forge-launcher` (authoring) and `forge-launcher engine-run` → `workflow-engine` (build). Create a project, author a reviewed PRD interactively, run supported harness CLIs in a browser terminal, generate the agent team, generate project skills, compile the manifest, and monitor/control the build.

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

It is TypeScript, compiled with `tsc` (no framework or bundler). The Console
Board uses semantic HTML/CSS; PixiJS is not required to use it.

---

## Quick start

```bash
forge-launcher console                  # opens the project picker in your browser
forge-launcher console --repo my-app    # opens a specific project directly
```

The server prints a `http://127.0.0.1:4300` URL and opens your default browser.
From there:

1. **Create a project** (New Project wizard) or **open an existing one**.
2. On **Build status**, follow the guided Project lifecycle: author the Idea
   and Project brief interactively, review and approve the brief to authorize
   preparation, then review the prepared plan and choose **Start build**
   explicitly. Existing Projects show their next stage-appropriate action.
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
**Home** view emphasizes **Start with an idea** as its primary action. Recent
Projects and existing-application setup remain available as secondary choices.

- **Start with an idea** - begin with an Idea, an editable suggested Project
  name, and an **AI coding tool**. The configured default is selected when
  available; without one, choose explicitly. Technical settings and optional
  PRD/research source documents stay under **Advanced setup**. The Console
  creates the workspace, then guides the user through interactive Idea
  exploration and Project-brief authoring before presenting the brief for
  review. Requirements are never authored headlessly (ADR-060).
- **Open a Project** - a table of your projects plus an
  "Add folder" input for a forge repo you have on disk but haven't opened yet.
- **Set up an app** - copies MyForge into an existing application
  repository. Existing files are preserved unless overwrite is explicitly
  selected. A non-Git folder requires the explicit **Initialize git if needed**
  option.

The global **Projects** destination shows project name, state, and last accessed date/time,
without filesystem paths in the list. Use a row's **Open** action to switch
projects. Opening follows the Project's current lifecycle: new and partially
authored Projects open at interactive authoring, Projects needing review open at
the brief review, preparation and ready-to-start Projects return to their
guided progress or prepared plan, and active, blocked, or failed Projects open
Build status. Completed Projects open **Project files**. Existing
repositories enter the same lifecycle at the state their files and run history
indicate; they are not assigned a separate "existing" state.
The persistent Project switcher in the context bar uses the same destination
rule: completed Projects open **Project files**, while other states open Build
status at their next meaningful action.

Build status names the exact action blocking a Project. A blocker that does
not stop other work is shown while the Project remains **Running**. A failed
Project identifies the failed stage and offers recovery for that stage; Build
recovery links to failed Tasks and Logs and keeps completed work and history.
An unavailable Project stays listed with **Reconnect** and recovery guidance.
Reconnect retries its saved location; if the folder moved, add its current
folder without removing the old registration or its recorded history.

**Add a feature** remains on an existing Project's Build status. Feature
requirements are authored interactively; after the generated Tasks are
available, review their descriptions and acceptance criteria in **Tasks** and
confirm that review before starting or resuming execution. This review gate
does not reset existing Tasks or change the workflow engine's approval rules.

Individual selection checkboxes and the header select-all checkbox occupy the
same column.

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

## The existing pipeline (the Continue button)

New Projects use interactive Idea and Project-brief authoring, followed by an
editable review checkpoint. **Request changes** returns to interactive brief
authoring; the separate **Approve** action authorizes preparation only. After
the prepared plan is ready, the user explicitly chooses **Start build**.
Projects outside that guided path retain the **Continue** actions on Build status,
which advance their existing downstream stages one at a time:

| Stage | Continue does | Produces |
|---|---|---|
| New Project | **Explore your Idea** opens `forge-grill-idea`, then **Author your Project brief** opens `forge-build-prd`; both are interactive and resumable, and source documents do not skip either phase | `docs/IDEA.md`, then `docs/PRD.md` + `docs/features/*.md` |
| Project brief review | Edit the brief and at-a-glance summary; **Request changes** reopens interactive authoring, while **Approve** validates the brief and authorizes preparation only | Reviewed `docs/PRD.md`; no Build execution |
| Approved Project brief | Prepare the team, project guidance, and Build plan in one guided background step; progress and failures remain actionable in Build status | agent files, project skills, and `docs/EXECUTION-MANIFEST.json`; no Build execution |
| Prepared plan | Review major phases, assumptions, and warnings, then choose **Start build** explicitly | durable workflow-engine run |
| Existing Project (no brief) | **Author PRD (interactive)** opens `forge-build-prd` in the Console Terminal view or an external terminal; there is no headless alternative (ADR-060). **Grill the idea first** remains available when an Idea exists | `docs/PRD.md` + `docs/features/*.md` |
| PRD (no team) | **Generate team** (headless `forge-build-agent-team`) | agent files and ownership metadata |
| Team (skills incomplete) | **Generate project skills** | project skill candidates and review result |
| Skills ready (no manifest) | **Compile manifest** (`forge-execution-adapter`) | `docs/EXECUTION-MANIFEST.json` |
| Paused/incomplete run | **Resume build** | engine resumes from `WORKFLOW-STATE.json` |

The derivation steps run detached in the background (output is appended to
`docs/engine-run.log`, visible in the **Logs** view). This includes bootstrap,
team, skills, manifest-authoring jobs, and engine output. The console now tracks
those detached jobs directly, so Build status can show whether work is actively
creating the project, generating the team, running the build, paused, complete,
or failed. Preparation generates the team, project skills, and manifest but
does not launch the workflow engine. For a guided Project, only the explicit
**Start build** action begins execution. The generated team and skills are
**view-only** in the console - review them in **Plan & Team** and edit them in
your editor.

Requirements stages are different: the PRD and feature documents are authored in
an interactive session, not a background job. The Console can stop a browser PTY
session, but cannot pause or report on the authoring operation; completion is
observed from the repository after the skill commits.

Completed projects remain extensible. Use **Add a feature** on Build status to run
`forge-build-feature-prd`. The skill inspects the existing codebase, PRD, and
agent team and writes an additive document under `docs/features/`; it does not
replace the original PRD or start the engine. It interviews you, because a
feature document is requirements and requirements are never authored headlessly
(ADR-060). After authoring, choose **Continue after authoring** to update affected
agents and recompile the manifest; review the resulting tasks before running them.

### Interactive authoring

The New Project guide separates **Explore your Idea** from **Author your
Project brief**. The first runs `forge-grill-idea`; the second runs
`forge-build-prd`. Both use the configured authoring runner and PRD-stage model,
remain interactive, and can be resumed at the saved phase. Source documents
provide context but do not bypass either session. Existing Projects keep the
interactive authoring action on Build status.

Use the **Terminal** view to run the project tool or start a Project-brief,
Idea, or Feature PRD session in the browser. The **Open in external terminal**
button remains available as a fallback. These interactive actions do not become
headless jobs: the `draft-prd`, `draft-existing-prd`, and `feature-prd` control
actions continue to report the interactive handoff.

- **Explore your Idea (interactive)** runs `forge-grill-idea`, which interviews
  you in rounds to sharpen `docs/IDEA.md` before Project-brief authoring, then
  rewrites and commits it.
- **Author your Project brief (interactive)** runs `forge-build-prd` with the
  interview enabled and displays the resulting brief, including assumptions
  and open questions, for review.
- **Review and approve the Project brief** provides an editable page and an
  at-a-glance summary. **Request changes** saves edits and returns to
  `forge-build-prd`; **Approve** validates the brief and authorizes team, skill,
  and manifest preparation only. This is separate from Task-bound Human review
  and its evidence contract in [ADR-049](adr/049-human-review-evidence-and-console-completion.md).
- **Start build** appears only after preparation completes and the prepared plan
  has been shown. It is the only guided-path action that starts workflow
  execution.
- **Validate PRD** runs the read-only `validate-prd` check and reports the
  result, for documents authored outside the Console. It appears on the pipeline
  card once a PRD exists.

Browser PTY sessions run in the Console process and **keep running in the
background** when you navigate to another Console view; the Terminal nav link
shows a dot while a session is live. A session stops when you press **Stop**, the
project changes, the browser page is reloaded or closed, or the Console shuts
down. The external-terminal fallback runs outside the Console. In either case,
the skill validates and commits its own output, and the Console picks the result
up from the repository. Use **Refresh** on the pipeline card, or reopen the view,
to see newly authored documents.

The Terminal view only starts the selected supported CLI; it does not accept
arbitrary shell commands or working directories. The WebSocket requires the
Console token and local origin, and the Console allows one active PTY session.
See [ADR-068](adr/068-console-browser-terminal.md).

Each runner is opened on an interactive surface that accepts the queued prompt
*and* the resolved stage model:

| Runner | Interactive command |
|---|---|
| `opencode` | `opencode mini --prompt "<message>" [--model provider/model]` |
| `copilot` | `copilot -i "<message>" --yolo [--model <model>]` |
| `claude` | `claude [--model <model>] "<message>"` |

OpenCode needs the `mini` subcommand: its full-screen TUI accepts `--prompt` but
has no `--model`, so a pinned PRD-stage model made the whole session fail to
start with `Unrecognized flag: --model in command opencode`. `mini` is the one
interactive surface that takes both, and a queued `/skill …` prompt still runs as
a command. Because `mini` has no auto-approve flag, OpenCode asks you to approve
each tool call in that terminal. See
[ADR-065](adr/065-opencode-mini-interactive-authoring.md).

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
`docs/authoring-config.json`, then the system-level default in `settings.json`
(see [ADR-071](adr/071-system-level-console-defaults.md)), and otherwise derive
the runner from the project's harness (`github` → copilot, otherwise opencode).
The one exception to that order is `FORGE_RUN_WITH=stub`: it is an offline lock,
so `--runner` cannot override it and an offline run never spawns a real runner.

---

## Re-deriving the team and skills

Editing a PRD or feature document makes the agent team and the project skills
stale. The Console names the cause and runs the fix.

**Why it is stale.** Each authoring stage records the fingerprint of its inputs
and when it completed. When those no longer match, the Console compares each
input file's modification time against the stage's completion time and reports
the file — "*Inputs changed after this stage completed: docs/PRD.md*", *changed 3h
ago*. A stage whose generated output was deleted, or edited after completion, is
reported as such instead. The same detail appears on **Build status** and in
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
tasks for review** lives in the Build status **Manifest** panel, beside the
reconciliation data it acts on: it lists the changed and new task IDs, each
linking into **All tasks**, and the reset is behind a confirmation naming every task
it will discard. It clears those tasks' status, timings, outputs and artifacts,
setting them back to pending.

The **Controls** panel on Build status points here rather than duplicating the button.

---

## The Forge Board

The Console Board is a semantic HTML/CSS view over the Project's Task data and
the workflow engine's tested layout APIs. It does not load a canvas or require
PixiJS. **Kanban** and **Gantt** are peer views; each Project remembers its
selection and status filters, and each view remembers its own scroll position.

**Kanban** groups Tasks into phase rows and workflow-status columns. Cards
foreground the current state while keeping the phase label, Task summary,
responsibility, attention cue, and next action together.

**Gantt** uses the same Task summaries, attention cues, selection, and filters,
and adds timeline information:

- **Filled bars are measured; outlined bars are forecast.** Forecasts identify
  their source: observed attempts, the same agent's Tasks, or a default estimate.
- **Bars respect the engine's own dispatch rule** (direct dependencies plus every
  task of a depended-on phase) and the configured concurrency, so the forecast
  never promises a sequence the engine will not run.
- **Human-review Tasks** appear as milestones rather than durations.
- **The critical path** is highlighted: the longest chain of remaining work.

Selecting a card or bar opens the same compact Task details: its summary,
blocker, next responsible, next action, prerequisites, artifact inputs and
outputs, and changed files. Relationships are structured text, not
pointer-only links or extra focus stops. Full diagnostics remain in **Tasks**.
Every Task card and Gantt bar is a keyboard-focusable control; Enter or Space
opens its details, and closing details returns focus to the originating
control. Filters and view changes retain logical focus and the selected Task
while it remains available. The Board announces failures, newly ready Human
reviews, and cleared blockers, but not routine progress. Status filters dim
rather than hide Tasks, so workflow shape remains visible. Loading, empty,
failed, and stale-data states explain what happened and offer a next step.

On narrow screens (720px and below), Kanban scrolls horizontally across status
columns while keeping phase labels visible. Gantt keeps Task labels in view as
the timeline pans. Task details use a side panel on wide screens, flow below the
Board on medium screens, and fill the screen on narrow screens. Closing details
returns focus to the originating Task; Project selection, filters, and each
view's position remain available across resizing and refresh.

The standalone `workflow-engine run --viz` dashboard remains available
separately and may use PixiJS; it does not affect the Console Board.

---

## Adding PRD and research source material

Under **Advanced setup**, the **New Project wizard** accepts existing PRD and
research/seed documents (design specs, market research, technical notes). Both
fields accept a **file-picker browse** or a **typed absolute path**
(comma-separated for multiple research docs):

- **Existing PRD** → copied to `docs/requirements-source.md` and used as
  context for interactive Project-brief authoring. It does not replace the
  generated brief or skip either guided authoring phase.
- **Research / seed documents** → copied to `docs/research/`, where
  `forge-build-prd` reads them as extra context.

Picked files are uploaded to the server (`POST /api/uploads`, staged under the
OS temp dir) and the launcher is handed the paths via `FORGE_PRD_FILE` /
`FORGE_RESEARCH_FILES` — exactly the same env vars the terminal CLI uses.
After creation, research docs are listed in **Plan & Team** (kind `research`)
alongside the other project documents.

---

## Launching the harness CLI

A **Launch \<harness\> CLI** button on the **All tasks** view header and the
**Build status** header opens the project's harness CLI in a new terminal window,
working from the project folder — so you can watch the live run and take over
at any point. The **Terminal** view also offers the same harness session in the
browser. The CLI is chosen from the repo's harness root (`github` → `copilot`,
`claude` → `claude`, otherwise `opencode`). The external button is backed by
`POST /api/launch-cli`; when no desktop terminal emulator is available, it shows
the exact command to run manually.

---

## Views

**Home** and **Projects** are global destinations. The **Project** group offers
Build status, Board, Project brief, Project files, and Human review for the
currently selected Project. A visible **Advanced** group exposes the full Tasks
table, Logs, Timeline, Terminal, Plan & Team, Artifacts, and Settings; Advanced
is a navigation group, not a separate product mode. Hovering a group opens its
list, and selecting it pins the list open for touch.

The shell adapts to the available width: wide screens above 1050px keep the full
top navigation; medium screens from 721–1050px use a compact left navigation
rail; narrow screens at 720px or below use the labeled **Menu** drawer. The
drawer opens below the context bar so the Project switcher, identity, harness,
and Live/Idle status remain visible. Project and Advanced groups keep their
destinations available in every layout.

The persistent Project context bar remains visible on every destination, with
the current Project name, harness, Live/Idle state, and switcher. Navigating
between destinations never changes the selected Project; switching Projects is
an explicit action. Existing destination URLs such as `#/overview`,
`#/tasks?task=…`, and `#/documents?stage=…` remain valid and keep their query
state. `#/project-brief` opens the Project brief directly. If a saved destination
is retired or a Project destination is unavailable, the Console explains the
fallback and routes to Build status or Projects as appropriate.

Resizing the browser preserves the active destination and selected Project.
Content uses the available browser width, with only long-form prose capped for
readability.

| View | What it shows |
|---|---|
| **Home** | create a new project or open an existing one (landing), including live status labels for detached work. |
| **Projects** | global destination to switch projects, add a folder, or remove one or more projects from Forge. |
| **Build status** | Project run status, progress + counts, blockers, the pipeline next-step card with a **Manual build** checkbox, background-job status, run controls (Run/Resume/Pause/Stop, Replay, build mode), and a **Launch \<harness\> CLI** button. Stop asks for confirmation; canceling sends no stop request. Also the **Re-derive team & skills** panel when authoring is stale, and manifest reconciliation with a confirmed **Reset changed tasks for review**. |
| **Board** | the semantic HTML/CSS Board in **Kanban** or **Gantt** mode, with shared Task summaries and details, attention cues, status filters, and per-view scroll positions. |
| **Project brief** | the Project's readable PRD, with a link back to Build status for the editable review and approval actions. |
| **Project files** | read the Project idea, Project brief, progress, and feature documents, and open delivered files without Task-by-Task history. |
| **Human review** | focused queue of Human review Tasks, with each Task's criteria, references, blocker, next responsible action, and explicit review control. This is separate from Project brief approval. |
| **All tasks (Advanced)** | every Task in a filterable/sortable table with a detail drawer, editable per-task timeout, explicit/range selection controls for manual mode, and a **Launch \<harness\> CLI** button. |
| **Logs (Advanced)** | `docs/engine-run.log` tail + the audit event stream (live via SSE). |
| **Timeline (Advanced)** | chronological audit events, failures highlighted. |
| **Terminal (Advanced)** | interactive browser session for the selected harness or an existing authoring target, with PTY input/output, resize, stop, and external-terminal fallback. |
| **Plan & Team (Advanced)** | authoring stage cards — always actionable, each stating why it is stale — plus the re-derivation footer, technical project documents, and agents and skills in collapsible card sections. Requirement and task blocks render as tables. |
| **Artifacts (Advanced)** | Task-produced files and records (`docs/artifacts/`), browsable by type and Task with their detailed provenance. |
| **Settings (Advanced)** | Appearance (System/Light/Dark theme), authoring models (runner + stage models), execution preferences (build mode, concurrency, auto-commit, harness logging, task timeouts), and per-agent model overrides + the model planning terminal. |

A **Help** button (in the context bar) explains the UI, the pipeline, each view,
and key terms.

The focused **Tasks** queue distinguishes reviews that are ready, waiting on
prerequisites, or already recorded. Each entry keeps its Task-bound criteria,
references, blocker, and next responsible action visible. Review findings and
explicit approval are required; an agent or unattended flag cannot approve a
Human review. **Complete human review** lists unverified checks from all
upstream task and prerequisite-phase dependencies, including transitive ones.
Exercise the required journey and applicable live checks before approving, and
record what you checked and found in at least 40 characters after trimming.
These reported gaps are advisory, not proof of validation; see the
[human-review walkthrough](forge-console-user-guide.md#human-review-when-it-pauses-and-how-to-prove-approval).

---

## Run controls

The **Controls** panel on Build status drives a running build the same way the CLI
does:

| Action | Equivalent |
|---|---|
| **Pause** | writes `docs/engine-control.json` (`request: pause`); the engine stops after the current task. |
| **Stop** | after explicit confirmation, writes `request: stop` **and** SIGTERMs `docs/engine.pid`; canceling the confirmation sends no stop request. |
| **Resume** | `forge-launcher engine-run --repo <path> …` (resumes from `WORKFLOW-STATE.json`). |
| **Replay** | `workflow-engine replay <task-id> --repo <path>` for a failed task. |
| **Create manifest** *(pipeline card, manual pre-build only)* | `forge-launcher compile-manifest --repo <path>` (installs the adapter if needed and writes `docs/EXECUTION-MANIFEST.json` without starting the engine). |

### Execution mode

For Projects outside the new guided review path, the Build status pipeline card
exposes a **Manual build** checkbox. Turn it on when you want to prevent the
team → build step from immediately running the full workflow.

When **Manual build** is enabled and the repo has a generated team but no
manifest yet, the pipeline action changes from **Start build** to **Create
manifest**. That compiles `docs/EXECUTION-MANIFEST.json` without starting the
engine, so task selection can happen only after the manifest exists.

New guided Projects always prepare the team, project skills, and manifest first,
then require the separate **Start build** action. The prepared-plan gate is
independent of execution mode: **Auto** and **Manual** settings control what the
engine does only after the user starts the Build.

For existing Projects, the Build status **Controls** panel persists how the next run
should behave:

- **Auto** - the engine runs the full ready workflow.
- **Manual** - the engine runs only the selected task set saved from the
  **All tasks** view. The primary button text changes to **Run selected** /
  **Resume selected**.

Manual selections are stored in `docs/engine-config.json` with the run mode, the
selection scope (`single`, `range`, or `list`), and the selected task IDs. The
engine expands dependencies automatically when a selected task needs them, so
targeted runs still obey the DAG and phase ordering.

The **Auto-commit after each task** checkbox (Settings → Execution) toggles
`autoCommit` in `docs/engine-config.json`, which the console's run/resume
command passes to the engine. It defaults to **on** (see
[ADR-035](adr/035-auto-commit-after-task.md)); the engine commits one commit per
completed task. Disable it if the working tree is dirty and you don't want agent
output mixed with your uncommitted changes.

The **Log harness activity** checkbox (Settings → Execution) toggles
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

- **Per task** - open a task's detail drawer in **All tasks** (or use the task picker
  in **Settings → Execution**) and set its timeout, then **Replay** it.
- **All tasks** - the All tasks view header and **Settings → Execution** both have a
  "set all" control that gives every task the same timeout.

Storage and precedence (same as the CLI):

- A per-task value is written as `timeoutMs` on that task in
  `docs/EXECUTION-MANIFEST.json`, and overrides the engine default.
- The "set all" action writes `timeoutMs` to every manifest task **and** updates
  `taskTimeoutMs` in `docs/engine-config.json` (the engine-wide default).

> **Note:** `replay` and `run`/`resume` preserve these edits, *except* that
> `run`/`resume` recompiles the manifest from the PRD when a granularity is
> explicitly set - which regenerates `timeoutMs`. The engine-config default is
> always preserved.

### Token and cost usage

Each task records the token/cost usage its harness reported, on the state record
(`usage`) and on the `task.attempt.finished` / `task.complete` / `task.failed`
audit events. OpenCode usage is read from `opencode session export` for the
task's session; Claude from its JSON result envelope; Copilot from its stderr
stats block (tokens and AI credits). A harness that reports nothing is recorded
as `unavailable`, not zero. Build status shows run totals (tokens, cost, credits)
and **All tasks** shows a Tokens column plus a per-task breakdown in the detail
drawer. See [ADR-074](adr/074-token-and-cost-usage-capture.md).

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
**Build status**.

---

## Security

- The server binds to **`127.0.0.1` only** (loopback) - it is never exposed to
  the network.
- All `POST` endpoints require an **`X-Forge-Token`** header holding a
  per-server random token embedded in the served page, so cross-origin web pages
  cannot trigger actions.
- Project files is a read-only collection: Project documents are viewed in the
  Console, and delivered files offer an explicit external-open action. It does
  not edit or remove repository content. Detailed Task artifact provenance stays
  in **Artifacts**.
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

See [ADR-034](adr/034-forge-console-web-ui.md) for the original web-first,
tsc-only client, registry, and CSRF-guard decisions. The current semantic Board
baseline is recorded in [ADR-080](adr/080-semantic-console-board.md); ADR-063
preserves the earlier iframe-and-table decision.
