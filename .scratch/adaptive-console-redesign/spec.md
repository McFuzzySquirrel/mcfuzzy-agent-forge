# Implement One Adaptive Forge Console

Status: ready-for-agent

## Problem Statement

The Console already exposes project authoring, build monitoring, review, and
technical controls, but the experience is organized around pipeline stages and
tool surfaces. A basic user encounters a dense setup form and must move between
authoring, review, and execution views without a clear guided path. The current
experience also makes it easy to confuse approving requirements, preparing a
Build, and explicitly starting execution.

Experienced developers need the detailed task, log, timeline, terminal, team,
and configuration surfaces to remain directly reachable. Making the Console
simpler must not remove those capabilities or change the workflow engine's
execution semantics.

## Solution

Reframe the Console as one adaptive workspace with a guided default path and a
stable Advanced area. Guide a user from an Idea through interactive Project
brief authoring and an explicit review checkpoint, then through preparation to
an explicit **Start build** action. Route existing Projects to their next
meaningful action, make the current Project's status and context persistent,
and retain detailed execution and configuration surfaces for experienced
developers.

The experience is responsive and keyboard- and screen-reader-usable. The Board
uses semantic HTML/CSS as its reliable baseline; visual enhancements are
optional. Existing launcher, authoring, and workflow-engine behavior remains
the source of truth.

## User Stories

1. As a basic user, I want one clear **Start with an idea** action on Home, so
   that I know how to begin.
2. As a returning user, I want Recent Projects and existing-application setup
   to remain available as secondary Home actions, so that a prominent start
   action does not hide work I already have.
3. As a new user, I want a Project workspace created as soon as I begin, so
   that my work is resumable even if I leave before authoring is complete.
4. As a new user, I want a suggested, editable Project name, so that naming
   does not block me from describing my Idea.
5. As a new user, I want to begin with only an Idea and leave nonessential
   details unknown, so that I do not have to invent technical answers.
6. As a new user, I want my authoring progress saved as I go, so that I can
   return to the same step after navigating away or closing the Console.
7. As a basic user, I want Idea exploration and Project-brief authoring shown as
   distinct phases of one interactive path, so that I understand what I am
   deciding and what the resulting Project brief means.
8. As a Project author, I want assumptions and open questions surfaced in the
   Project brief, so that uncertainty is visible instead of silently converted
   into requirements.
9. As a Project author, I want to review and edit an at-a-glance Project brief
   before anything is prepared, so that I can correct scope and success criteria.
10. As a Project author, I want **Request changes** and **Approve** to be
    separate, explicit review actions, so that approval cannot happen by
    accident.
11. As a Project author, I want approving the Project brief to authorize
    preparation only, so that no Build starts before I am ready.
12. As a Project owner, I want preparation presented as one guided background
    step with plain-language progress, so that I can tell what is happening
    without learning pipeline terminology.
13. As a Project owner, I want to see a concise prepared-plan summary, including
    major phases, assumptions, and items needing attention, so that I can make
    an informed decision before execution.
14. As a Project owner, I want to select **Start build** explicitly after
    preparation, so that approval of requirements is never mistaken for
    permission to execute.
15. As a Project owner, I want Build status to explain what is happening,
    whether anything is blocked, and what I can do next, so that I can orient
    without inspecting low-level task data.
16. As a user with a new Project, I want the Console to offer **Start with your
    idea**, so that I know the next action.
17. As a user with partially authored work, I want the Console to resume at the
    last saved authoring step, so that I do not repeat completed work.
18. As a user whose Project brief needs review, I want to land on that review,
    so that I can make the pending decision.
19. As a user whose Project is preparing, I want to see preparation progress
    without being offered an early Build start, so that the lifecycle remains
    clear.
20. As a user whose preparation is complete, I want the prepared-plan summary
    and **Start build** action, so that the final transition is deliberate.
21. As a user with a running Project, I want Build status to be the natural
    entry point, so that I can monitor progress and find my next action.
22. As a user with a blocked Project, I want the exact user action causing the
    block to be visible, so that I can resolve it without searching technical
    logs.
23. As a user with a failed Project, I want the failure stage and stage-specific
    recovery actions explained, so that I do not retry an unrelated or already
    completed stage.
24. As a user with a completed Project, I want to review its Project files, so
    that I can find the outputs without navigating task provenance.
25. As a user opening an existing repository, I want its current Project state
    mapped to the next meaningful action, so that an existing repository does
    not require a separate or misleading lifecycle.
26. As a user whose Project folder is unavailable, I want the Project to remain
    listed with a reconnect or recovery action, so that its history is not
    silently lost.
27. As a user following a bookmark, I want existing destination intent and
    query parameters preserved, so that saved links continue to reach the
    relevant Project surface.
