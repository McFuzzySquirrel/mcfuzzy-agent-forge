# Forge Console — Visual Tour

A screenshot walkthrough of the Forge Console running against a demo project
(**TaskFlow**, harness `opencode`, a 6-task build with a running task). Start it
with `forge-launcher console`, then follow the views below.

> See [forge-console.md](forge-console.md) for the full reference.

---

## 1. Home

The landing page. Two action cards — **Create a new project** (→ `#/new`) and
**Open an existing project** (→ `#/projects`) — plus a **Recent projects**
dropdown for one-click return to a prior project.

![Home — landing page](images/forge-console/01-home.png)

## 2. Overview

The main dashboard: repo header with a live/idle indicator and harness badge,
run status + progress (`3/6 done`), phase, and counts. The **Pipeline** panel
holds the single **Continue** button (here **Resume build**, because the run is
paused-midway), and the **Controls** panel offers Pause / Stop / Resume / Replay.

![Overview — run status + pipeline + controls](images/forge-console/02-overview.png)

## 3. Board

The PixiJS **Forge Board**, embedded full-screen: tasks as name-tag cards flowing
through **To Do · In Progress · Done · Failed**, grouped by phase.

![Board — kanban](images/forge-console/03-board.png)

## 4. Tasks

Every task in a sortable, filterable table (status, id, title, phase, owner,
attempt, duration), with status-filter chips and a search box.

![Tasks — table](images/forge-console/04-tasks.png)

## 5. Task detail

Clicking a row expands a detail drawer: description, expected outputs, validation
commands, dependencies, inputs, output files, and error/artifact metadata.

![Tasks — expanded detail](images/forge-console/05-tasks-detail.png)

## 6. Logs (engine)

The `docs/engine-run.log` tail, live-appended over SSE.

![Logs — engine log](images/forge-console/06-logs.png)

## 7. Logs (audit)

The audit event stream (run/phase/task lifecycle), also live.

![Logs — audit stream](images/forge-console/07-logs-audit.png)

## 8. Plan & Team

The project's documents and team in three collapsible sections — **Documents**,
**Agents**, **Skills** (collapsed by default).

![Plan & Team — collapsed sections](images/forge-console/08-plan-team.png)

## 9. Plan & Team — a document

Expanding **Documents** and selecting the PRD renders it as Markdown, with an
**Open externally** button to edit it in your editor.

![Plan & Team — PRD rendered](images/forge-console/09-plan-team-doc.png)

## 10. Artifacts

The structured outputs each task produced, browsable by type.

![Artifacts — browser](images/forge-console/10-artifacts.png)

## 11. Artifact detail

Selecting an artifact shows its metadata, payload, and changed files.

![Artifacts — detail](images/forge-console/11-artifacts-detail.png)

## 12. Timeline

Chronological audit events, with failures highlighted.

![Timeline — audit events](images/forge-console/12-timeline.png)

## 13. New project

The **New Project** wizard (`#/new`): name, harness, visibility, parent
directory, idea, and an auto-draft toggle — spawns `forge-launcher --non-interactive`
in the background.

![New project — wizard](images/forge-console/13-new-project.png)

## 14. Help

The **Help** overlay (top-right button) explains the app, the pipeline, each
view, and key terms.

![Help — modal](images/forge-console/14-help.png)
