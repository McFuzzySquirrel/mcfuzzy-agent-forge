# How the `forge-workflow-engine` Works — A Deep-Dive Learning Guide

## What we're exploring

Agent Forge lets you describe a software project as a Product Requirements Document (PRD), decompose it into agents and tasks, and then build it. The *workflow engine* is the piece that takes over once all the planning is done and actually **runs** the build — autonomously, without a human prompting each step. This guide walks through exactly how it does that.

---

## The Big Picture: Three Layers, One Loop

The engine is organised into three cleanly separated layers:

```
┌──────────────────────────────────────────────────────────┐
│  Layer 3 — DAG Engine  (scripts/engine.ts)               │
│   • Reads the manifest                                   │
│   • Decides what to run next (dependency ordering)       │
│   • Drives the main while-loop                           │
├──────────────────────────────────────────────────────────┤
│  Layer 2 — Harness Adapters  (scripts/harness/*.ts)      │
│   • Translates "invoke this task" into a real call       │
│   • opencode CLI  |  OpenAI API  |  Stub (dry-run)       │
├──────────────────────────────────────────────────────────┤
│  Layer 1 — State Manager  (scripts/state.ts)             │
│   • Reads/writes docs/WORKFLOW-STATE.json                │
│   • Syncs docs/PROGRESS.md (human-readable view)         │
│   • Appends docs/EXECUTION-AUDIT.jsonl                   │
└──────────────────────────────────────────────────────────┘
```

Each layer has a single job. The DAG engine never touches the filesystem directly — it calls state functions. The harness adapters never mutate state — they return a `TaskResult`. This is a classic *separation of concerns* pattern and it's worth internalising because it's what makes the system replaceable and testable.

---

## Where It Starts: The Execution Manifest

Before the engine can run, `forge-execution-adapter` compiles a file called `docs/EXECUTION-MANIFEST.json`. Think of this as the **build contract**: every phase, every task, every owning agent, every expected output file, and every validation command — structured as machine-readable JSON.

```
EXECUTION-MANIFEST.json (produced by forge-execution-adapter)
│
│  phases: [
│    { id: "1", title: "Setup", dependencies: [], tasks: [
│        { id: "1.1", ownerAgent: "api-engineer", dependencies: [], expectedOutputs: ["src/api.ts"] },
│        { id: "1.2", ownerAgent: "db-engineer",  dependencies: ["1.1"], ... }
│    ]},
│    { id: "2", title: "Tests",  dependencies: ["1"], tasks: [...] }
│  ]
```

Key insight: **the engine never re-reads the PRD**. It only ever looks at the compiled manifest. This is a deliberate firewall — if the PRD changes mid-run, you must re-compile and start a fresh run. This prevents partial builds from running against a stale plan.

---

## Booting Up: `initState`

When you run `npm run workflow-engine -- run` for the first time, the CLI (`cli.ts`) detects the repo root by walking up from `cwd` looking for `.git`, loads the manifest, resolves the harness, and calls `runEngine(opts)`.

Inside `runEngine`, the very first thing that happens is:

```typescript
let state = loadState(opts.statePath)
  ?? initState(manifest, opts.manifestPath, opts.harness.name);
```

`loadState` returns `null` on first run (no state file yet), so `initState` is called. It:
1. Generates a UUID as the `runId`.
2. Iterates every phase and every task in the manifest.
3. Creates a `TaskRecord` entry for each, all set to `status: "pending"`.
4. Writes this to `docs/WORKFLOW-STATE.json`.

Now the engine has a live snapshot of the entire planned build. Every subsequent decision is made by reading that snapshot — not by re-parsing the manifest each time.

---

## The Core Loop: What Runs Next?

The engine's main loop is a `while` that runs until either the workflow is complete, a pause is requested, or a failure stops execution:

```
while (!isComplete && !pauseRequested) {
    ready = nextReadyTasks(manifest, state)
    for each ready task:
        executeTask(task)
        saveState()
        syncProgressMd()
}
```

The interesting function here is `nextReadyTasks`. It has to answer: *"given everything that's already finished, what can run right now?"* This is the **DAG resolution** step.

### How `nextReadyTasks` works

```typescript
function nextReadyTasks(manifest, state): FlatTask[] {
  const flat = flattenManifest(manifest);  // all tasks in order
  const ready = [];

  for (const entry of flat) {
    const record = state.tasks[entry.task.id];
    if (!record || record.status !== "pending") continue;  // skip non-pending

    // 1. Check that all phases this task's phase depends on are complete
    const phaseDepsOk = manifest.phases[entry.phaseIndex]?.dependencies.every(
      depPhaseId => depPhase.tasks.every(t => state.tasks[t.id]?.status === "complete")
    );
    if (!phaseDepsOk) continue;

    // 2. Check that all task-level dependencies are complete
    if (!allDepsComplete(entry.task.id, entry.task.dependencies, state)) continue;

    ready.push(entry);
  }
  return ready;
}
```

