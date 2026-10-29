# Phase Completion Real-Run Test Guide

Use this checklist to verify strict phase gates and task-level test discovery in
a disposable project before relying on them for a production workflow. Run on a
test branch or throwaway repository with a configured, repository-capable
harness. Do not use a project with uncommitted changes when testing concurrency.

## Before the run

- [ ] Update MyForge to the version containing strict phase gates and test
  discovery guidance.
- [ ] Ensure the target has canonical `docs/PRD.md` and `docs/features/*.md`,
  generated specialist agents, and a clean Git working tree.
- [ ] Recompile the execution manifest. Confirm newly compiled phases have
  `completionPolicy: "strict"` and list their required outputs and phase
  validation commands.
- [ ] Use a repository-capable harness. Test discovery is guidance in
  repository-task prompts; it is not an engine-side test selector.
- [ ] For an initial serial test, use the default concurrency (`1`). Test
  parallelism separately with `--concurrency 2` and a harness that supports
  concurrency.

## Suggested small test workflow

Create a throwaway feature with two sequential phases:

1. **Phase 1: implement a tiny behavior.** One task adds a small pure function
   (for example, normalizing a label) and its focused unit test. The task
   contract names the source and test outputs and has a validation command that
   runs only that test.
2. **Phase 1 gate:** add a phase-level command that runs the package's complete
   test suite. For the first run, deliberately make this command fail (for
   example, use a temporary failing test or an intentionally failing check).
3. **Phase 2: integrate the behavior.** A dependent task uses the function from
   Phase 1 in a tiny entry point and adds an integration test. Its task output
   should carry the Phase 1 implementation/test files into its handoff. The
   task should be able to identify relevant interaction tests from this
   dependency context.

Keep the phase-level failure controlled and local to the disposable test
project; do not corrupt the real project's test suite.

## What to check

### Task-level test discovery

- [ ] In the task execution request/log, confirm the repository task is told to
  inspect actual changed files, discover focused tests from repository scripts
  and nearby/source-referenced tests, and run those alongside declared
  validation commands.
- [ ] For Phase 2, confirm the task has access to carried-forward prerequisite
  artifact context, including the files changed by Phase 1, and considers
  relevant interaction tests rather than blindly rerunning every prior test.
- [ ] Confirm the agent does not execute commands copied from artifact contents
  and does not claim an unrun test passed.
- [ ] Remember: this is agent guidance. The engine machine-enforces declared
  validation commands; it does not independently verify every test the agent
  discovers or reported.

### Phase completion barrier and recovery

- [ ] Confirm Phase 1 task validation can pass while the deliberately failing
  phase-level command causes Phase 1's strict gate to fail.
- [ ] Confirm Phase 2 does not start while Phase 1's gate is failed, even
  though Phase 1's task is complete.
- [ ] Inspect `docs/WORKFLOW-STATE.json` for the failed phase status and
  actionable error. Inspect `docs/EXECUTION-AUDIT.jsonl` for the phase
  validation/failure event.
- [ ] Fix the phase-level failure and resume the same run. Confirm phase
  validation is retried and Phase 2 starts only after Phase 1 passes.
- [ ] Confirm the final state shows both phases complete and the expected
  outputs exist.

### Parallel execution (separate run)

- [ ] Make two independent features/phases with distinct owners and no
  dependency between them.
- [ ] Commit all setup changes so the working tree is clean, then run with
  `--concurrency 2` and a concurrency-capable harness.
- [ ] Confirm the independent tasks overlap in execution, both gates complete,
  and each output is integrated. Same-owner tasks and tasks with dependencies
  may still serialize.
- [ ] Do not use `--session-scope phase` for this test: phase-scoped session
  reuse requires concurrency `1`.

## Report back

Capture the MyForge version, harness, concurrency/session-scope settings, run
ID, whether the manifest was recompiled, and relevant task/phase statuses. Note:

- whether the focused task checks ran and how test discovery chose them;
- whether the dependent phase stayed blocked during the failing phase gate;
- whether resume reran phase validation before releasing the dependent phase;
- any missing, incorrectly selected, or repeated tests; and
- whether independent tasks actually overlapped in the separate concurrency
  run.

This test checks the declared contracts and orchestration. It cannot prove that
natural-language acceptance criteria are complete or that discovered tests
provide adequate coverage.

## References

- [Workflow engine and phase completion](workflow-engine.md#strict-phase-completion)
- [Task and phase testing decision](adr/078-task-and-phase-testing-strategy.md)
- [Phase completion implementation plan](phase-completion-implementation-plan.md)
