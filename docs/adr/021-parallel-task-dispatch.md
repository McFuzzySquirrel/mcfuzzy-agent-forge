# ADR-021: Parallel Task Dispatch in the Workflow Engine

**Date:** 2026-08-25
**Status:** Accepted

---

## Context

ADR-014 (`forge-workflow-engine`) and ADR-016 (`forge-workforce-compiler`) give us DAG-driven execution, but the engine drains its ready-task frontier **sequentially**. Every loop iteration, `nextReadyTasks` computes the full set of tasks whose phase-level and task-level dependencies are satisfied — i.e. all tasks that *could* run concurrently — and then executes them one at a time in a `for…of await` loop.

This is a documented, conscious MVP tradeoff (see `workflow-engine-deep-dive.md`, "Why sequential in the MVP?"). The concern was that parallel dispatch requires each harness backend to guarantee isolation between concurrent invocations — something that cannot be assumed of every backend. However, the serialization has a real cost: on multi-agent builds, wall-clock time scales with the *sum* of task durations rather than the *critical path*.

Two facts make parallel dispatch viable now:

1. **The DAG already encodes safety.** A task is only ready when every dependency is `complete`/`skipped`, so concurrently-ready tasks by definition operate on disjoint work. The dependency graph — not execution order — is the correctness mechanism.
2. **The harness adapters are already async.** `openai` uses `fetch`; `opencode`/`copilot` use `runCommand` (async `spawn`). Only `flowforge-kernel` still uses `execFileSync`, which blocks the event loop.

---

## Decision

Allow the engine to execute the ready frontier **concurrently**, bounded by a configurable concurrency limit, while keeping every dependency-gate and state transition unchanged.

### 1. Wave-based dispatch

The sequential drain loop in `runEngine` is replaced with a **wave** loop:

1. Compute `ready = nextReadyTasks(manifest, state)` (unchanged, already in manifest order).
2. Emit phase bookkeeping (`phase.started`, `currentPhase`) for each newly-entered phase, in manifest order.
3. Run all ready tasks through a bounded worker pool (`mapLimit`) with at most `maxConcurrency` tasks in flight.
4. Merge each task's terminal transition back into the authoritative state in **manifest order** (deterministic — independent of completion order).
5. `saveState` + `syncProgressMd` once per wave.

Concurrency `1` degrades to the previous sequential behavior exactly. Dependencies are re-checked at the top of every wave, so newly-unblocked tasks are picked up on the next wave.

### 2. `maxConcurrency` option

`EngineOptions` gains `maxConcurrency: number`. The CLI exposes `--concurrency <n>` (and `FORGE_ENGINE_CONCURRENCY`), defaulting to `1` to preserve existing behavior; operators opt into parallelism explicitly. A value `<= 1` is treated as sequential.

### 3. `HarnessAdapter.supportsConcurrency`

`HarnessAdapter` gains a `supportsConcurrency: boolean` capability flag. The engine only parallelizes when the selected harness opts in; otherwise it forces concurrency `1`. This preserves a per-backend safety valve for future adapters that cannot tolerate concurrent invocation.

All current adapters opt in after Phase 2 of this work:

| Adapter | Before | After |
|---|---|---|
| `openai` | `fetch`, stateless | `supportsConcurrency = true` |
| `stub` | in-memory, stateless | `supportsConcurrency = true` |
| `opencode` | async `spawn` | `supportsConcurrency = true` |
| `copilot` | async `spawn` | `supportsConcurrency = true` |
| `flowforge-kernel` | `execFileSync` (blocks event loop) | converted to async `runCommand`; `supportsConcurrency = true` |

For repo-editing harnesses (`opencode`, `copilot`, `flowforge-kernel`), concurrency safety of *file* changes is delegated to the manifest dependency graph — the same mechanism that already prevents conflicting edits in sequential mode.

### 4. Harness isolation: `flowforge-kernel` de-synchronizes

`FlowForgeKernelAdapter` is converted from `execFileSync` to `runCommand` (async `spawn`). This:

