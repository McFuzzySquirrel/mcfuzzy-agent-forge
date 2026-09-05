# Forge Console user guide

This walkthrough covers the everyday flow for opening the Forge Console, creating or switching projects, and monitoring a build without leaving the browser. It is kept in step with the console UI — see [updates.md](updates.md) for what changed in each release.

> [!WARNING]
> The committed screenshots were captured from the current Console build
> against a deterministic local fixture. They document current layout and
> representative fixture state, but do not replace interactive accessibility
> testing.

---

## 1. Start the console

From any terminal, run:

```bash
forge-launcher console
```

The server binds to `127.0.0.1` and prints a local URL such as `http://127.0.0.1:4300`. If the default port is busy, the next free port is used.

Useful flags:

```bash
forge-launcher console --repo /path/to/your/project   # open a specific repo immediately
forge-launcher console --port 4400                    # prefer a specific port
forge-launcher console --no-open                      # keep the browser handoff manual
```

---

## 2. Create or open a project

On the landing page you will see one of two choices:

- **Create a new project** to start a fresh forge repo from the console.
- **Open an existing project** to switch to a repo that already exists on disk.

The project picker remembers recent repos in your local Forge registry, so you can return to them later without re-adding the folder.

If you are creating a repo from the browser, the wizard collects:

- the project **name**,
- the **description** (optional),
- the **harness** choice (opencode / github / claude / agents),
- the **visibility** (private or public),
- the **parent directory**,
- the initial **idea**,
- optionally an **existing PRD** and **research/seed documents** — browse a file
  picker or type absolute paths (comma-separated for multiple research files).
Uploaded files must be plain text or Markdown (`.md` or `.txt`) because the
browser staging path reads text directly. Existing PRDs are copied to
`docs/PRD.md`; research/seed files are copied to `docs/research/` and inform
the PRD build,
- and whether setup should run automatically after creation (draft the PRD and generate the agent team).
- **Concurrency preference** (optional): a stored engine setting carried into
  `docs/engine-config.json` and later runs. Leave blank to use the engine
  default or adjust it later from the Overview Controls panel.

Once it finishes, the console opens that project's Overview view. If creation
continues in the background, the wizard now shows a live status card so you can
tell when the repo is ready to open.

---

## 3. Drive the pipeline from Overview

The Overview is the main control center for a project. It shows:

- the run header (Live/Idle indicator, harness badge, and control state),
- progress counters,
- blockers or failures,
- the **Manifest** panel (compiled phase/task counts),
- the latest detached-job status,
- the pipeline status,
- and the run controls.

When a project is still at an earlier stage, the **Continue** button advances the workflow one step at a time. The same actions are available from the terminal launcher, but the console lets you review the generated artifacts before moving on.

Typical progression:

1. **Idea → PRD**: draft the PRD.
2. **PRD → team**: generate the agent team and ownership metadata.
3. **Team → project skills**: generate or review project-specific skills.
4. **Skills → manifest**: compile `docs/EXECUTION-MANIFEST.json`.
5. **Manifest → build**: start the build, or stop after compilation for review.
6. **Paused or incomplete run**: resume the build.

The console polls for state changes and updates the button label as each stage
completes. When a detached step finishes or fails, Overview keeps the result
visible and links you straight to **Logs**.

To use MyForge with an application that already exists, open **Projects** and
choose **Bootstrap an existing repo**. The folder must be a Git repository;
enable **Initialize git if needed** explicitly for a non-Git folder. Existing
application files are preserved, and Forge files are overwritten only when
**Overwrite existing Forge files** is selected.

After a build completes, use **Add a feature** on Overview. This runs
`forge-build-feature-prd` against the existing codebase and team, writes an
additive document under `docs/features/`, and leaves the original PRD intact.
Choose **Prepare increment** to update affected agents and reconcile the manifest,
or enable **Run new feature tasks** to execute only tasks emitted by that feature.
The Overview reconciliation panel lists preserved, new, changed, and removed task
IDs. Changed completed tasks are preserved but flagged for review.

For a complete increment, use **Run Feature Increment**. The launcher performs
Feature PRD authoring, an affected-team update, and manifest compilation. It
then stops for review or selects only the new feature task IDs for execution.
Stable task IDs preserve completed work; new tasks start pending, changed
contracts are called out for review, and removed tasks are not runnable.

---

## 4. Monitor a build in the main views

Once the build starts, switch between the views to follow the work:

- **Board**: a live kanban view for tasks in To Do, In Progress, Done, and Failed.
- **Tasks**: a sortable, filterable task table with a detail drawer for each task.
- **Logs**: the engine and authoring log tail plus the live audit event stream.
- **Plan & Team**: the project documents and the generated agent/skill files.
  Documents open in a detail pane with an **Open externally** button; skills are
  shown as cards grouped into **Forge skills** and **Project skills**. Agent
  cards also expose primary and fallback model selectors when a model inventory
  has been discovered.

The Console uses the selected harness root for team, report, and model-override
operations. It does not merge agents with the same identity from other harness
roots, so a skills-only directory cannot silently replace the generated team.
For an existing compiled manifest, the manifest's `harnessRoot` is preferred
over automatic detection. If that path is stale, update the selected root and
recompile the manifest explicitly; the Console will not silently switch roots.
- **Artifacts**: structured outputs produced by the run, browsable by type and task.
- **Timeline**: a chronological record of important events and failures.

The most useful combination for day-to-day work is usually Overview + Board + Logs.

Authoring lifecycle records use the `FORGE_EVENT {json}` prefix in
`docs/engine-run.log` and are also sent as `authoring` SSE events. Ordinary
process output remains unchanged and continues as `log` events, preserving
plain log tails and compatibility with older clients. Failed stages leave both
the lifecycle failure record and the command output in the same log.

