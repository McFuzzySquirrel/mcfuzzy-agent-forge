# ADR-081: Adaptive Project lifecycle and explicit Build-start gates

**Date:** 2026-11-04
**Status:** Accepted
**Relates to:** ADR-049 (Human Review Evidence and Console Completion), ADR-060 (Requirements authoring is always interactive), ADR-080 (Semantic HTML baseline for the Console Board)

## Context

The Console exposed authoring, review, preparation, execution, and technical
controls as separate pipeline surfaces. That made it easy to confuse approval
of a Project brief with approval of a runtime Human review Task, or to mistake
preparing a Build for permission to execute it. Returning users also needed the
selected Project and its next meaningful action to remain clear while moving
between global, Project, and technical views.

## Decision

- Organize navigation into global **Home** and **Projects** destinations,
  current-Project destinations, and a visible **Advanced** group. Keep the
  selected Project context persistent; ordinary links do not switch Projects.
- Map each Project's existing lifecycle to its next useful action. New,
  partially authored, review, preparation, ready-to-start, running, blocked,
  and failed states use Build status; completed Projects open Project files.
  The persistent switcher and Projects list use the same destination rule.
  Existing repositories enter this lifecycle at their current state.
- Keep requirements authoring interactive and the Project brief review
  editable. **Approve** authorizes preparation only. After preparation is
  complete, show the prepared plan and require the separate **Start build**
  action before sending the existing Build-run request.
- Keep runtime Human review Task-bound under ADR-049. Confirm **Stop** before
  issuing the existing stop action; canceling sends no stop request.
- Keep these rules in the Console's navigation and interaction layer. Do not
  change workflow-engine scheduling, manifest contracts, or execution
  semantics.

## Consequences

Users can return to a Project through the same lifecycle-aware entry point
whether they use the Projects list or persistent switcher. Brief approval,
preparation, runtime Human review, and Build execution remain distinct visible
decisions. The additional explicit Start build and Stop confirmation add an
interaction, but prevent approval or accidental clicks from authorizing
execution or termination. Technical execution surfaces remain available under
Advanced without creating a separate product mode.

## Alternatives considered

- **Keep stage-oriented navigation and add another Overview panel.** Rejected
  because it retains the pipeline-first mental model and obscures Project
  outcomes and technical escape hatches.
- **Let brief approval start execution, or start automatically when preparation
  completes.** Rejected because both collapse requirements approval and
  execution authorization into one decision.
- **Route every Project to the same Overview state.** Rejected because a
  completed Project's useful destination is its delivered files, and the
  switcher should behave like the Projects list.
- **Change engine or manifest semantics to enforce the Console flow.** Rejected
  because the redesign is a presentation and interaction layer over existing
  launcher and workflow contracts.

## References

- Navigation and routing: `scripts/forge-launcher/scripts/console/dashboard/main.ts`, `dashboard/project-navigation.ts`
- Brief review, prepared plan, and run controls: `scripts/forge-launcher/scripts/console/dashboard/views/overview.ts`
- Browser acceptance: `tools/console-screenshots/src/adaptive-review-acceptance.test.ts`
- Console help: `scripts/forge-launcher/scripts/console/dashboard/views/help.ts`
- User guidance: `docs/forge-console.md`, `docs/forge-console-user-guide.md`, `docs/forge-console-screenshots.md`, `docs/testing-guide.md`, `tools/console-screenshots/README.md`
