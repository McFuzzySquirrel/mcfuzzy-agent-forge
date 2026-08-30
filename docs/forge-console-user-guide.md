# Forge Console user guide

This walkthrough covers the everyday flow for opening the Forge Console, creating or switching projects, and monitoring a build without leaving the browser.

---

## 1. Start the console

From any terminal, run:

```bash
forge-launcher console
```

The server binds to `127.0.0.1` and prints a local URL such as `http://127.0.0.1:4300`. If the default port is busy, the next free port is used.

If you want to open a specific repo immediately, use:

```bash
forge-launcher console --repo /path/to/your/project
```

Use `--no-open` if you want to keep the browser handoff manual.

---

## 2. Create a new project or open an existing one

On the landing page you will see one of two choices:

- **Create a new project** to start a fresh forge repo from the console.
- **Open an existing project** to switch to a repo that already exists on disk.

The project picker remembers recent repos in your local Forge registry, so you can return to them later without re-adding the folder.

If you are creating a repo from the browser, the wizard collects:

- the project name,
- the harness choice,
- the parent directory,
- the initial idea,
- and whether the PRD should be drafted automatically.

Once it finishes, the console opens that project’s Overview view.

---

## 3. Use the Overview pipeline

The Overview is the main control center for a project. It shows:

- the current build state,
- progress counters,
- blockers or failures,
- the pipeline status,
- and the run controls.

When a project is still at an earlier stage, the **Continue** button advances the workflow one step at a time. The same actions are available from the terminal launcher, but the console lets you review the generated artifacts before moving on.

Typical progression:

1. **Idea → PRD**: draft the PRD.
2. **PRD → team**: generate the agent team.
3. **Team → build**: start the build.
4. **Paused or incomplete run**: resume the build.

The console polls for state changes and updates the button label as each stage completes.

---

## 4. Monitor the build in the main views

Once the build starts, switch between the views to follow the work:

- **Board**: a live kanban view for tasks in To Do, In Progress, Done, and Failed.
- **Tasks**: a sortable, filterable task table with a detail drawer for each task.
- **Logs**: the engine log tail plus the live audit event stream.
- **Plan & Team**: the project documents and the generated agent/skill files.
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

If a task times out or fails, open its detail drawer in the Tasks view and adjust the timeout before replaying it.

---

## 6. Adjust timeouts from the browser

The console can edit task timeouts without leaving the UI:

- open a task in the **Tasks** view,
- change the timeout value,
- and replay the task.

You can also set the same timeout for every task at once from the Tasks header or the Overview Controls panel. These values are stored in the manifest and engine config files so the run can be retried with a larger budget.

---

## 7. Switch projects quickly

If you are working across several repos, use the **Projects** view or the project picker to switch contexts. This keeps the current workspace and run state separate while preserving your recent-project history.

---

## 8. Common troubleshooting

- If the page does not open, check the terminal output for the local URL and try opening it manually.
- If a build does not advance, confirm the current stage in Overview and look for blockers in the Logs view.
- If a task keeps failing, bump its timeout and replay it.
- If you want to inspect the underlying documents, open the Plan & Team view or read the files in the repo directly.

For more detail on the console’s architecture and capabilities, see [forge-console.md](forge-console.md).
