# Reframe Forge Console for Basic and Experienced Users

## Destination

A decision-ready UX direction for one adaptive Forge Console: a basic user can move from an idea through requirements review to a running project, while experienced developers retain direct access to detailed execution and configuration surfaces.

## Notes

- Issue tracker: local Markdown under `.scratch/`.
- Consult `AGENTS.md`, `docs/agents/issue-tracker.md`, and `docs/agents/domain.md` before working.
- This is a planning map, not an implementation plan. Tickets resolve design decisions; implementation begins after the route is clear.
- Current Console concepts include Home, Projects, New project, Overview, Board, Tasks, Logs, Timeline, Plan & Team, Artifacts, Terminal, and Settings.
- The current Board is an iframe-hosted PixiJS Kanban/Gantt surface with pan/zoom, filters, dependency/artifact edges, and an HTML Tasks fallback.
- The agreed direction so far is one adaptive information architecture, progressive disclosure, outcome-oriented language, an explicit requirements-review checkpoint, state-aware entry for existing repositories, and safe technical defaults.

## Decisions so far

- [Define the guided project lifecycle](issues/01-guided-lifecycle.md): One continuous, resumable, interactive path takes an idea through an approved Project brief to an explicitly started build.
- [Shape goal-oriented navigation and the expert escape hatch](issues/02-navigation-and-expert-escape-hatch.md): Basic navigation centers project goals and human review; Advanced keeps full execution detail available without a separate mode.
- [Design the requirements review checkpoint](issues/03-requirements-review-interaction.md): Guided steps lead to a separate, editable Project brief review before the user explicitly starts a build.
- [Define state-aware project entry](issues/04-state-aware-project-entry.md): Nine Project states route to their next meaningful action, including user-actionable blockers and stage-specific failure recovery.
- [Set the progressive-disclosure boundary](issues/05-advanced-controls-boundary.md): Basic explains consequential behavior, keeps harness choice and **Add a feature** accessible, while Advanced holds detailed technical controls.
- [Define the shared Board information model](issues/06-board-information-model.md): The Board foregrounds human action, failures, and next steps, with clear responsibility and immediate blocker cues.
- [Choose the reliable Board rendering baseline](issues/07-board-rendering-baseline.md): Use semantic HTML/CSS lanes as the reliable default; visual enhancements are optional.
- [Define Kanban and Gantt parity](issues/08-kanban-and-gantt-parity.md): Both views share task summaries and detail behavior while preserving selection, filters, and per-view position.
- [Define responsive Console and Board behavior](issues/09-responsive-console-and-board.md): Navigation, Board scrolling, and Task details adapt to content-driven wide, medium, and narrow layouts without losing context.
- [Define the Board accessibility contract](issues/10-board-accessibility-contract.md): Semantic Task controls, focus continuity, readable relationships, and concise live announcements make both views usable without pointer-only interaction.
- [Define the existing-Project transition](issues/11-existing-project-transition.md): Preserve bookmark intent and current-Project context; recover stale destinations visibly and carry forward only valid Board preferences.
- [Define Console redesign validation criteria](issues/12-redesign-validation-criteria.md): Validate the Basic and Experienced tracks with observable task scenarios, cross-cutting responsive/accessibility checks, and explicit pass thresholds.
- The destination is one adaptive Console with a guided default path for basic users and accessible advanced capabilities.
- The first-session success milestone is idea → requirements review → build.
- Advanced controls remain available through progressive disclosure, not a separate product mode.
- User-facing language leads with project/workspace goals; pipeline terminology appears contextually.
- Home should emphasize one primary start action.
- Requirements should be a staged flow with a persistent summary, while technical inputs live under Advanced settings.
- Running-project Overview should answer what is happening, whether anything is blocked, and what the user can do next.
- The beginner lifecycle should translate the real pipeline into plain-language steps.
- Requirements review is an explicit, reversible approval checkpoint.
- Basic users should not need to choose technical configuration.
- Detailed execution surfaces remain available through a stable expert escape hatch.
- The Board must support both live-status monitoring and decision-making about what needs attention next.
- Kanban and Gantt remain peer board choices; neither is being hidden solely because the user is a beginner.
- PixiJS must not be required for the core Board experience; semantic HTML/CSS is the reliable baseline and PixiJS may be progressive enhancement.
- Every visual Board interaction needs a keyboard- and pointer-accessible path to task detail, with state that survives refresh.

## Not yet specified

None currently identified.

## Out of scope

- Implementing the redesigned UI in this map.
- Changing the workflow engine, manifest contract, or backend execution semantics.
- Replacing the existing terminal, task execution, or artifact capabilities.
