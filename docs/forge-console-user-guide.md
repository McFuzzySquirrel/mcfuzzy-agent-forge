# Forge Console user guide

This walkthrough covers the everyday flow for opening the Forge Console, creating or switching projects, and monitoring a build without leaving the browser. It is kept in step with the console UI — see [updates.md](updates.md) for what changed in each release.

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
  picker or type absolute paths (comma-separated for multiple). Picked files can
  be `.md`, `.txt`, `.pdf`, or `.docx`; they are copied to `docs/PRD.md` /
  `docs/research/` and inform the PRD build,
- and whether the PRD should be **drafted automatically** after creation.
- **Concurrency (parallel agents)** (optional): the number of agents to run in
  parallel. Leave blank to use the engine default or adjust it later from the
  Overview Controls panel.

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
2. **PRD → team**: generate the agent team.
3. **Team → build**: start the build, or enable **Manual build** first if you want to stop after manifest creation.
4. **Paused or incomplete run**: resume the build.

The console polls for state changes and updates the button label as each stage
completes. When a detached step finishes or fails, Overview keeps the result
visible and links you straight to **Logs**.

---

## 4. Monitor a build in the main views

Once the build starts, switch between the views to follow the work:

- **Board**: a live kanban view for tasks in To Do, In Progress, Done, and Failed.
- **Tasks**: a sortable, filterable task table with a detail drawer for each task.
- **Logs**: the engine log tail plus the live audit event stream.
- **Plan & Team**: the project documents and the generated agent/skill files.
  Documents open in a detail pane with an **Open externally** button; skills are
  shown as cards grouped into **Forge skills** and **Project skills**.
- **Artifacts**: structured outputs produced by the run, browsable by type and task.
- **Timeline**: a chronological record of important events and failures.

The most useful combination for day-to-day work is usually Overview + Board + Logs.

---

## 5. Control a running build

The Overview controls panel offers the same actions you would otherwise issue from the CLI:

- **Pause**: stop after the current task completes.
- **Stop**: terminate the running engine.
- **Resume**: continue the run from the saved state.
- **Replay**: retry a failed task.
- **Build mode**: once the manifest exists, choose **auto** to run the full
  workflow, or **manual** to run only the saved task selection from the Tasks
  view.
- **Auto-commit after each task**: toggles one-commit-per-task git history (on by default).
- **Concurrency (parallel agents)**: sets how many agents the engine runs in parallel. Enter a positive integer (e.g. `3`) and click **Set**; enter `0` to return to the engine default. The setting is saved to `docs/engine-config.json` and takes effect on the next Run or Resume.
- **Launch \<harness\> CLI**: opens the project's harness CLI (opencode/copilot/claude) in a new terminal from the project folder, so you can watch the live run and take over manually. Also available on the Tasks header.

If you want a targeted run before the first build starts, enable the **Manual
build** checkbox in the Overview pipeline card and click **Create manifest**.
Then use the checkboxes and range picker in **Tasks**, save the selection,
switch the Overview **Controls** panel to **manual**, and click **Run selected**.

---

## 6. Tune task timeouts

The console can edit task timeouts without leaving the UI:

- open a task in the **Tasks** view,
- change the timeout value (entered in minutes, decimals allowed),
- and replay the task.

You can also set the same timeout for every task at once from the Tasks header or the Overview Controls panel. These values are stored in the manifest and engine config files so the run can be retried with a larger budget. Completed tasks show their timeout read-only; failed, pending, and running tasks stay editable.

---

## 7. Switch between projects

If you are working across several repos, use the **Projects** view or the project picker to switch contexts. This keeps the current workspace and run state separate while preserving your recent-project history.

---

## 8. Troubleshoot common issues

- If the page does not open, check the terminal output for the local URL and try opening it manually.
- If a build does not advance, confirm the current stage in Overview and look for blockers in the Logs view.
- If a task keeps failing, bump its timeout and replay it.
- If you want to inspect the underlying documents, open the Plan & Team view or read the files in the repo directly.

For more detail on the console’s architecture and capabilities, see [forge-console.md](forge-console.md).
