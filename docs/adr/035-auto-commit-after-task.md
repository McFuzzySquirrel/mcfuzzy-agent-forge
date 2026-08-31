# ADR-035: Auto-Commit After Each Completed Task

**Date:** 2026-08-31
**Status:** Accepted
**Relates to:** ADR-023 (forge-launcher npm package), ADR-029 (output verification gate), ADR-032 (engine stop / config persistence)

---

## Context

The engine executes tasks from `docs/EXECUTION-MANIFEST.json`, one wave at a
time, writing state, audit, and progress files under `docs/`. When a run
finishes (or a user rolls back), the changes produced by each individual task
are indistinguishable — everything sits uncommitted in the working tree. There
is no attributable history aligned with the manifest's task decomposition, so
reviewing, bisecting, or reverting a single agent's work is hard.

The research plan ([`docs/research/auto-commit-after-task.md`](../research/auto-commit-after-task.md))
proposed auto-committing once per completed task, choosing **Option C** (commit
per task from `runEngine()`, sequenced after the wave merge) because it is safe
at any concurrency level — `executeTask()` itself runs inside a `mapLimit`
batch and must not touch git concurrently.

## Decision

The workflow engine auto-commits the working tree **after each task completes**,
with the following properties:

- **Default on.** Auto-commit is enabled by default (per product decision).
  `--no-auto-commit` / `FORGE_ENGINE_AUTO_COMMIT=0` disables it. This deviates
  from the research plan, which recommended opt-in; the team decided that a
  clear one-commit-per-task history is the expected behaviour, and the flag
  remains as the escape hatch for dirty-branch / mid-rebase scenarios.
- **Sequenced after the wave merge.** Commits happen in `runEngine()`, after
  `saveState()` + `syncProgressMd()`, iterating the tasks that just completed —
  never inside `executeTask()`. Safe with any `--concurrency`.
- **Stages everything.** `git add -A` scoped to the repo root, so the task's
  work and the engine-owned files (`docs/WORKFLOW-STATE.json`,
  `docs/EXECUTION-AUDIT.jsonl`, `docs/PROGRESS.md`) land in the same commit.
- **Attributable message.** Default
  `feat(forge-engine): complete task {taskId} - {taskTitle}`, overridable with
  `--commit-message-template` / `FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE` using
  `{taskId}` / `{taskTitle}` placeholders.
- **Non-fatal failures.** A missing `.git`, an empty diff ("nothing to commit"),
  or a failed commit (e.g. no git identity) is logged or skipped — it never
  fails the task or the run, since the task already completed.
- **Audit trail.** A new `task.committed` audit event records the commit SHA.
- **Configuration surfaces.** The flag is available on `workflow-engine run`,
  `forge-launcher engine-run`, and persists in `docs/engine-config.json`
  (new `autoCommit` field). The Forge Console exposes it as a checkbox on the
  Overview **Controls** panel, and the interactive launcher's engine
  configuration asks about it (default yes).

## Consequences

- Every run produces a clean, task-aligned commit history, making review,
  bisect, and rollback straightforward.
- The user must be aware that agent output is committed automatically; a
  pre-existing dirty working tree will be committed with the first completed
  task (use `--no-auto-commit` or start from a clean branch).
- Commit failures are by design invisible to the run's success — operators
  watching for commit problems must check `docs/EXECUTION-AUDIT.jsonl` for
  missing `task.committed` events.
- Replay of a failed task also commits when it completes, since it flows
  through the same completion path in `runEngine()`'s wave loop.
