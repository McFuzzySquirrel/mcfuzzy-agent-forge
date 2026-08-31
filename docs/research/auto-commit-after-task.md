# Research & Plan: Auto-Commit After Each Completed Task

**Date:** August 2026  
**Status:** Research / Pre-implementation

---

## 1. Problem Statement

After each task completes successfully in an engine run, the changes produced by that task should be automatically committed to the git repository. This creates a clear, attributable commit history aligned with the task decomposition in the manifest — one commit per task — making it easy to review, bisect, or roll back work produced by individual agent tasks.

---

## 2. Codebase Overview

### Relevant Files

| File | Role |
|---|---|
| `templates/skills/forge-workflow-engine/scripts/engine.ts` | Core engine: `executeTask()` and `runEngine()` loop |
| `templates/skills/forge-workflow-engine/scripts/types.ts` | `EngineOptions`, `ManifestTask`, `TaskRecord`, `AuditEvent` |
| `templates/skills/forge-workflow-engine/scripts/verify.ts` | `captureWorktree()` — already runs `git status --porcelain`; `runTaskValidation()` — runs arbitrary shell commands via `runCommand()` |
| `templates/skills/forge-workflow-engine/scripts/harness/run.ts` | `runCommand()` — cross-platform async command runner |
| `templates/skills/forge-workflow-engine/scripts/cli.ts` | CLI flag parsing; builds `EngineOptions`; `flag()` / `hasFlag()` helpers |
| `templates/skills/forge-execution-adapter/scripts/types.ts` | `ManifestTask` schema |

### Current Task-Completion Flow in `executeTask()`

The key path after a harness call succeeds and output verification passes:

1. Optionally create an artifact (`store.synthesise()`).
2. `markTaskComplete()` — updates `WorkflowState`.
3. `writeAuditEvent()` with `action: "task.complete"`.
4. `console.log(...)` and `return currentState`.

**No git commit occurs here today.** The `runEngine()` loop then merges results, calls `saveState()` + `syncProgressMd()`, and moves to the next wave.

### Existing Git Infrastructure

`verify.ts` already uses `runCommand("git", ["status", ...])` to detect file changes. The same `runCommand()` helper (from `harness/run.ts`) can run `git add` and `git commit` with no new dependencies.

`captureWorktree()` already guards against non-git directories (`!existsSync(join(repoRoot, ".git"))`), so the same guard pattern can protect the auto-commit path.

---

## 3. Design Decisions

### 3.1 Where to Commit

**Option A — Inside `executeTask()`, immediately after `markTaskComplete()`.**  
*Pro:* Atomic with the state update; failure to commit doesn't affect state.  
*Con:* `executeTask()` runs inside a `mapLimit` concurrency batch; if `maxConcurrency > 1`, two tasks may try to commit in parallel, causing a git conflict.

**Option B — In `runEngine()` after each wave's results are merged back.**  
*Pro:* Happens once per wave, always sequential; safe with any concurrency level.  
*Con:* If multiple tasks complete in the same wave, they share one commit (or require iterating and committing once per completed task).

**Option C — Commit per-task from `runEngine()`, iterating completed tasks after each wave.**  
*Pro:* One commit per task, always sequential, correct with concurrency.  
*Con:* Slightly more code.

**Recommendation: Option C.** Commit each newly-completed task in `runEngine()` after each wave merge, iterating over the tasks that just completed. This is safe regardless of concurrency and still produces one commit per task.

### 3.2 What to Stage and Commit