Two levels of dependency checking happen here:

- **Phase-level**: Phase 2 can't start until every task in Phase 1 (which Phase 2 declares as a dependency) is `complete`.
- **Task-level**: Within a phase, task `1.2` won't become ready until `1.1` (its dependency) is `complete`.

This is a simplified but correct DAG walk. Because tasks always move from `pending → running → complete/failed/skipped` and never backwards (except on explicit `replay`), `nextReadyTasks` can be called repeatedly as the loop iterates and will always produce the correct frontier.

> **Why sequential in the MVP?** The ready list could theoretically contain multiple tasks that could run in parallel. The engine runs them one at a time for now. True parallelism would require each harness backend to guarantee isolation between concurrent invocations — something that can't be assumed of all backends (e.g. a CLI tool writing to shared files). It's a conscious tradeoff: correctness over speed.

---

## Executing a Task

Once a task is ready, `executeTask` takes over:

```
1. Look up which agent owns this task (by name match against discovered .agent.md files)
   → If no agent found: skip the task (warn, don't fail)

2. markTaskStarted() → saves state with status:"running", increments attempt counter

3. for attempt in range(0, maxRetries+1):
       result = harness.invoke(agent, task, state, repoRoot)
       if result.success:
           markTaskComplete(state, outputFiles, stdout)
           write audit event: task.complete
           return
       if last attempt:
           markTaskFailed(state, errorMessage)
           write audit event: task.failed
           return
       else:
           sleep(retryDelayMs)
           write audit event: task.retrying
```

The retry loop is the engine's resilience mechanism. If a model call fails transiently — network timeout, rate limit, model error — the task is retried up to `--max-retries` times (default: 2) with a configurable delay (default 5 seconds). Only if all attempts fail does the task enter the `failed` state, which halts the phase.

### State is always saved before the next loop iteration

After every `executeTask` call, the engine calls both `saveState` and `syncProgressMd`. This means:

- If the process crashes mid-run (power failure, SIGKILL, etc.), the next `run` invocation picks up from exactly the last saved state.
- `PROGRESS.md` is always current so a human checking in on the build gets an accurate picture.

---

## The Harness Abstraction

The `HarnessAdapter` interface is the plugin point of the whole system:

```typescript
interface HarnessAdapter {
  name: string;
  invoke(agent: AgentDescriptor, task: ManifestTask, context: WorkflowState, repoRoot: string): Promise<TaskResult>;
}
```

Each adapter translates a `(agent, task)` pair into a real execution call:

### `OpenCodeAdapter`

Shells out to the `opencode` CLI:

```
opencode run --model <agent.model> --system-prompt <agent.path> "<task title + description>"
```

The agent's `.agent.md` file becomes the system prompt. The task's title and description become the user prompt. Outputs are verified by checking whether the `expectedOutputs` files exist on disk after the call.

### `OpenAIAdapter`

Sends a `POST /v1/chat/completions` with:

- System message: the agent's `rawBody` (the content of the `.agent.md` file) plus injected constraints
- User message: the task title, description, expected outputs, and validation commands

This enables fully API-driven builds without any local tooling installed.

### `StubAdapter`

Returns a synthetic success for every task without making any real call. The environment variable `STUB_FAIL_TASK_IDS` can be set to a comma-separated list of task IDs that should fail — useful for testing the retry and failure handling logic without a real backend.

### `FlowForgeKernelAdapter`

Hands task execution to a FlowForge CLI/runtime path (`flowforge run ...`) against a compiled `.workforce` package. It can run a pre-dispatch workforce validation gate via `forge-workforce-compiler` and supports command templating through environment variables for deployment-specific handoff contracts.

The beauty of this pattern: **the engine code never changes when you swap backends**. Adding a new harness (say, a Claude MCP adapter, a local Ollama runner, or a GitHub Actions backend) only requires implementing the `HarnessAdapter` interface and registering it in `cli.ts`.

---

## Keeping Everything in Sync: State + Progress + Audit

The engine maintains three output files and keeps them in sync after every state mutation:

### `docs/WORKFLOW-STATE.json` — the machine's source of truth

Every task has a full record: status, attempt count, start/end timestamps, output files, agent output text, and error message. The engine reads this file to decide what to run next. It also carries the `runId` (a UUID) which ties together all audit events for a single run.

### `docs/PROGRESS.md` — the human's source of truth

