# ADR-053: Reachability, Live Integration, and Validation-Gap Visibility

Status: Accepted

## Context

Passing component tests does not prove that a feature is mounted in the
application or that mocked API contracts match the live service. Nonblocking
validation limitations already survive in task artifacts, but operators need
to see them in progress reports and when reviewing dependent work.

## Decision

- Require authoring to name a composition root in task outputs and an
  acceptance check through that entry point. External-service features need a
  dependent live integration task, or a human-review task with explicit live
  checks when credentials cannot be supplied to the engine. Unverified API
  details belong in Open Questions, not silently assumed contracts.
- Require human reviews of user-facing features to exercise the primary user
  journey against the running system. Console evidence notes must contain at
  least 40 characters after trimming; this is a minimum input-quality check,
  not proof that meaningful review occurred.
- Persist successful task reports' optional `validationLimitations` in workflow
  state. Project completed, in-scope tasks' limitations into a **Validation
  Gaps** section and count without changing workflow status values.
- Show human reviewers gaps from transitive task and prerequisite-phase
  dependencies. Deduplicate shared prerequisite tasks across both edge types.
  Keep reported gaps after approval so the original validation scope remains
  visible.

## Compatibility and Consequences

No manifest schema migration is required. Older state files and reports without
limitations remain valid, but their missing data is not proof that every check
ran. Historical reports are not backfilled. A successful replay replaces the
task's limitations; omitting them on success clears the previous list.

Authoring guidance and human judgment establish semantic coverage. The compiler
does not prove reachability or live integration, and the note-length check does
not authenticate reviewers. Required unverified checks remain blockers and
must not be recategorized as nonblocking limitations.

The CLI approval path continues to accept nonempty repository-local evidence
under the existing attestation contract. The new length check applies to
Console-written notes. Update installed engine and launcher copies together to
get both persistence and display; existing projects require no state rewrite.

## Alternatives Considered

- Block every task with a validation limitation: rejected because limitations
  describe non-required checks; unmet required checks already block completion.
- Keep caveats only in artifacts: rejected because operators can overlook them
  during progress inspection and human review.
- Traverse only explicit task dependencies: rejected because the engine also
  waits for prerequisite phases, which may contain unverified integrations.
- Treat a longer note as proof of review: rejected; task-bound evidence and an
  explicit human attestation remain necessary.

## Branch Review

Reviewed on `feat/reachability-validation-gaps` for v3.82.

- Found and fixed a Console projection defect: phase-only prerequisite chains
  returned no upstream gaps. Regression coverage reproduces the omission and
  checks both transitive phases and overlapping task/phase dependencies.
- Moved the new release notes out of the already published v3.81 section into
  v3.82 and synchronized the README release indicator.
- Added exact 39/40-character and whitespace-trimming evidence-note checks,
  alongside existing Console API and engine persistence/progress regressions.

### Verification

- Workflow-engine and launcher `npm run typecheck` passed, including the
  launcher's browser TypeScript configuration.
- Engine and task-context suites: 67 tests passed.
- Console authoring suite: 17 tests passed, including the phase-dependency
  regression, which failed before the fix.
- Launcher, Console, dashboard-state, and version-consistency suites: 74 tests
  passed.
- Browser interaction and live external-service validation were not performed
  as part of this review. The tests validate framework behavior with local
  fixtures, not the live integrations of projects authored with the framework.

## References

- [Task contracts](../task-contracts.md)
- [Authoring contract](../../templates/skills/forge-build-prd/references/task-contract.md)
- [Console human review](../forge-console-user-guide.md#human-review-when-it-pauses-and-how-to-prove-approval)
- [Workflow engine](../workflow-engine.md#output-files)
- [Engine state and progress internals](../workflow-engine-deep-dive.md#keeping-everything-in-sync-state--progress--audit)
- [ADR-049: Human Review Evidence and Console Completion](049-human-review-evidence-and-console-completion.md)
