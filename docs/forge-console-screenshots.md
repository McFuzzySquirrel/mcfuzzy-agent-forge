# Forge Console - Visual Tour

A screenshot walkthrough of the Forge Console. These images were captured from
the current Console build in Chrome against a deterministic local fixture; no
external authoring or paid model execution was used. Desktop captures use the
stable numbered filenames below. The complete desktop and responsive capture
set is archived under `images/forge-console/current/`. Start with
`forge-launcher console`.

The Project brief review captures also run a browser acceptance path with
deterministic API responses: approval is checked to request preparation only,
and the Build request is observed only after **Start build**. No authoring or
workflow process is launched by this capture.

> See [forge-console.md](forge-console.md) for the full reference.
>
> **Capture note (v3.112):** these captures show the top category navigation
> (hover or select a category for its dropdown), the persistent project context
> bar, full-width content, run-level token/cost stats, the Tasks **Tokens**
> column, and the consolidated **Settings** view.
>
> The Board captures show the semantic HTML/CSS baseline. Board-only capture
> refreshes Board images and thumbnails without rebuilding the walkthrough GIF.

---

## 1. Home

The landing page emphasizes **Start with an idea** (`#/new`) as its primary
action. Recent Projects and existing-application setup remain available as
secondary choices.

![Home - landing page](images/forge-console/current/home-1024.png)

### Starting a Project

The New Project screen asks for an Idea, a suggested editable name, and an AI
coding tool. Optional technical settings stay collapsed under **Advanced setup**.

![New Project - idea-first setup](images/forge-console/current/new-1024.png)

## 2. Overview

The dashboard puts project identity, the next pipeline action, and blockers
first. PRD, team, and project-skill authoring have separate status summaries.
The run stats include the harness-reported **Tokens** (in/out) and **Cost**
(plus credits where a harness reports them). The **Controls** panel keeps the
run controls and build mode; timeouts, concurrency, auto-commit, and
harness-activity logging now live in **Settings → Execution**. (The Overview
capture is full-page so the Controls are visible.)

![Overview - run status + pipeline + controls](images/forge-console/current/overview-1024.png)

## 3. Board

The semantic HTML/CSS Board in either mode. PixiJS is not required.
Task cards and Gantt bars are keyboard controls. Task details expose
prerequisites and artifact relationships as structured text; selection moves
focus into details and Close restores it.

**Kanban** — Tasks grouped by phase and workflow status. Cards include their
summary, responsibility, and attention/next-action cue.

![Board - kanban](images/forge-console/03-board.png)

**Gantt** — the same Task summaries against time. Actual and forecast durations
are distinguished, Human review Tasks are milestones, and the critical path is
highlighted.

![Board - gantt](images/forge-console/03b-board-gantt.png)

Selecting a card or timeline bar opens the shared compact Task details with its
blocker, next action, prerequisites, artifact inputs and outputs, changed files,
and a link to full diagnostics in All tasks.

![Board - Task details](images/forge-console/03c-board-detail.png)

## 4. Tasks

Every task appears in a sortable, filterable table with status chips, search,
and explicit manual selection. The **Tokens** column shows each task's
harness-reported total token count (or "—" when the harness reported none).
Selections and focused controls survive live updates. On narrow screens, the
labelled table region scrolls horizontally instead of widening the whole page.

![Tasks - table](images/forge-console/04-tasks.png)

## 5. Task detail

Clicking a row expands a detail drawer: description, effective model, token
usage (in/out, cache, cost, or an explicit "not reported"), expected outputs,
validation commands, dependencies, inputs, output files, and error/artifact
metadata.

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

The project documents, generated agents, and skills, plus the authoring stage
cards and re-derivation footer. Selecting a document opens it in a wide popup
(see §9). Authoring models and per-agent execution overrides are configured in
**Settings**.

![Plan & Team - project docs, agents, skills, stages](images/forge-console/08-plan-team.png)

## 9. Plan & Team - a document

Expanding **Documents** and selecting the PRD opens it in a wide popup as
rendered Markdown (requirement and task blocks become tables), with an
**Open externally** button to edit it in your editor.

![Plan & Team - rendered document detail](images/forge-console/current/documents-detail-1440.png)

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
documents, and three optional authoring model choices. The wizard does not
auto-draft requirements; after creation, PRD authoring starts from Overview in
an interactive terminal session.
Selecting an existing PRD skips drafting it. Failed uploads or saves keep
the draft available rather than silently starting with missing inputs.

![New project - wizard](images/forge-console/13-new-project.png)

### Project brief review and preparation

The review is an editable page with an at-a-glance summary. **Request changes**
returns to interactive authoring; **Approve** authorizes preparation only.
Preparation progress is one guided background step. Once the prepared plan is
ready, the page summarizes major phases, assumptions, and warnings and offers
the separate **Start build** action.

![Project brief review - editable brief and summary](images/forge-console/current/project-brief-review-1440.png)

![Preparing a Build - guided progress](images/forge-console/current/project-preparing-1440.png)

![Prepared plan - explicit Start build action](images/forge-console/current/prepared-plan-1440.png)

## 14. Help

The **Help** dialog explains the pipeline, views, and key terms. Opening it moves
keyboard focus into the dialog; Escape closes it and returns focus to Help.

![Help - modal](images/forge-console/14-help.png)

## 15. Settings

A single view for project configuration plus system-level defaults:

