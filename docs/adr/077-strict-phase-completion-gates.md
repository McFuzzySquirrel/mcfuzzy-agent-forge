# ADR-077: Strict phase completion gates

- **Status:** Accepted
- **Date:** October 2026
- **Related:** [ADR-049](049-human-review-evidence-and-console-completion.md), [ADR-056](056-parallel-execution-task-sandboxes.md), [ADR-067](067-phase-scoped-session-reuse.md)

## Context

The workflow engine scheduled tasks from the manifest dependency graph and
treated terminal prerequisite tasks, including skipped tasks, as sufficient to
release dependent phases. Task-level outputs and validation existed, but there
was no durable check that a phase's required work and declared phase-level
checks had passed as one delivery boundary. A downstream phase could therefore
start even when a prerequisite phase's declared outcome had not been verified.

The compiler already creates phases from feature-document headings and orders
phases according to declared feature dependencies. Independent features can run
in parallel. Per-task worktrees support concurrent execution, while
phase-scoped session reuse requires serialized work. Human approval also has a
separate content-bound evidence path and must not be conflated with automated
validation or review.

## Decision

1. **Strict policy for newly compiled phases.** The compiler emits an explicit
   strict completion policy. Existing hand-authored manifests without that
   policy retain their task-terminal dependency behavior for compatibility.
2. **Required and optional work.** Tasks are required by default. Structured
   `forge-task` objects may set `required: false`; legacy task bullets may use
   the `[optional]` prefix. A skipped required task fails the phase gate.
3. **Phase exit contract.** Required task outputs become phase outputs.
   Validation commands declared in feature phase content become phase checks.
   The gate requires every required task to complete, every declared output to
   exist, and every phase check to pass.
4. **Durable dependency barrier.** Workflow state records phase lifecycle and
   gate evidence, while audit events record validation, completion, and failure.
   A dependent strict phase cannot start until each strict prerequisite phase
   passes. Contract changes and task replay invalidate affected gate state so a
   resumed run must establish completion again.
5. **Dependency-scoped concurrency.** Do not impose global phase ordering.
   Independent features and phases may still execute concurrently, using the
   existing per-task worktree isolation. Do not combine parallel worktrees with
   shared phase-session reuse; that mode remains serialized.
6. **Separate review and Git automation.** The phase gate is not human approval
   and does not perform an automated integrated-diff review. Automated review,
   phase branches, PR creation, and merging remain separately configurable
   future work.

## Consequences

- Newly compiled workflows fail closed when a required task is skipped, a
  required output is absent, or a phase validation command fails. Errors identify
  the phase and unmet condition, and dependent work remains blocked.
- Resumes and replays preserve the gate invariant; a completed task alone cannot
  satisfy an invalidated phase record.
- The engine verifies declared outputs and commands, not whether requirements
  or acceptance criteria were sufficiently decomposed or semantically met.
  Authors still need accurate dependencies and meaningful checks.
- Existing manifests remain compatible and do not gain strict phase semantics
  unless recompiled with the adapter.
- Independent phases retain concurrency, but phase-session reuse and concurrent
  task worktrees remain distinct execution modes.
- Automated review and branch/PR lifecycle concerns are not coupled to the
  initial completion contract.

## Alternatives considered

- **Keep task-terminal barriers only:** rejected because skipped required work
  and missing phase-level checks could release dependent phases.
- **Serialize all phases globally:** rejected because it unnecessarily removes
  concurrency between independent features.
- **Bundle review and branch/PR automation into the gate:** rejected because
  review policy, Git conflict recovery, permissions, and merge behavior require
  separate decisions and opt-in controls.

## References

- Phase contract and authoring: [Structured task contracts](../task-contracts.md)
- Engine behavior: [Workflow engine](../workflow-engine.md) and
  [workflow engine deep dive](../workflow-engine-deep-dive.md)
- Implementation tracking: [Phase completion plan](../phase-completion-implementation-plan.md)
- Compiler: `templates/skills/forge-execution-adapter/scripts/compiler.ts`
- Gate and state: `templates/skills/forge-workflow-engine/scripts/engine.ts`,
  `state.ts`, and `verify.ts`
- Changelog: [updates.md](../updates.md), v3.114