Regenerated by `syncProgressMd` after every task. It mirrors what a human operator would want to see: what's done, what's running, what's remaining, any blockers. It also happens to be the same format used by `forge-orchestrate-build`, so both execution modes produce compatible progress files.

### `docs/EXECUTION-AUDIT.jsonl` — the append-only record

Every state transition is appended as a newline-delimited JSON event. This file is never overwritten — only appended to. It's the full history: `run.started`, `phase.started`, `task.started`, `task.retrying`, `task.complete`, `task.failed`, `task.skipped`, `run.paused`, `run.complete`. You can replay the entire history of a build from this file.

The sync pattern is:

```
execute task
  → markTask*(state, ...) returns new immutable state object
  → saveState(statePath, newState)     writes WORKFLOW-STATE.json
  → writeAuditEvent(auditPath, event)  appends to EXECUTION-AUDIT.jsonl
  → syncProgressMd(progressPath, ...)  regenerates PROGRESS.md
```

Note that state is **immutable**: every `markTask*` function in `state.ts` returns a *new* state object using spread (`{ ...state, tasks: { ...state.tasks, [id]: updated } }`) rather than mutating in place. This means the engine always has a clean snapshot and bugs from accidental mutation are impossible.

---

## Resuming Runs

Because all state lives in files, resumability is essentially free. When `run` is called on a repository that already has `WORKFLOW-STATE.json`:

```typescript
let state = loadState(opts.statePath)    // loads existing state
  ?? initState(manifest, ...);            // only called on first run
```

`nextReadyTasks` will skip over tasks already marked `complete` or `skipped` because they don't have `status === "pending"`. The engine picks up exactly where it left off.

If the status was `paused`, the engine sets it back to `running` and continues. If it was `failed`, the engine logs a warning and continues — re-attempting any tasks that are still `pending`.

### `replay` for targeted recovery

When a task fails and you've fixed the root cause (maybe the agent prompt needed tweaking, or an external dependency was down), you don't need to restart the whole workflow:

```bash
npm run workflow-engine -- replay P1-T3 --harness opencode
```

`replayTask` resets that single task's record to `pending` while leaving all completed tasks untouched, then calls `executeTask` directly. This is surgical recovery without side effects on the rest of the build.

---

## Failure Propagation

When a task fails after exhausting retries:

1. It's marked `status: "failed"` in state.
2. On the next loop iteration, `hasFailed(state)` returns `true`.
3. The loop logs an error and breaks.
4. The run status becomes `"failed"`.
5. All downstream tasks remain `"pending"` — they are not explicitly failed, they are simply never reached.

This means a `replay` after fixing the root cause will naturally resume by re-running the failed task and then continuing forward through its dependents.

---

## Flow Diagram: Full Lifecycle

```
forge-execution-adapter compile
        │
        ▼
docs/EXECUTION-MANIFEST.json
        │
        ▼
workflow-engine run --harness opencode
        │
        ├─ loadState() → null
        ├─ initState() → all tasks pending
        ├─ set status:"running"
        │
        └─ MAIN LOOP ────────────────────────────────────────┐
               │                                             │
               ├─ nextReadyTasks()                           │
               │     check phase deps (all prior phases done)│
               │     check task deps (declared deps done)    │
               │                                             │
               ├─ for each ready task:                       │
               │     markTaskStarted() → save state          │
               │     harness.invoke(agent, task)             │
               │       ↳ opencode run --system-prompt ...    │
               │     on success:                             │
               │       markTaskComplete() → save → syncMd    │
               │     on failure (retries exhausted):         │
               │       markTaskFailed() → save → syncMd      │
               │       → hasFailed=true → break loop         │
               │                                             │
               └─────────────────────────────────────────────┘
                          │
              ┌───────────┴────────────┐
         isComplete?               hasFailed?
              │                        │
        set "complete"           set "failed"
        write audit              write audit
        sync PROGRESS.md         sync PROGRESS.md
```

---

## What Makes This Pattern Powerful

Let's step back and name the design decisions that make this interesting as a pattern, not just as a feature:

### 1. Compile once, run anywhere

The manifest is the contract. Once compiled, the engine can run on any machine, in any CI environment, picked up by any process. The execution is completely decoupled from the authoring tool.

### 2. State in files = free resilience

Storing all run state in a JSON file on disk costs almost nothing but gives you crash recovery, cross-machine portability, and auditability for free. No database, no daemon, no network.

### 3. Plugin adapters at the execution boundary

The `HarnessAdapter` interface is placed at exactly the right point — the moment when "intent" becomes "action". Everything before that point (DAG resolution, state management, retry logic) is completely harness-agnostic. This is the [Ports and Adapters (Hexagonal Architecture)](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software)) pattern applied to AI agent orchestration.

### 4. Idempotent operations