- **Global defaults** - default harness, authoring runner, concurrency, and
  auto-commit / harness-activity logging, stored in the Forge `settings.json`
  and inherited by projects that have not set their own value.
- **Authoring** - the runner and per-stage PRD/team/skills models for this
  project.
- **Execution** - build mode, concurrency, auto-commit, harness-activity
  logging, and task timeouts for this project.
- **Models** - per-agent primary/fallback overrides and the model planning
  terminal.

![Settings - global defaults, authoring, execution, and models](images/forge-console/15-settings.png)

## 16. Navigation menu

Navigation is a top bar of categories. Hovering a category opens its views, and
selecting it pins the list open for touch; the category that owns the current
view keeps the amber underline. The page content uses the full browser width.

![Navigation - category dropdown](images/forge-console/16-nav-menu.png)

## 17. Project files

Project files foregrounds the idea, brief, progress, and feature documents, then
lists delivered files separately from Task-by-Task history.

![Project files - documents and deliverables](images/forge-console/17-project-files.png)

Selecting **Read Project brief** opens its rendered Markdown in the Console.

![Project files - rendered brief](images/forge-console/17b-project-files-detail.png)

## 18. Human review

The focused review queue shows Tasks that need a person, their criteria,
evidence, blockers, and next action.

![Human review - focused queue](images/forge-console/18-human-review.png)

## Responsive current captures

The checked-in build was captured at 1440px, 1024px, 720px, 390px, and 320px for
its routes. Detail-state captures (expanded task, rendered PRD, rendered
feature, Project brief, artifact detail, and audit log) are also included in
`images/forge-console/current/`.

| View | 1024px | 720px | 390px | 320px |
| --- | --- | --- | --- | --- |
| Overview | [image](images/forge-console/current/overview-1024.png) | [image](images/forge-console/current/overview-720.png) | [image](images/forge-console/current/overview-390.png) | [image](images/forge-console/current/overview-320.png) |
| Board | [image](images/forge-console/current/board-1024.png) | [image](images/forge-console/current/board-720.png) | [image](images/forge-console/current/board-390.png) | [image](images/forge-console/current/board-320.png) |
| Tasks | [image](images/forge-console/current/tasks-1024.png) | [image](images/forge-console/current/tasks-720.png) | [image](images/forge-console/current/tasks-390.png) | [image](images/forge-console/current/tasks-320.png) |
| Logs | [image](images/forge-console/current/logs-1024.png) | [image](images/forge-console/current/logs-720.png) | [image](images/forge-console/current/logs-390.png) | [image](images/forge-console/current/logs-320.png) |
| Plan & Team | [image](images/forge-console/current/documents-1024.png) | [image](images/forge-console/current/documents-720.png) | [image](images/forge-console/current/documents-390.png) | [image](images/forge-console/current/documents-320.png) |
| Artifacts | [image](images/forge-console/current/artifacts-1024.png) | [image](images/forge-console/current/artifacts-720.png) | [image](images/forge-console/current/artifacts-390.png) | [image](images/forge-console/current/artifacts-320.png) |
| Project files | [image](images/forge-console/current/project-files-1024.png) | [image](images/forge-console/current/project-files-720.png) | [image](images/forge-console/current/project-files-390.png) | [image](images/forge-console/current/project-files-320.png) |
| Human review | [image](images/forge-console/current/review-queue-1024.png) | [image](images/forge-console/current/review-queue-720.png) | [image](images/forge-console/current/review-queue-390.png) | [image](images/forge-console/current/review-queue-320.png) |
| Timeline | [image](images/forge-console/current/timeline-1024.png) | [image](images/forge-console/current/timeline-720.png) | [image](images/forge-console/current/timeline-390.png) | [image](images/forge-console/current/timeline-320.png) |
| Projects | [image](images/forge-console/current/projects-1024.png) | [image](images/forge-console/current/projects-720.png) | [image](images/forge-console/current/projects-390.png) | [image](images/forge-console/current/projects-320.png) |
| New project | [image](images/forge-console/current/new-1024.png) | [image](images/forge-console/current/new-720.png) | [image](images/forge-console/current/new-390.png) | [image](images/forge-console/current/new-320.png) |
| Settings | [image](images/forge-console/current/settings-1024.png) | [image](images/forge-console/current/settings-720.png) | [image](images/forge-console/current/settings-390.png) | [image](images/forge-console/current/settings-320.png) |

## Regenerating these captures

The images are produced by the `tools/console-screenshots` developer tool. It
builds the launcher, writes a deterministic fixture repository, starts the
Console against it, and drives the installed Chrome with `puppeteer-core`. No
model or external authoring runs; every timestamp in the fixture is fixed.

```bash
cd tools/console-screenshots
npm install         # first time; installs puppeteer-core (no bundled browser)
npm run capture     # builds the launcher, captures, then writes images + GIF
npm run capture -- --board-only # refreshes only Board images and thumbnails
```

Requirements: `google-chrome` (or set `CHROME_PATH`), `ffmpeg` on `PATH`, and
Node 18+. Board captures also run deterministic keyboard, focus-restoration,
filter/view-continuity, and structured-relationship assertions. The tool writes
the responsive set to
`docs/images/forge-console/current/`, derives the numbered tour images and the
640px thumbnails, and rebuilds `console-walkthrough.gif`. Board-only capture
skips the GIF and unrelated views. Pass `--headed` to watch the browser while it
captures.