- Stage all changes produced by the task: `git add -A` scoped to the repo root is the simplest approach. Because the engine already saves `WORKFLOW-STATE.json`, `EXECUTION-AUDIT.jsonl`, and `PROGRESS.md` each wave, these engine-owned files will be in the working tree at commit time. They **should be included** in the commit (they reflect the task's completion) unless the user explicitly excludes them.
- The commit message should be task-attributable: e.g.  
  `feat(engine): [task-id] task title`  
  or a configurable template.

### 3.3 Opt-In vs Default

Auto-commit should be **opt-in** (default off). Reasoning:
- Not every run is in a clean-branch context. Users may be mid-rebase or running with uncommitted changes they don't want mixed with agent output.
- Backwards compatibility: no change to existing behaviour unless the flag is passed.

Proposed flag: `--auto-commit` / env `FORGE_ENGINE_AUTO_COMMIT=1`.

An optional commit message template flag could be added later: `--commit-message-template`.

### 3.4 Commit Message Format

Default template: `feat(forge-engine): complete task {taskId} - {taskTitle}`

This can be made configurable via a `--commit-message-template` flag or `FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE` env var with `{taskId}` and `{taskTitle}` placeholders.

### 3.5 Nothing to Commit

If no files changed (e.g. the no-op heuristic was bypassed via `--allow-noop` or the only changes are engine-owned files already committed), `git commit` will exit non-zero. The implementation must handle this gracefully — detect "nothing to commit" and skip rather than treating it as an error.

### 3.6 Skipped / Failed Tasks

Auto-commit should only run when a task transitions to `"complete"`. Skipped or failed tasks should not trigger a commit.

### 3.7 New Audit Event

A new audit action `"task.committed"` should be emitted (alongside `"task.complete"`) to record that a commit occurred. This extends the `AuditEvent` union in `types.ts`.

---

## 4. Implementation Plan

### Step 1 — Extend `AuditEvent` in `types.ts`

Add `"task.committed"` to the `action` union of `AuditEvent`. Optionally add a `commitSha?: string` field so the audit log records the exact commit hash.

### Step 2 — Add `autoCommit` to `EngineOptions` in `types.ts`

```
autoCommit: boolean;
commitMessageTemplate?: string;  // optional, defaults to built-in format
```

### Step 3 — Add a `commitTaskWork()` helper (new file or in `verify.ts`)

A small async function `commitTaskWork(taskId, taskTitle, repoRoot, template)` that:

1. Guards: `if (!existsSync(join(repoRoot, ".git"))) return;`
2. Runs `git add -A` via `runCommand()`.
3. Builds the commit message from the template.
4. Runs `git commit -m "<message>"` via `runCommand()`.
5. If exit code is non-zero and stdout/stderr contains "nothing to commit", logs and returns (not an error).
6. If exit code is non-zero for any other reason, logs a warning (does not fail the task — the task already completed successfully; a commit failure is non-fatal).
7. On success, reads the commit sha via `git rev-parse HEAD` and returns it.

**Best location:** a new exported function in `verify.ts` (alongside `captureWorktree` and `runTaskValidation`, which also use `runCommand` and deal with the working tree) or in a new `commit.ts` file for clarity.

### Step 4 — Call `commitTaskWork()` in `runEngine()` after each wave

After the wave-result merge loop in `runEngine()`, iterate over completed tasks in the wave and call `commitTaskWork()` for each. Emit a `task.committed` audit event with the returned sha.

```
// After the wave merge:
if (opts.autoCommit) {
  for (const entry of ready) {
    const record = state.tasks[entry.task.id];
    if (record?.status === "complete") {
      const sha = await commitTaskWork(entry.task.id, entry.task.title, opts.repoRoot, opts.commitMessageTemplate);
      if (sha) {
        writeAuditEvent(opts.auditPath, {
          timestamp: new Date().toISOString(),
          action: "task.committed",
          runId: state.runId,
          taskId: entry.task.id,
          commitSha: sha,
        });
      }
    }
  }
}
```

### Step 5 — Wire up the CLI flag in `cli.ts`

Parse `--auto-commit` / `FORGE_ENGINE_AUTO_COMMIT=1` and `--commit-message-template` / `FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE` in `buildEngineOptions()` (the function that creates `EngineOptions`) and pass them to the engine.

Add the new flags to the usage/help text.

### Step 6 — Tests

- Unit test for `commitTaskWork()`:  
  - In a temp git repo, create a file, call `commitTaskWork()`, assert commit was made.  
  - Call again with no changes, assert it skips gracefully.
- Integration test extending `engine.test.ts` (which already uses a real temp git repo via `execFileSync`):  
  - Run with `--auto-commit` and a stub harness that creates a file.  
  - Assert `git log --oneline` shows one commit per completed task.

### Step 7 — Documentation

- Add an entry to `docs/updates.md` under a new version section.
- Update `docs/workflow-engine.md` and `docs/workflow-engine-deep-dive.md` to document the `--auto-commit` flag.
- Add an ADR (`docs/adr/035-auto-commit-after-task.md`) capturing the design rationale.

---

## 5. Edge Cases & Mitigations

| Edge case | Mitigation |
|---|---|
| Not a git repo | Guard with `existsSync(.git)` and skip silently |
| Nothing to commit | Detect "nothing to commit" in git output; skip without error |
| Concurrent tasks in same wave | Commits are sequenced after the wave merge in `runEngine()`, not inside `executeTask()` |
| Commit fails (e.g. git config not set) | Log warning, do not fail the task or the run |
| User has unstaged pre-existing changes | `git add -A` stages everything; document that the user should start from a clean branch |
| Paused/stopped mid-run | Auto-commit only runs for tasks that reached `"complete"` in the current wave; partial waves are not committed |
| `--allow-noop` + auto-commit with nothing changed | The "nothing to commit" guard handles this |

---

## 6. Summary

The change is surgical: a new helper function, a small addition to `EngineOptions` and the audit event union, one new call-site in `runEngine()` after each wave merge, and the usual CLI wiring and docs. The entire feature is gated behind `--auto-commit` so existing runs are unaffected.
