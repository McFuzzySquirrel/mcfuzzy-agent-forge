# Forge Console - Visual Tour

A screenshot walkthrough of the Forge Console. The Overview, Tasks table,
Plan & Team, New Project, and Help images show the current beta-5 Console with
a local fixture project; no external authoring or paid model execution was used
to create them. The other images retain the earlier **TaskFlow** demo and
illustrate corresponding views that are not represented in the supplied beta-5
capture set. Start with `forge-launcher console`.

> See [forge-console.md](forge-console.md) for the full reference.

---

## 1. Home

The landing page. Two action cards - **Create a new project** (→ `#/new`) and
**Open an existing project** (→ `#/projects`) - plus a **Recent projects**
dropdown for one-click return to a prior project.

![Home - landing page](images/forge-console/01-home.png)

## 2. Overview

The dashboard puts project identity, the next pipeline action, and blockers
first. PRD, team, and project-skill authoring have separate status and model
summaries. Authoring retries are distinct from native execution controls;
legacy projects do not need to regenerate a team just to resume a build.

![Overview - run status + pipeline + controls](images/forge-console/beta-5/console-overview-desktop.png)

## 3. Board

The PixiJS **Forge Board**, embedded full-screen: tasks as name-tag cards flowing
through **To Do · In Progress · Done · Failed**, grouped by phase.

![Board - kanban](images/forge-console/03-board.png)

## 4. Tasks

Every task appears in a sortable, filterable table with status chips, search,
and explicit manual selection. Selections and focused controls survive live
updates. On narrow screens, the labelled table region scrolls horizontally
instead of widening the whole page.

![Tasks - table](images/forge-console/beta-5/console-tasks-desktop.png)

## 5. Task detail

Clicking a row expands a detail drawer: description, expected outputs, validation
commands, dependencies, inputs, output files, and error/artifact metadata.

![Tasks - expanded detail](images/forge-console/05-tasks-detail.png)

## 6. Logs (engine)

The `docs/engine-run.log` tail, live-appended over SSE. Follow mode keeps new
output in view; disabling it preserves the reading position and shows unread
output.

![Logs - engine log](images/forge-console/06-logs.png)

## 7. Logs (audit)

The audit event stream (run/phase/task lifecycle), also live.

![Logs - audit stream](images/forge-console/07-logs-audit.png)

## 8. Plan & Team

Independent PRD, team, and project-skill **Authoring models** are available
before a team exists. Save a model or leave a stage on **Inherit runner default**.
Inventory refresh and unavailable saved selections remain explicit. The
**Documents**, **Agents**, and **Skills** sections keep execution-model
overrides separate from authoring settings.

![Plan & Team - authoring settings and project sections](images/forge-console/beta-5/console-documents-desktop.png)

## 9. Plan & Team - a document

Expanding **Documents** and selecting the PRD renders it as Markdown, with an
**Open externally** button to edit it in your editor.

![Plan & Team - documents section](images/forge-console/beta-5/console-documents-desktop.png)

## 10. Artifacts

The structured outputs each task produced, browsable by type.

![Artifacts - browser](images/forge-console/10-artifacts.png)

## 11. Artifact detail

Selecting an artifact shows its metadata, payload, and changed files.

![Artifacts - detail](images/forge-console/11-artifacts-detail.png)

## 12. Timeline

Chronological audit events, with failures highlighted.

![Timeline - audit events](images/forge-console/12-timeline.png)

## 13. New project

The **New Project** wizard (`#/new`) collects project details, supported text
documents, three optional authoring model choices, and the auto-draft setting.
Auto-draft runs PRD, team, and project-skill generation as separate stages.
Selecting an existing PRD skips drafting it. Failed uploads or saves keep
the draft available rather than silently starting with missing inputs.

![New project - wizard](images/forge-console/beta-5/console-new-desktop.png)

## 14. Help

The **Help** dialog explains the pipeline, views, and key terms. Opening it moves
keyboard focus into the dialog; Escape closes it and returns focus to Help.

![Help - modal](images/forge-console/beta-5/console-help-desktop.png)

## Responsive beta-5 captures

The supplied beta-5 set also includes 1024px, 720px, 390px, and 320px
responsive captures for Overview, Tasks, Plan & Team/Documents, and New Project.
The Help view is supplied as a desktop capture.

| View | 1024px | 720px | 390px | 320px |
| --- | --- | --- | --- | --- |
| Overview | [image](images/forge-console/beta-5/console-overview-1024.png) | [image](images/forge-console/beta-5/console-overview-720.png) | [image](images/forge-console/beta-5/console-overview-390.png) | [image](images/forge-console/beta-5/console-overview-320.png) |
| Tasks | [image](images/forge-console/beta-5/console-tasks-1024.png) | [image](images/forge-console/beta-5/console-tasks-720.png) | [image](images/forge-console/beta-5/console-tasks-390.png) | [image](images/forge-console/beta-5/console-tasks-320.png) |
| Plan & Team | [image](images/forge-console/beta-5/console-documents-1024.png) | [image](images/forge-console/beta-5/console-documents-720.png) | [image](images/forge-console/beta-5/console-documents-390.png) | [image](images/forge-console/beta-5/console-documents-320.png) |
| New project | [image](images/forge-console/beta-5/console-new-1024.png) | [image](images/forge-console/beta-5/console-new-720.png) | [image](images/forge-console/beta-5/console-new-390.png) | [image](images/forge-console/beta-5/console-new-320.png) |