28. As a user following a stale bookmark, I want the Console to explain why its
    target is unavailable and take me to the Project's next meaningful action,
    so that recovery is visible.
29. As a user, I want the selected Project switcher and Project context
    available on every view, so that I can switch Projects without losing track
    of which one I am viewing.
30. As a user, I want a bookmark or Task link to stay relative to the selected
    Project and never switch Projects implicitly, so that navigation cannot
    redirect me to unrelated work.
31. As a basic user, I want Build status, Board, Project brief, Project files,
    and a focused Tasks review queue to be direct Project destinations, so that
    I can reach common outcomes without opening Advanced.
32. As a reviewer, I want the focused Tasks queue to show Human review items,
    including why a review is waiting, so that I can act on the work that needs
    my judgment.
33. As a reviewer, I want Task-specific review criteria, evidence, and explicit
    approval to remain visible, so that a Human review is grounded in the
    current Task rather than a generic sign-off.
34. As an experienced developer, I want a visible Advanced group containing
    full Tasks, Logs, Timeline, Terminal, Plan & Team, and Settings, so that
    detailed execution remains discoverable without a separate product mode.
35. As an experienced developer, I want full Task diagnostics, dependency and
    artifact provenance, and configuration controls available in Advanced, so
    that I can investigate and control execution directly.
36. As a user, I want Project files to foreground useful documents and
    deliverables while detailed Task provenance remains in Advanced, so that
    the same output serves both a simple and a technical view.
37. As a basic user, I want the configured AI coding tool selected by default
    and explained in plain language, so that I can start safely without
    learning harness terminology.
38. As a user with no configured AI coding tool default, I want to choose one
    explicitly, so that the Console does not silently select an arbitrary tool.
39. As a basic user, I want detailed execution preferences, model choices,
    concurrency, timeouts, auto-commit, and harness-activity logging kept in
    Advanced, so that the guided path does not require technical configuration.
40. As a user changing a consequential setting, I want its effective behavior
    explained before Build start, so that safe defaults are not mysterious.
41. As a user, I want harness-activity logging off by default and its possible
    repository content disclosed, so that I can make an informed privacy choice.
42. As a user, I want stage-appropriate pause, resume, recovery, and confirmed
    Stop actions on Build status, so that execution controls are available when
    relevant and their impact is clear.
43. As a user with an existing Project, I want **Add a feature** to remain
    available contextually, so that I can extend the Project without learning
    manifest or agent-update mechanics.
44. As a user adding a feature, I want to author it interactively and review
    its generated Tasks before they run, so that new work remains additive and
    deliberate.
45. As a user monitoring work, I want Kanban and Gantt to remain peer Board
    views with shared Task summaries and action cues, so that neither view is
    hidden behind an expertise mode.
46. As a user, I want selecting a Task in either Board view to open the same
    compact details with its blocker and next action, so that switching views
    does not change how I understand a Task.
47. As a user, I want Board selection, filters, and per-view position preserved
    when switching views or refreshing, so that I do not lose my place.
48. As a user, I want a semantic Task control for every visual Board card or
    bar, so that pointer-only visuals are never the only way to reach Task
    details.
49. As a keyboard user, I want Task selection to move focus into details and
    closing details to return focus to the originating Task, so that I can
    navigate the Board without a pointer.
50. As a screen-reader user, I want dependency and artifact relationships
    presented as structured text and significant state changes announced, so
    that the Board's meaning is available without interpreting canvas lines or
    routine progress noise.
51. As a user, I want wide, medium, and narrow layouts to adapt navigation and
    Task details to available space, so that I can retain Project context on
    different devices.
52. As a narrow-screen user, I want a labeled navigation drawer, horizontally
    navigable Kanban columns with visible phase labels, and a full-screen Task
    detail view, so that important context remains usable on a small display.
53. As a user switching Board views or filtering Tasks, I want logical focus
    retained when the selected Task is still available, so that rerendering
    does not strand keyboard navigation.
54. As a user who encounters an error, I want failures and cleared blockers to
    remain visible and actionable, so that transient animation or navigation
    does not hide important state.

## Implementation Decisions

- Evolve the existing tsc-only TypeScript Console client and its launcher-backed
  server rather than introducing a separate frontend framework or application.
- Treat the Console as a projection and interaction layer over existing
  Project files and APIs. Do not change the workflow engine, manifest contract,
  or backend execution semantics to achieve the new presentation.
- Organize global Home and Projects separately from current-Project
  destinations. Keep Build status, Board, Project brief, Project files, and
  focused Tasks review directly available; place full Tasks, Logs, Timeline,
  Terminal, Plan & Team, and Settings under a visible Advanced group.
- Keep the Project switcher and current-Project status persistent. Preserve
  existing route intent and query parameters, map old destinations by intent,
  and explain any fallback when a saved target is no longer available.
