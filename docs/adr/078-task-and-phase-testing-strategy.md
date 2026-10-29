# ADR-078: Task and phase testing strategy

- **Status:** Accepted
- **Date:** October 2026
- **Related:** [ADR-077](077-strict-phase-completion-gates.md)

## Context

Structured tasks already declare `validationCommands`, while strict phase
contracts run phase-level validation after required tasks finish. Running a
complete repository suite after every small task can duplicate expensive work;
running only isolated tests, however, can miss integration regressions across
the phase. Selecting tests based only on changed file paths is unreliable when
test ownership and behavior cross file boundaries.

## Decision

1. **Task checks are focused and explicit.** Each task declares checks for its
   behavior and changed surface, mapped to its acceptance criteria. Checks
   should be targeted by default, with broader checks allowed for risky or
   cross-cutting work. The engine does not infer related tests from changed
   paths.
2. **Phase checks are comprehensive.** Phase-level validation declares the
   broader regression and integration checks for the combined phase. It runs
   after task work has integrated and before a strict phase gate can pass.
3. **Review follows successful validation.** If optional automated review is
   enabled, it reviews the integrated diff against acceptance criteria only
   after phase checks pass. Findings that cause implementation changes require
   rerunning the affected task checks and the complete phase checks before
   review can pass.
4. **Human review remains separate.** Automated code review does not satisfy a
   human-review task or its content-bound approval evidence.

## Consequences

- Task work gets quick, relevant feedback without automatically repeating the
  complete phase suite after each task.
- Phase completion remains protected by declared regression and integration
  checks; targeted task checks alone are not sufficient to release dependents.
- Test ownership and command selection remain author-authored and auditable.
  Poorly chosen or vacuous checks are not repaired by path-based inference.
- Automated review remains optional and is not implemented by this decision.

## Alternatives considered

- **Run the full suite after every task:** rejected as redundant for ordinary
  task-sized changes; targeted checks plus phase-boundary regression provide
  better separation of fast feedback and integration confidence.
- **Select tests automatically from changed paths:** rejected because file paths
  do not reliably encode behavioral ownership or cross-component interactions.
- **Review before phase validation:** rejected because review findings should
  inspect a phase that already passes its declared checks.

## References

- [Structured task contracts](../task-contracts.md)
- [Task authoring contract](../../templates/skills/forge-build-prd/references/task-contract.md)
- [Workflow engine](../workflow-engine.md)
- [Phase completion plan](../phase-completion-implementation-plan.md)
- [Changelog](../updates.md), v3.115
