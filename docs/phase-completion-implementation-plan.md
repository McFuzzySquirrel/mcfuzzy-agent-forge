# Phase-Complete Execution Plan

## Goal

Treat each execution phase as a verifiable delivery boundary. A dependent phase
must not start merely because its prerequisite tasks are terminal: the required
tasks, outputs, and phase-level validations must all pass first. Preserve
concurrency between independent features and keep existing hand-authored
manifests compatible.

## Findings

- The compiler turns feature phase headings into manifest phases. Phases within a
  feature are ordered; feature dependencies determine ordering between features.
- The engine already gates a phase dependency on every task in that phase, but
  currently treats both `complete` and `skipped` as sufficient. It has no
  phase-level output or validation gate, despite the manifest carrying
  `approvalGates.betweenPhases`.
- Existing per-task validation, isolated worktrees, phase-scoped sessions, and
  content-bound human-review attestations are useful foundations. Phase-scoped
  session reuse and parallel worktrees remain mutually exclusive.
- A report of work “carrying over” can also indicate missing task dependencies,
  incomplete decomposition, or weak acceptance criteria. Phase barriers cannot
  compensate for an inaccurate manifest.

## Implementation checklist

### 1. Diagnose and define completion

- [x] Record the current scheduler/compiler behavior and compatibility
  constraints.
- [ ] Reproduce representative phase spillover reports and classify them as
  dependency, decomposition, contract, or missing phase-validation issues. No
  representative run or manifest was supplied, so this incident-level diagnosis
  remains open.
- [x] Define a phase as complete only after required tasks, declared outputs,
  and phase-level validation pass.
- [x] Keep the default barrier dependency-scoped; independent features may still
  execute concurrently.

### 2. Strengthen phase and task contracts

- [x] Expose authoring guidance for declaring optional tasks and phase-level
  checks in feature documents.
- [x] Ensure generated manifests make phase exit requirements explicit.
- [ ] Surface likely missing dependencies or incomplete task breakdowns; this
  implementation does not infer or repair an underspecified dependency graph.
- [x] Keep required tasks distinct from optional tasks; a skipped required task
  cannot satisfy a strict phase gate.

### 3. Add a durable phase-completion gate

- [x] Persist phase lifecycle and validation evidence in workflow state.
- [x] Validate phase outputs and run phase validations after its tasks finish.
- [x] Block dependent phases until strict prerequisite phases pass.
- [x] Preserve this behavior across resume, manifest reconciliation, and replay;
  report gate failures with actionable phase and criterion details.

### 4. Preserve safe delegation and parallel execution

- [x] Retain isolated per-task worktrees and overlap detection for concurrent
  tasks.
- [x] Keep phase-session reuse serialized; do not combine it with parallel
  worktrees without a shared-project isolation design.
- [x] Test that gate completion does not serialize independent phases; existing
  task-worktree isolation and overlap detection remain unchanged.

### 5. Add optional automated phase review

- [ ] Design an opt-in reviewer that inspects the integrated phase diff and its
  acceptance criteria after validation.
- [ ] Define blocking thresholds and return findings to implementation work.
- [ ] Keep agent review distinct from human approval; human approval continues to
  use the canonical content-bound attestation.

### 6. Add optional phase branches and PR policy

- [ ] Design branch naming, base selection, commits, resume, cleanup, and
  conflict recovery.
- [ ] Start with optional branch isolation and manual PR creation.
- [ ] Consider automatic PR creation or merging only as a separately configured
  follow-up with explicit validation/review and operator controls.

### 7. Roll out and document

- [x] Add regression tests for skip policy, validation failures, resume/replay,
  dependency barriers, and independent phases.
- [ ] Pilot strict gates on a representative workflow.
- [x] Update canonical authoring guidance, workflow-engine documentation,
  changelog, and ADRs with the implemented behavior.

## Implemented behavior and limits

- Newly compiled phases opt into strict completion policy. Hand-authored or older
  manifests without that policy retain task-terminal dependency semantics.
- A strict gate requires every non-optional task, all required outputs to exist,
  and every declared phase validation command to pass. This is an execution
  contract, not proof that natural-language acceptance criteria are complete.
- Phase records and audit events survive resume; changes to gate inputs and task
  replay invalidate the affected phase and downstream gate records.
- No real-world spillover report was available for reproduction. Strict gates
  prevent dependent phases from proceeding on incomplete declared work, but do
  not automatically discover missing task dependencies or poorly decomposed
  requirements.
- Automated code review and phase-branch/PR automation are intentionally not
  implemented in this change; see follow-up sections below.

## Scope and sequencing

Implement the completion contract and durable dependency gate first. Reuse
existing task-level worktree isolation and phase-session behavior rather than
redesigning them in the same change. Automated review and phase-branch/PR
automation are follow-up capabilities; they should not be required for a phase
to pass its initial completion gate.

## References

- [Workflow engine](workflow-engine.md)
- [Workflow engine deep dive](workflow-engine-deep-dive.md)
- [ADR-077: Strict phase completion gates](adr/077-strict-phase-completion-gates.md)
- [ADR-049: Human review evidence](adr/049-human-review-evidence-and-console-completion.md)
- [ADR-056: Parallel task sandboxes](adr/056-parallel-execution-task-sandboxes.md)
- [ADR-067: Phase-scoped session reuse](adr/067-phase-scoped-session-reuse.md)