---

## 5. Prepare and control a build

The Overview controls panel offers the same actions you would otherwise issue from the CLI:

- **Pause**: stop after the current task completes.
- **Stop**: terminate the running engine.
- **Resume**: continue the run from the saved state.
- **Replay**: retry a failed task.
- **Manual build**: before a manifest exists, prevent the team → build step from
  starting the full workflow. The pipeline action becomes **Create manifest**.
- **Build mode**: after the manifest exists, choose **auto** to run the full
  workflow, or **manual** to run only the saved task selection from the Tasks
  view. Manual mode requires at least one selected task.
- **Auto-commit after each task**: toggles one-commit-per-task git history (on by default).
- **Concurrency preference**: stores the engine concurrency value in `docs/engine-config.json`. Enter a positive integer (e.g. `3`) and click **Set**; enter `0` to return to the engine default. The value is shown in later Run/Resume summaries, but current repo-task execution remains serialized while output attribution is repo-wide.
- **Reset changed tasks for review**: after feature reconciliation, resets completed or skipped tasks whose contracts changed back to pending. Review the changed task IDs before using this action.
- **Launch \<harness\> CLI**: opens the project's harness CLI (opencode/copilot/claude) in a new terminal from the project folder, so you can watch the live run and take over manually. Also available on the Tasks header.

### Authoring stages and model settings

Authoring has three separate stages:

1. **PRD** - capture or review the product requirements.
2. **Team** - generate agents, ownership, and execution responsibilities.
3. **Project skills** - generate or review project-specific skills before the
   execution adapter compiles the manifest.

Each stage has its own output and review boundary. A missing or failed skills
stage is not equivalent to a successful "no skills required" result.
The backend persists stage status, input fingerprints, outputs, timestamps,
errors, and model provenance in versioned `docs/authoring-state.json`; the
Console should project those states rather than infer readiness from whether a
skill directory happens to exist.

### Assign models to agents

Run the `forge-assign-models` skill after the team has been generated. It builds
`docs/research/model-inventory.json` from the models available to the local
environment:

- `opencode models` for OpenCode models,
- `copilot --help` metadata for Copilot models when the installed CLI exposes
  an authoritative model section,
- the local Ollama API when Ollama is running, and
- the configured BYOK provider when `COPILOT_PROVIDER_BASE_URL` is set.

The skill normalizes command output before using it. Headings, bullets,
numbering, provider labels, table borders, and annotations such as
`(recommended)` are removed. Only canonical model IDs are assigned; raw CLI
output is retained only for diagnostics. BenchLM capability and evidence data
may be attached to discovered models, but BenchLM does not make a model
available by itself.

Open **Plan & Team → Agents** to choose a primary and fallback model for an
agent. The selectors only accept models present in the discovered inventory.
Saving an override writes `docs/model-overrides.json`; it does not rewrite the
agent file. The override applies to every task owned by that agent and takes
precedence over the recommendation. Apply mode in `forge-assign-models` can
explicitly copy the values into agent frontmatter when that is desired.

The effective selection order is:

```text
explicit agent override → saved recommendation → runner default (only when
the runner supplies one)
```

The **Model planning terminal** control in the Agents section opens a new
interactive terminal in the repository. Choose OpenCode or Copilot, enter a
message, and launch it using one of these commands:

```bash
opencode --prompt "<message>"
copilot -i "<message>" --yolo
```

The assistant is not applied automatically. Review its changes and update the
model plan or agent overrides explicitly.

For a targeted run before the first build starts, enable the **Manual build**
checkbox in the Overview pipeline card and click **Create manifest**. The
manifest is created without starting the engine. Then use the checkboxes or
range picker in **Tasks**, click **Save selection**, switch the Overview
**Controls** panel to **manual**, and click **Run selected**. The engine expands
selected tasks to include unmet dependencies while leaving unselected tasks
untouched.

---

## 6. Review incremental changes

After a project has a PRD and agent team, **Add a feature** on Overview authors
an additive Feature PRD under `docs/features/`. It does not replace the
original PRD or start the engine. **Run Feature Increment** prepares the
affected team and recompiles the manifest; enable **Run the workflow after
preparing** only when the new feature tasks should run immediately.

The Manifest panel shows preserved, new, changed, and removed task IDs. Stable
task IDs preserve completed work. Review changed contracts, use **Reset changed
tasks for review** when those tasks need to run again, and select new pending
tasks in **Tasks** before a targeted run.

## 7. Tune task timeouts

The console can edit task timeouts without leaving the UI:

- open a task in the **Tasks** view,
- change the timeout value (entered in minutes, decimals allowed),
- and replay the task.

You can also set the same timeout for every task at once from the Tasks header or the Overview Controls panel. These values are stored in the manifest and engine config files so the run can be retried with a larger budget. Completed tasks show their timeout read-only; failed, pending, and running tasks stay editable.

---

## 8. Switch between projects

If you are working across several repos, use the **Projects** view or the project picker to switch contexts. This keeps the current workspace and run state separate while preserving your recent-project history.

---

## 9. Troubleshoot common issues

- If the page does not open, check the terminal output for the local URL and try opening it manually.
- If a build does not advance, confirm the current stage in Overview and look for blockers in the Logs view.
- If a task keeps failing, bump its timeout and replay it.
- If **Run selected** is disabled, switch to **Tasks**, select one or more
  tasks, and click **Save selection**.
- If a feature increment reports changed tasks, review the reconciliation in
  Manifest before running; reset changed tasks only when they should execute
  again.
- If you want to inspect the underlying documents, open the Plan & Team view or read the files in the repo directly.

For more detail on the console’s architecture and capabilities, see [forge-console.md](forge-console.md).