- Implement the New Project experience as resumable, clearly marked Idea and
  Project-brief authoring phases. Keep requirements authoring interactive and
  use the supported authoring runner; do not reintroduce headless PRD
  generation. Preserve the active step and progress when the user returns from
  the authoring session.
- Use a separate, editable Project brief review in normal page flow, with
  distinct **Request changes** and **Approve** actions. Approval authorizes
  preparation only; preparation must finish before the user receives the
  separate **Start build** action.
- Keep Project brief approval distinct from a runtime Human review Task.
  Runtime reviews continue to use the existing Task-bound evidence and
  approval contract.
- Route each Project lifecycle state to its decided next action: new,
  partially authored, needs review, preparing, ready to start build, running,
  blocked, failed, or completed. Preserve in-progress work through recovery and
  retain existing Project history.
- Keep **Add a feature** contextual for Basic users, with interactive
  authoring and review of generated Tasks before execution.
- Make the semantic HTML/CSS Board the reliable baseline and keep PixiJS
  optional. Kanban and Gantt share Task data, detail behavior, selection,
  filters, and persisted per-view position.
- Implement responsive ranges as content-driven: wide above 1050px, medium
  from 721–1050px, and narrow at 720px or below. Use full navigation on wide
  screens, a compact rail on medium screens, and a labeled drawer/menu on
  narrow screens.
- Preserve the Board's keyboard and screen-reader contract: semantic Task
  controls, focus continuity, structured relationship text, and concise
  announcements for significant changes. Do not announce routine progress
  updates or animation.
- Keep Project execution preferences, authoring runner/model choices,
  per-agent overrides, detailed Task controls, and low-level operations under
  Advanced. Explain consequential effective behavior and preserve safe defaults.
- Preserve current terminal, task execution, and artifact capabilities; the
  redesign changes information architecture and presentation, not their
  underlying contracts.

## Testing Decisions

- Use one high-level seam: browser-driven acceptance scenarios against the
  actual Console server and deterministic fixture Projects, using stubbed
  authoring and launcher processes. Assert user-visible behavior and resulting
  Project state, not CSS classes, renderer internals, or component structure.
- Cover the Idea-to-Running path, including the distinction between Project
  brief approval, preparation, and explicit Build start. Verify no Build starts
  before **Start build**.
- Cover resume, state-aware entry, blocked and failed recovery, Project
  switching, stale destinations, and Add a feature review-before-run behavior.
- Cover Basic and Advanced navigation, direct access to every Advanced
  destination, and preservation of Project context.
- Exercise wide, medium, and narrow layouts at the existing capture sizes;
  include keyboard Task selection, focus restoration, relationship text, and
  significant state announcements.
- Keep focused server/API tests for safety and process-boundary contracts that
  cannot be observed reliably through the browser seam. Do not duplicate every
  client detail with low-level implementation tests.
- Prior art is the deterministic Puppeteer Console capture harness and the
  launcher Console server tests that use fixtures and fake process launching.
  Extend those seams for behavioral assertions and retain screenshot captures
  as visual evidence.
- Human validation uses separate cohorts: Basic participants are unfamiliar
  with Forge's detailed execution surfaces but may be technically experienced;
  Experienced participants are comfortable with AI coding tools and technical
  execution controls. At least 4 of 5 representative users in each cohort must
  complete each applicable scenario without facilitator help. Any critical
  lifecycle, Project-context, or accessibility failure blocks acceptance; no
  arbitrary time limit applies.

## Out of Scope

- Changing workflow-engine scheduling, phase/task contracts, manifest
  semantics, or backend Build behavior.
- Making requirements authoring headless, skippable, or implicitly approved.
- Replacing or removing the supported terminal, task execution, artifact, or
  CLI capabilities.
- Making PixiJS a requirement for accessing the core Board experience.
- Adding remote authentication or moving the loopback-only Console to a
  network-facing service.
- Replacing the project registry or changing its data ownership and retention
  behavior.

## Further Notes

- This is a fresh implementation effort. The completed planning map,
  [Reframe Forge Console for Basic and Experienced Users](../ui-relook-basic-experienced/map.md),
  is its design reference; implementation remains out of scope for that map.
- The Home primary-action slice is already implemented in the current worktree.
  This spec covers the remaining adaptive Console redesign as well as that
  initial slice.
- Preserve the accepted interactive requirements-authoring constraint in
  ADR-060 and the Task-bound Human review evidence contract in ADR-049.
  Reconcile the new navigation and semantic Board baseline with the existing
  Console and Board decisions in ADR-075 and ADR-063, adding or amending an ADR
  where the architectural change warrants it.
- The local Markdown tracker has no separate label service; `Status:
  ready-for-agent` records the requested triage state for this spec.
