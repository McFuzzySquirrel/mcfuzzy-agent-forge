# Plan: Finer-Grained Tasks + Configurable Task Timeout

**Branch:** `optimization/task-breakdown`
**Status:** Complete

## Problem

Workflow-engine tasks were failing because each harness adapter hardcodes a fixed
per-task subprocess timeout (`timeoutMs: 10 * 60 * 1000`) that is passed to
`runCommand`; when a task exceeds it the child is SIGKILLed and the task fails
after retries. Task granularity is set 1:1 in the execution plan
(`forge-execution-adapter`'s compiler emits one task per top-level PRD bullet),
so large bullets become long opaque tasks that both hit the timeout and hide
progress.

## Goal

1. Make compiled tasks **finer-grained** so progress is visible and individual
   tasks stay small — controlled at the execution-plan (compiler) level.
2. Make the per-task timeout **configurable** before running the workflow engine:
   a global override (CLI flag + env var) and an optional per-task `timeoutMs`
   field in the manifest.

## Phases

### Phase 1 — Fine-grain task splitting in `forge-execution-adapter`

- `scripts/compiler.ts`: add a `granularity?: "coarse" | "fine"` option
  (default **`fine`**) to `compileExecutionManifest`. In `fine` mode:
  - expand indented sub-bullets into their own chained tasks;
  - conservatively split oversized bullets (~>160 chars / multi-sentence) at
    clear boundaries (`. ` + capital, `; `, `—`, numbered markers);
  - preserve per-fragment owner matching, the linear `dependencies` chain, and
    artifact `inputs`/`produces` wiring;
  - emit warnings naming tasks that were split.
- `scripts/types.ts`: add `granularity?` to `ExecutionManifest`; add optional
  `timeoutMs?: number` to `ManifestTask` (per-task override for Phase 2).
- `scripts/adapter.ts`: add `--granularity <coarse|fine>` to `compile`
  (default `fine`); update usage text.

### Phase 2 — Configurable task timeout in `forge-workflow-engine`

- `scripts/types.ts`: optional `timeoutMs?: number` param on
  `HarnessAdapter.invoke`; add `taskTimeoutMs: number` to `EngineOptions`;
  export `DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000`.
- `scripts/engine.ts`: compute effective timeout `task.timeoutMs ?? opts.taskTimeoutMs`
  in `executeTask` and pass it to `harness.invoke(...)`.
- `scripts/cli.ts`: add `--task-timeout-ms <ms>` + `FORGE_ENGINE_TASK_TIMEOUT_MS`
  (default `600000`); surface in usage and the pre-run summary.
- Harness adapters (`opencode`, `copilot`, `flowforge-kernel`): use the passed
  timeout instead of the hardcoded literal. `openai` gets an `AbortController`
  timeout. `stub` accepts the param for signature compatibility.
- `scripts/forge-engine-run.sh` / `.ps1`: `--task-timeout-ms` passthrough.

### Phase 3 — Tests

- `forge-execution-adapter`: sub-bullet expansion, long-bullet split + warning,
  `coarse` reproduces legacy output, `granularity` field emitted.
- `forge-workflow-engine`: effective timeout = per-task beats global default;
  `runCommand` honors a custom timeout.

### Phase 4 — Docs

- `templates/skills/forge-execution-adapter/SKILL.md`
- `templates/skills/forge-workflow-engine/SKILL.md`
- `docs/workflow-engine.md`
- `docs/workflow-engine-deep-dive.md`

### Phase 5 — ADR

- `docs/adr/022-task-granularity-and-configurable-timeout.md`

### Phase 6 — Verify

- Run both skill test suites (`npm test`) and typechecks (`npm run typecheck`).

## Out of scope

- Threading per-task timeouts into `forge-workforce-compiler` / FlowForge
  workflow nodes (nodes currently carry only `retry`).
