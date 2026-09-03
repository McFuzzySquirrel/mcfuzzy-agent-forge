# Existing Repository and Incremental Build Plan

**Status:** Complete
**Relates to:** Forge Console, forge-launcher, forge-execution-adapter, forge-workflow-engine

## Objective

Make MyForge useful from an existing application repository as well as from a
new project. A user should be able to bootstrap a repository from the Console,
author a project PRD that understands the code already present, add Feature PRDs
after a build is complete, and execute only the new work without losing prior
task state.

## Decisions

1. Existing-repository bootstrap is a first-class Home action.
2. Bootstrap never overwrites existing forge files unless the user explicitly
   enables force/overwrite.
3. A non-Git directory may be initialized only after explicit confirmation;
   non-interactive callers must pass `--init-git` (or the equivalent setting).
4. Project PRDs use `forge-build-prd` with explicit existing-codebase context.
5. Feature PRDs use `forge-build-feature-prd` and are additive.
6. `docs/EXECUTION-MANIFEST.json` remains the canonical manifest. Recompilation
   preserves completed state for stable task IDs and adds new tasks as pending.
7. Authoring jobs remain launcher jobs, not workflow-engine tasks. They use the
   same Console SSE/log projection as engine jobs.
8. `xdg-open` is optional on Linux. Missing desktop open support must never block
   headless or manual workflows.
9. A changed task contract is preserved as complete but is surfaced as a review
   warning; it is not silently re-executed.

## Delivery Phases

### 1. Existing repository bootstrap

- Add a Home and Projects action for bootstrapping an existing folder.
- Validate the path, Git state, harness, and overwrite choice.
- Track bootstrap as a background job with a repository-local log.
- Register and select the repository after successful bootstrap.

### 2. Existing-project authoring

- Add a project-PRD action that asks the harness to inspect the existing code,
  documents, tests, conventions, and current team.
- Add a Feature PRD action for completed and in-progress projects.
- Store Feature PRDs under `docs/features/` without replacing the original PRD.
- Surface review, failure, and log states in the Console.

### 3. Incremental team and manifest execution

- Run Feature Increment Mode for affected agents only.
- Reconcile the canonical execution manifest by stable task ID.
- Preserve completed task records when the manifest is regenerated.
- Warn about removed, changed, duplicate, or orphaned tasks.
- Allow the Console to run the newly pending feature tasks.

### 4. Unified authoring observability

- Normalize authoring logs under the selected repository's `docs/` directory.
- Stream bootstrap, PRD, team, and compile output through Console SSE.
- Keep structured workflow audit events owned by the workflow engine.
- Keep plain process output and authoring lifecycle events owned by the launcher.

### 5. Documentation and verification

- Document existing-repo bootstrap, feature increments, manifest reconciliation,
  and `xdg-open` fallback behavior.
- Add unit, integration, and Console smoke coverage for each path.

## Acceptance Criteria

- Home offers Create, Bootstrap Existing, and Open Existing.
- Bootstrapping a non-empty Git repository leaves application files untouched.
- Non-Git directories require explicit Git initialization confirmation.
- Existing projects can produce a context-aware PRD or a Feature PRD.
- Completed projects continue to offer Add Feature.
- Recompiling after a Feature PRD does not reset completed task state.
- New feature tasks can be selected and run independently.
- PRD and team generation output is visible live in Console Logs.
- Missing `xdg-open` produces a manual URL/path fallback, not a failure.

## Operational Semantics

- `feature-increment --run` selects only task IDs emitted by the newly authored
  feature documents. Unrelated pending work remains untouched.
- If Feature PRD authoring exits successfully without creating a new,
  non-empty Markdown document, the increment stops before team or manifest work.
- Reconciliation reports preserved, new, removed, and changed task IDs in the
  manifest and Console. Changed completed tasks remain complete but require
  review before a user chooses to replay or reset them.
- A failed Feature PRD or team update leaves the existing PRD, team, and
  manifest available for inspection; the next attempt can be started from the
  failed stage.
- Manifest dependency validation rejects duplicate global task IDs and reports
  orphan task or phase dependencies before execution.