- Unblocks the event loop so concurrent invocations and heartbeats behave correctly.
- Fixes the streaming gap noted in `workflow-engine-deep-dive.md` ("Streaming harness adapters").
- Requires `runCommand` to accept an `env` override (the adapter passes `FORGE_TASK_ID` etc.).
- Its `validatePackage` preflight becomes async and **promise-cached** (a `Map<repoRoot, Promise<void>>`) so concurrent invokes validate the workforce exactly once.

### 5. State-write safety

All mutable shared-file writes are removed from the concurrent path:

- The intermediate `saveState` inside `executeTask` is deleted; the engine persists once per wave from the authoritative merged state.
- `writeAuditEvent` appends remain, but `appendFileSync` with `O_APPEND` and single-line JSON writes is safe under concurrent microtask continuations (each write completes atomically before yielding); `taskId` + `timestamp` disambiguate ordering.
- `ArtifactStore` ID allocation is moved from a per-write directory scan to an in-memory reservation counter (seeded from disk on first use), removing any possibility of duplicate artifact IDs.

### 6. Failure semantics

Failure handling uses **drain** semantics: in-flight tasks in the current wave run to completion (we do not kill running agents mid-write), but a failed task's dependents never enter a later wave because they are not "ready." After a wave in which any task failed, the outer loop stops and the run is marked `failed`, exactly as before.

---

## Consequences

### Positive

- Wall-clock time on multi-agent builds drops from sum-of-durations to critical-path, for manifest authors who declare their dependencies correctly.
- The dependency graph remains the single source of correctness truth; execution order is now an optimization, not a semantic.
- Per-harness `supportsConcurrency` gives a clear, documented escape hatch for future backends.
- `flowforge-kernel` gains non-blocking execution and loses a hidden `execFileSync` event-loop stall.
- Fully backward compatible: default concurrency `1` reproduces the exact previous sequential behavior and state files.
- **Same-owner serialization (v3.28).** Tasks owned by the same agent are kept to at most one per wave (`ownerUniqueReady`), so a wave never runs two tasks that share a subsystem (project dir, build outputs, ports) even when the DAG considers them independent. Cross-owner tasks still parallelize up to `maxConcurrency`. This closes the most common real-world collision class (same agent editing the same project) without changing the DAG or the responsibility matrix.

### Negative

- Parallel repo-editing harnesses can race if a manifest author declares insufficient dependencies. The mitigation is unchanged from sequential mode (the DAG, plus the same-owner guard), but the blast radius of a missing dependency is now a lost edit rather than a serialized-but-wrong edit. Cross-owner tasks on shared paths (one task scaffolding a directory while another builds inside it) are still the operator's responsibility — a future file-overlap gate would close that.
- The on-disk `WORKFLOW-STATE.json` no longer reflects a task's `running` status *during* a wave (it is persisted at wave boundaries). A process kill mid-wave re-runs the wave's tasks on resume, which is safe but not free.
- "Current phase" is informational when multiple phases are in flight; `phase.started` events are emitted for each phase that enters a wave, but there is no single linear "current task" notion during a parallel wave.

### Neutral

- Audit log ordering within a wave is completion-ordered, not manifest-ordered; timestamps and `taskId` disambiguate.
- Bootstrap scripts require no changes; all changes are inside `forge-workflow-engine`.

---

## References

- Deep-dive: [`docs/workflow-engine-deep-dive.md`](../workflow-engine-deep-dive.md)
- Skill: [`forge-workflow-engine`](../../templates/skills/forge-workflow-engine/SKILL.md)
- Engine: [`templates/skills/forge-workflow-engine/scripts/engine.ts`](../../templates/skills/forge-workflow-engine/scripts/engine.ts)
- Types: [`templates/skills/forge-workflow-engine/scripts/types.ts`](../../templates/skills/forge-workflow-engine/scripts/types.ts)
- Harness: [`templates/skills/forge-workflow-engine/scripts/harness/`](../../templates/skills/forge-workflow-engine/scripts/harness/)
- ADR-014: [`dynamic workflow orchestration`](014-dynamic-workflow-orchestration.md)
- ADR-017: [`artifact store and context projection`](017-artifact-store-and-context-projection.md)