`nextReadyTasks` is pure — given the same manifest and state, it always returns the same answer. `saveState` overwrites (not appends) so re-running it is safe. The audit log *does* append, but that's intentional — you want a full history, not deduplication.

### 5. Immutable state objects

Every state transition returns a new object. This makes the flow of state through the engine traceable and eliminates mutation bugs.

---

## Next Possible Steps

### For this system specifically

- **True parallel dispatch**: The ready-task list already contains all concurrently runnable tasks. Adding a `Promise.all` wrapper around the ready set (with a configurable concurrency limit) would significantly reduce wall-clock time on large projects. The main constraint is ensuring each harness adapter handles concurrent invocations safely.

- **Approval gates between phases**: The manifest already has `approvalGates.betweenPhases`. The engine could pause after each phase, surface a diff of what was produced, and wait for a human `continue` signal before proceeding to the next phase.

- **Output validation as a first-class step**: Right now, `expectedOutputs` are checked by looking for file existence. A richer post-task validator could run `validationCommands` (which are already in the manifest) and treat non-zero exit codes as task failures, giving the retry loop a chance to fix correctness issues.

- **Streaming harness adapters**: The OpenCode adapter uses `execSync` (blocking). A streaming version using `spawn` could pipe agent output in real-time to the terminal and to a log file, giving operators live feedback on long-running tasks.

- **Web dashboard**: Because `WORKFLOW-STATE.json` is a stable structured file, a simple file-watching web server could serve a live build progress view without any changes to the engine.

### As a pattern for other things

The engine is essentially a **file-backed, resumable task scheduler with pluggable execution backends**. That pattern applies surprisingly broadly:

- **Data pipeline orchestration**: Replace `ManifestTask` with a data transformation step, replace `HarnessAdapter` with a compute backend (local Python, Spark, a cloud function). The DAG engine, state management, and retry logic are reusable as-is.

- **Multi-step deployment workflows**: Model each deployment step (provision infra, deploy service A, run smoke test, deploy service B) as a manifest task with dependencies. The engine gives you resumable deployments with automatic retry and an audit log.

- **Batch job management**: Any scenario where you have N units of work with dependencies, a fallible execution backend, and a need for crash recovery maps onto this architecture.

- **AI agent chains (general)**: The pattern of *manifest → DAG engine → harness adapter → agent* is a reusable template for any multi-agent workflow. The key insight is that the "what to run" (DAG) and "how to run it" (adapter) are independently replaceable — so you can swap in a different model, a different runtime, or a different dependency structure without touching the others.

---

## Key Files at a Glance

| File | Role |
|---|---|
| `templates/skills/forge-workflow-engine/scripts/engine.ts` | Main loop, DAG resolution, retry logic |
| `templates/skills/forge-workflow-engine/scripts/state.ts` | State read/write, PROGRESS.md sync, audit events |
| `templates/skills/forge-workflow-engine/scripts/cli.ts` | CLI entry point: `run`, `status`, `replay`, `pause` |
| `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts` | Shells out to `opencode run` |
| `templates/skills/forge-workflow-engine/scripts/harness/openai-adapter.ts` | Calls OpenAI (or compatible) API directly |
| `templates/skills/forge-workflow-engine/scripts/harness/stub-adapter.ts` | Synthetic results for testing |
| `docs/EXECUTION-MANIFEST.json` | Compiled build contract (produced by `forge-execution-adapter`) |
| `docs/WORKFLOW-STATE.json` | Machine-readable live run state |
| `docs/PROGRESS.md` | Human-readable progress (synced after every task) |
| `docs/EXECUTION-AUDIT.jsonl` | Append-only audit trail |

---

## A Mental Model to Remember

> The workflow engine is a **state machine whose states live on disk**. It reads a contract (the manifest), builds a plan (the task graph), and drives each step through a swappable execution backend — persisting every transition so it can always be resumed, replayed, or audited.

The three layers — state, adapter, engine — map directly to three concerns that should always be separated in any similar system: *what happened*, *how to act*, and *what to do next*. Get those three things cleanly separated and the whole system becomes easy to reason about, test, and extend.

---

## Related Reading

- [`templates/skills/forge-workflow-engine/SKILL.md`](../templates/skills/forge-workflow-engine/SKILL.md) — reference documentation and CLI usage
- [`docs/adr/014-dynamic-workflow-orchestration.md`](adr/014-dynamic-workflow-orchestration.md) — the architectural decision that introduced this system
- [`docs/adr/011-forge-execution-adapter.md`](adr/011-forge-execution-adapter.md) — the upstream adapter that produces the manifest
- [`docs/prompt-playbook.md`](prompt-playbook.md) — how to choose between prompt-driven and engine-driven execution modes
