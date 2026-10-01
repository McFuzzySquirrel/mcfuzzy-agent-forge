# Parallel Task Execution (Issue #112) — Implementation Plan

**Status:** Implemented
**Issue:** [#112 — Enable parallel task execution: task-isolated output attribution before restoring concurrency](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/issues/112)
**ADR:** [ADR-056](adr/056-parallel-execution-task-sandboxes.md)

## Goal

Make `--concurrency N > 1` real throughput while keeping every correctness
guarantee the serialization was protecting:

- `outputFiles` contains only paths the task changed (no cross-task contamination)
- the no-op output gate is not polluted by a sibling task's edits
- per-task auto-commit contains only that task's work
- state survives a mid-wave crash without re-running completed tasks
- `--concurrency 1` (the default) behaves exactly as it does today

## Decisions

| # | Decision |
|---|---|
| 1 | **Option A** — per-task `git worktree` sandbox for isolation and attribution |
| 2 | Sandboxes live at `<repoRoot>/.forge-sandboxes/`, hidden via `.git/info/exclude` |
| 3 | *Superseded by ADR-058:* the engine-managed keep-alive and `--attach` flags this step gated were retired with OpenCode v2; per-task project selection now happens through the spawn `cwd`, with the child's `PWD` set to match (ADR-059) |
| 4 | Sandbox machinery engages **only** when effective concurrency > 1 |
| 5 | Sandbox mode requires a **clean** engine tree (engine-owned `docs/` metadata excepted); otherwise it refuses with a precise message |
| 6 | Gitignored top-level build inputs (`node_modules/`, `.env`, `dist/`, …) are symlinked into each sandbox |

## Design

### 1. Sandboxing is a wrapper, not a rewrite

`executeTask` is refactored so it never sees `WorkflowState`. It owns a single
`TaskRecord`, calls an injected `checkpoint(record)` for durability, and returns
an outcome. A new `runTaskInSandbox` wrapper does create → invoke → integrate →
destroy around it.

```
run loop (single writer)
  └─ ready = ownerUniqueReady(nextReadyTasks(manifest, state))
     └─ mapLimit(ready, effectiveConcurrency, worker)
        └─ worker(entry):
             if (!sandboxMode) return executeTask(entry, …)         // today
             sandbox = await createSandbox(repoRoot, entry.task.id)  // worktree + seed
             outcome = await executeTask(entry, …, { workspaceRoot: sandbox.path })
             await integrateSandbox(sandbox, outcome)                // copy files back
             await destroySandbox(sandbox)
             return outcome
     └─ merge each outcome into the authoritative state, then saveState + syncProgressMd
```

### 2. Copy-back instead of cherry-pick

The issue proposes committing in the worktree and cherry-picking into main.
Copying the changed files into the engine root and letting the **existing**
`commitTaskWork` run unchanged is better here:

- exact attribution already comes from the sandbox snapshot; a commit in the
  sandbox adds nothing
- no cherry-pick conflict handling, no divergence from ADR-035 / ADR-046 commit shape
- the engine root is dirty during a run (`WORKFLOW-STATE.json`, `PROGRESS.md`, …);
  `git cherry-pick` would refuse or conflict on `docs/` paths for no benefit
- integration runs serialized inside the engine loop, so `git add -A` still sees
  exactly one task's files

### 3. Overlap is detected, not assumed

Two concurrent tasks touching the same path would silently lose one edit. The DAG
and `ownerUniqueReady` make that unlikely, but it is not impossible. At integration
time the engine compares each path against the paths already integrated **this
wave**; a collision fails that task with `Concurrent write overlap on <paths>`.
A silent race becomes a visible, replayable failure.

### 4. Attribution is exact, not best-effort

`captureWorktree(sandboxRoot)` after the task returns the task's change set
directly (the sandbox is clean at creation). `ENGINE_OWNED_PREFIXES` still filters
`docs/artifacts/`, `docs/task-executions/`, etc. so engine output is never
attributed. `verifyTaskResult` and `runTaskValidation` both receive the sandbox
root, so the no-op gate and `validationCommands` see only this task's work.

### 5. State becomes single-writer (CR-01)

`executeTask` no longer takes or returns a `WorkflowState`, and no longer writes
state itself. It owns a `TaskRecord`, calls `checkpoint(record)`, and returns
`{ record, artifactId?, pauseRequested? }`. The engine is the only writer;
`checkpoint` merges one record into the authoritative state and persists.

### 6. Preflight and lifecycle

Before the first sandboxed wave, `preflightSandboxMode` checks that the repository
has at least one commit and that nothing a task would read as truth is
uncommitted. Violations fail the run with the exact paths and a remedy.

The rule is about consequence, not tidiness. Human-authored requirements
(`docs/PRD.md`, `docs/IDEA.md`, `docs/features/**`, `docs/reviews/**`) and
anything outside `docs/` block the run. Everything else under `docs/` is
generated state and is tolerated: the working tree's `docs/` delta
(`EXECUTION-MANIFEST.json`, `engine-config.json`, the responsibility matrix,
authoring state, `reviews/`, `artifacts/`, progress and audit logs) is copied into
each sandbox so agents read what the operator reads. Stale `.forge-sandboxes/*`
from a crashed run are swept, then `git worktree prune`. Cleanup runs in `finally`.

> Listed as *requirements* rather than as *managed files* on purpose: the forge
> tooling rewrites a dozen generated `docs/` paths, and a managed-file list drifts
> as soon as authoring gains another. The Console persists a concurrency choice by
> rewriting `docs/engine-config.json` in place, so treating a tracked-and-modified
> `docs/` file as blocking would make it impossible to enable concurrency.

### 7. Concurrency resolution

One exported helper, `resolveConcurrency(opts)`, is used by the CLI (pre-run
summary) and the engine (dispatch), so the two can never disagree.

```
effectiveConcurrency = harness.supportsConcurrency ? clamp(maxConcurrency, 1..) : 1
sandboxMode          = effectiveConcurrency > 1
```

`--concurrency > 1` on a harness without `supportsConcurrency` warns and clamps to
1. OpenCode selects the project from `PWD ?? cwd`, so Forge aligns `PWD` with the
task's worktree `cwd` when spawning; see [ADR-059](adr/059-pwd-aligned-spawn-environment.md).
The keep-alive interaction described here was written against the retired
`--attach` / `--keep-alive` flags and no longer applies.

### 8. Human-review tasks are never sandboxed

They do not invoke a harness and read operator evidence from the engine root.
They stay in the engine root, and the run still pauses on them exactly as today.

## Files changed

| File | Change |
|---|---|
| `templates/skills/forge-workflow-engine/scripts/sandbox.ts` | **new** — create/integrate/destroy/sweep worktrees, seed ignored inputs, copy-in, overlap detection, preflight |
| `.../scripts/sandbox.test.ts` | **new** — lifecycle, attribution isolation, integration, cleanup, preflight |
| `.../scripts/engine.ts` | `executeTask` → record-based, single-writer state; `mapLimit` wave; sandbox wrapper; `resolveConcurrency` |
| `.../scripts/types.ts` | concurrency docs; `TaskAttemptRequest`; `HarnessAdapter.supportsConcurrency` comment |
| `.../scripts/request.ts` | thread the workspace root; mirror the execution file to the engine root |
| `.../scripts/cli.ts` | pre-run summary |
| `.../scripts/keepalive.ts` | *removed in v3.87 (ADR-058)* |
| `.../scripts/state.ts` | `syncProgressMd` lists all running tasks, not the first |
| `.../scripts/verify.ts` | `captureWorktree` / `verifyTaskResult` take an explicit workspace root |
| `.../scripts/engine.test.ts` | rewrite the two serialization tests; add overlap, crash-recovery, sandbox-integration tests |

No adapter changes: `request.repoRoot` becomes the workspace root, so `--dir`,
`cwd`, and `existsSync(expectedOutputs)` all resolve in the sandbox.

## Tests

- **Rewritten** the cross-owner serialization test — different-owner disjoint tasks
  genuinely overlap; each task's `outputFiles` is exact; per-task commits contain
  only that task's files.
- **Kept** the same-owner serialization test at concurrency 2.
- **New** — attribution isolation, commit isolation, overlap detection, crash
  recovery, preflight refusals, lifecycle cleanup.
- **Regression gate** — the whole existing suite stays green with `maxConcurrency: 1`
  untouched.

## Docs

- `docs/adr/056-parallel-execution-task-sandboxes.md` (056 is next free; the issue's
  "ADR-053" is taken by reachability)
- amended `docs/adr/021-parallel-task-dispatch.md` and
  `docs/adr/040-native-adapter-contracts.md`
- `docs/updates.md` + README `**Latest:**`
- `docs/workflow-engine.md`, `docs/workflow-engine-deep-dive.md`,
  `templates/skills/forge-workflow-engine/SKILL.md`, `docs/forge-launcher.md`,
  `docs/forge-console-user-guide.md`

`scripts/forge-launcher/resources/templates/` is gitignored and regenerated by
`prepack`, so it is not edited by hand.

## Risks

| Risk | Mitigation |
|---|---|
| Disk: N concurrent worktrees × repo size | documented; concurrency is opt-in |
| A task that legitimately edits untracked non-`docs/` files | preflight refuses with exact paths |
| Adapter prompts referencing the engine root by absolute path | the sandbox path is recorded in the invocation log, state, and audit trail |
| `PROGRESS.md` "Current Task" is first-match | lists all running tasks |
| Behavior change for users who already set concurrency > 1 | now they get sandboxes plus the clean-tree requirement; called out in `updates.md` and the Console guide |
