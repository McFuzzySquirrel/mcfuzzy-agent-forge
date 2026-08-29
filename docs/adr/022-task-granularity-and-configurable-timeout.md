# ADR-022: Finer-Grained Tasks and a Configurable Task Timeout

**Date:** 2026-08-26
**Status:** Accepted

---

## Context

Field reports showed `forge-workflow-engine` tasks failing. The root cause was
the **hardcoded per-task timeout** inside the harness adapters: `opencode`,
`copilot`, and `flowforge-kernel` all passed `timeoutMs: 10 * 60 * 1000` to
`runCommand`, which `SIGKILL`s the child when it expires and fails the task
after the retry loop. The `openai` adapter had **no** timeout at all, so a
stalled API call could hang a run indefinitely.

Compounding this, task granularity is decided entirely by the execution plan:
`forge-execution-adapter`'s compiler emitted **one task per top-level PRD
bullet**, regardless of how much work the bullet described. A single large
bullet became a single long, opaque task - the worst case for both failure
(one task can exceed the timeout) and observability (progress only advances at
big, coarse milestones).

Two decisions fall out of this:

1. **Make tasks finer-grained** so each task is small, visible, and unlikely to
   exhaust a per-task timeout - controlled at the execution-plan (compiler)
   level where tasks are derived.
2. **Make the per-task timeout configurable** so an operator can raise the
   budget for heavy tasks instead of being pinned to a constant baked into an
   adapter file.

---

## Decision

### 1. Fine-grained task decomposition (default) in `forge-execution-adapter`

`compileExecutionManifest` gains a `granularity: "coarse" | "fine"` option,
**defaulting to `fine`**. The CLI exposes `--granularity <coarse|fine>`.

In `fine` mode the compiler:

- **Expands sub-bullets**: an indented sub-bullet under a bullet becomes its own
  task. The parent bullet acts as a *container* (not an executable task) and its
  text - with the leading task-id label stripped, so task IDs stay unambiguous -
  is prefixed to each child task as context.
- **Splits oversized bullets**: a bullet that is multi-sentence / roughly
  >160 chars is split at sentence/segment boundaries (`. ` + capital, `; `,
  em-dash, numbered markers). Fragments below a minimum length merge into their
  neighbor to avoid micro-tasks. A compile warning names every split task so the
  result can be reviewed.
- **Preserves the contract**: each emitted task keeps per-fragment owner
  matching, the linear `dependencies` chain, and artifact `inputs`/`produces`
  wiring, so the artifact-store/context-projection layer keeps working.
- **Records the setting**: the manifest carries `granularity: "coarse" | "fine"`
  for traceability.

`coarse` reproduces the legacy behavior byte-for-byte: every bullet line (any
indentation) becomes one task in source order, with no splitting.

### 2. Configurable per-task timeout in `forge-workflow-engine`

- `EngineOptions` gains `taskTimeoutMs: number`; the CLI exposes
  `--task-timeout-ms <ms>` and `FORGE_ENGINE_TASK_TIMEOUT_MS`, defaulting to
  `DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000` (unchanged from today).
- `ManifestTask` gains an optional `timeoutMs?: number`. The engine computes the
  effective timeout as `task.timeoutMs ?? opts.taskTimeoutMs` in `executeTask`
  and passes it to the harness. **Precedence: per-task manifest field overrides
  the engine-wide default.**
- `HarnessAdapter.invoke` gains an optional `timeoutMs?: number` parameter.
  The shell-out adapters (`opencode`, `copilot`, `flowforge-kernel`) pass it to
  `runCommand` in place of the hardcoded constant; the `openai` adapter now
  enforces it with an `AbortController` (fixing the previously unbounded call);
  `stub` accepts it for signature compatibility.
- The pre-run summary prints the effective timeout.
- `scripts/forge-engine-run.sh` / `.ps1` accept `--task-timeout-ms` /
  `-TaskTimeoutMs` and pass it through.

---

## Consequences

### Positive

- **Progress is visible at a finer grain**: smaller tasks mean `PROGRESS.md` /
  `WORKFLOW-STATE.json` advance more often, and a failing task isolates the
  failure to a small unit of work.
- **Timeouts are controllable**: operators can raise the budget for a single
  heavy task (per-task `timeoutMs`) or globally (`--task-timeout-ms` /
  `FORGE_ENGINE_TASK_TIMEOUT_MS`) before running the engine, instead of editing
  adapter source.
- **The OpenAI adapter can no longer hang a run forever**.
- **Backward-compatible escape hatch**: `--granularity coarse` reproduces the
  exact previous task set, and the default timeout value is unchanged.

### Negative

- Fine granularity **changes compiled manifests by default**, so existing
  in-progress runs tied to an old manifest must be restarted (`rm
  docs/WORKFLOW-STATE.json`). This is already documented engine behavior ("state
  is tied to a run ID").
- Heuristic splitting can mis-segment an unusual bullet; the compile-time
  warnings (and the `coarse` escape hatch) mitigate this.
- Finer tasks mean more harness invocations per build, so per-task overhead
  (process spawn, prompt round-trip) is multiplied - acceptable for the
  visibility and reliability gains, and partially offset by parallel dispatch
  (ADR-021).

### Neutral

- The workforce-compiler path is unaffected for now: FlowForge workflow nodes
  still carry only `retry`; threading per-task timeouts into compiled `.workforce`
  packages is a possible follow-up.

---

## References

- Skill: [`forge-execution-adapter`](../../templates/skills/forge-execution-adapter/SKILL.md)
- Skill: [`forge-workflow-engine`](../../templates/skills/forge-workflow-engine/SKILL.md)
- Compiler: [`templates/skills/forge-execution-adapter/scripts/compiler.ts`](../../templates/skills/forge-execution-adapter/scripts/compiler.ts)
- Engine: [`templates/skills/forge-workflow-engine/scripts/engine.ts`](../../templates/skills/forge-workflow-engine/scripts/engine.ts)
- Harness: [`templates/skills/forge-workflow-engine/scripts/harness/`](../../templates/skills/forge-workflow-engine/scripts/harness/)
- ADR-014: [`dynamic workflow orchestration`](014-dynamic-workflow-orchestration.md)
- ADR-017: [`artifact store and context projection`](017-artifact-store-and-context-projection.md)
- ADR-021: [`parallel task dispatch`](021-parallel-task-dispatch.md)
