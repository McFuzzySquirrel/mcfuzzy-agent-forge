# Interactive Authoring + Plan & Team Rendering Plan

Status: Implemented (v3.80). Working plan for the change set that adds
interactive authoring sessions to the Forge Console, a `forge-grill-idea` skill,
and richer Plan & Team document rendering. See
[ADR-051](adr/051-interactive-authoring-from-console.md) and
[updates.md](updates.md) for the accepted decision and release notes.

## Goals

- Launch an interactive "grill me" style skill from the Console to flesh out
  `docs/IDEA.md`.
- Make the PRD phase interactive by default in the Console by launching an
  interactive harness session, while leaving a headless auto-build option.
- Apply the same interactive-plus-auto choice to Feature PRD authoring.
- Render `forge-requirement` and `forge-task` blocks as tables in the Console
  document view (UI only; the authored documents are unchanged).
- Replace the cramped split-pane document view with a documents table that opens
  the selected document in a wide modal dialog.

## Design decisions

- New skill `forge-grill-idea`, modeled on aihero's `grill-me` / `grilling`
  technique (design tree, rounds of the *frontier*, `❓`/`➡️` question format,
  facts vs decisions, confirmation gate), adapted to be stateful: it rewrites
  `docs/IDEA.md` and commits, then stops.
- Interactive sessions launch with a pre-seeded prompt (`opencode --prompt …`,
  `copilot -i … --yolo`, `claude "<message>"`), matching the existing model
  planning terminal.
- Plan & Team documents become a table that opens a wide modal; agents and
  skills stay as cards.
- Interactive sessions are fire-and-forget: the skill validates and commits; the
  Console polls the docs. No finalize pipeline stage is needed because
  `authoringReadiness` treats a valid but untracked PRD as ready.

## Workstream A - `forge-grill-idea` skill

New package `templates/skills/forge-grill-idea/` (bootstrap copies skill
directories dynamically):

- `SKILL.md` - frontmatter plus process: read the idea and research, build a
  design tree, run rounds of the frontier, separate facts from decisions, stop
  at ungrillable questions, wait for the confirmation gate, rewrite
  `docs/IDEA.md` and the root compatibility copy, commit, and stop before PRD
  authoring.
- `references/grilling.md` - the rounds / frontier mechanics and the question
  format.

## Workstream B - Interactive authoring sessions

### Server (`scripts/forge-launcher/scripts/console/server.ts`)

- `POST /api/authoring/session { target, prompt? }`, gated by
  `options.allowExternalOpen`. Targets map to a skill invocation and an
  authoring stage used to resolve the runner and model:
  - `idea` -> `/forge-grill-idea …` (stage `prd`)
  - `prd` -> `/forge-auto-build-prd …` explicitly interactive (stage `prd`)
  - `feature-prd` -> `/forge-build-feature-prd I want to add <prompt> …`
    (stage `prd`)
- Resolve the runner with `selectedAuthoringRunner` and the model with
  `resolveAuthoringModel`, then launch via the injected `launchCli` seam and
  return a `LaunchCliResult`, mirroring `/api/model-plan/terminal`.
- `POST /api/authoring/validate { target }` (read-only) runs the bundled
  `validateAuthoredPrd` so the UI can offer a Validate action.

### Client API (`console/dashboard/api.ts`, `types.ts`)

- `startAuthoringSession(target, prompt?)` and `validateAuthoring(target)`.

### UI

- `views/overview.ts`: the pipeline's PRD step becomes interactive-first with a
  headless auto-draft secondary; Feature PRD and Feature Increment gain the
  interactive option. Overview is the **only** home for interactive authoring and
  for the Validate PRD action.
- `views/new.ts`: the auto-draft checkbox is relabeled as the headless path and
  defaults off. The wizard only bootstraps; interactive authoring happens from
  Overview after selecting the project.
- `views/documents.ts`: contained no authoring actions after review. Plan & Team
  is a read-only viewer; the Documents header was trimmed to the description and
  the wide-popup table.

> Scope correction during implementation: the interactive idea/PRD launchers and
> Validate PRD were first placed in Plan & Team and the new-project panel. They
> are now intentionally Overview-only to avoid duplicating pipeline actions.

## Workstream C - Render requirement/task blocks as tables

`console/dashboard/render/md.ts`:

- Capture the fence info string.
- `forge-requirement` -> `ID | Kind | Requirement`.
- `forge-task` -> `ID | Title | Owner | Depends on | Outputs`, with an
  expandable detail row for description, acceptance criteria, constraints,
  references, and validation commands.
- Merge consecutive same-type blocks separated only by blank lines; any other
  block closes the group.
- Fall back to the existing code block when JSON parsing fails.

## Workstream D - Documents table + wide popup

`console/dashboard/views/documents.ts`: replace the split-pane list/detail with a
scrollable table and open rows in a native `<dialog class="doc-dialog">` that
renders the document markdown at a readable width.

`console/dashboard/style.css`: add the wide dialog styles and minor `.md`
details styling.

## Workstream E - Tests

- Console server tests for `/api/authoring/session` and
  `/api/authoring/validate`.
- A Node test for `renderMarkdown` covering requirement/task tables and the
  malformed-JSON fallback.

## Workstream F - Docs, changelog, ADR

- `docs/updates.md` new version section and `README.md` `**Latest:**` bump.
- New ADR for interactive authoring entry points.
- Update `docs/forge-console.md`, `docs/forge-console-user-guide.md`,
  `docs/forge-console-screenshots.md`, and `docs/forge-launcher.md`.

## Verification

- `cd scripts/forge-launcher && npm install && npm run typecheck && npm test && npm run build`.
- Manual checks for the interactive buttons, the documents table/popup, and the
  requirement/task tables.

## Out of scope

- Interactive team and skills sessions (the endpoint pattern extends to them
  later).
- Automated screenshot regeneration.
