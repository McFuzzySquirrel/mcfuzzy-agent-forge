---
name: forge-workflow-engine
description: Dynamic workflow orchestration engine that reads docs/EXECUTION-MANIFEST.json and drives every task to completion through a pluggable harness adapter (OpenCode CLI, OpenAI API, or stub). Maintains docs/WORKFLOW-STATE.json for machine-readable run state and syncs docs/PROGRESS.md after every task. Use this skill after forge-execution-adapter has compiled the manifest.
---

# Skill: Forge Workflow Engine

You are the **runtime execution layer** for an MyForge repository. Where `project-orchestrator` operates as a prompt-driven orchestrator inside a chat harness, this skill runs **outside** the chat session - it reads the structured execution contract produced by `forge-execution-adapter` and drives every agent task through a real execution backend until the workflow is complete.

This skill is the autonomous execution alternative to the prompt-driven flows. Teams use it when they want **dark orchestration**: a background process that fires agent invocations autonomously, persists state across interruptions, and requires no human intervention between tasks. Start it from the terminal with `forge-launcher engine-run`, or drive it from inside a chat with `@workflow-orchestrator`.

---

## Prerequisites

Before running this skill, the following must exist in the repository:

- `docs/EXECUTION-MANIFEST.json` - compiled by `forge-execution-adapter`
- Agent `.md` files under the harness agents directory. Load `forge-build-agent-team/references/detect-harness.md` to detect the active harness; the conventional paths are:
  - `.github/agents/` (GitHub Copilot harness)
  - `.claude/agents/` (Claude Code harness)
  - `.opencode/agents/` (OpenCode harness)
  - `.agents/agents/` (generic / default fallback)
- A configured execution harness (OpenCode CLI in `$PATH`, or `OPENAI_API_KEY` set)

If the manifest does not exist yet, run the adapter first:

```bash
cd .agents/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

---

## Install & Run

> **Runtime requirement:** this skill is a Node package and requires `node >= 18`
> and `npm` at *build time*. `npm install` (the "node module bootstrap") is not
> run by `bootstrap.sh` - it is deferred to engine prep time (when you run the
> engine via `forge-launcher engine-run`, or manually via
> `scripts/forge-engine-run.sh`). The installed `node_modules/` is
> gitignored in target repos and must never be committed.

```bash
cd .agents/skills/forge-workflow-engine
npm install
```

### Start or resume a full run

```bash
npm run workflow-engine -- run
npm run workflow-engine -- run --harness opencode
npm run workflow-engine -- run --harness openai
npm run workflow-engine -- run --harness stub          # dry-run, no real calls
npm run workflow-engine -- run --harness flowforge-kernel
npm run workflow-engine -- run --max-retries 3 --retry-delay-ms 10000
npm run workflow-engine -- run --harness opencode --yes   # skip the pre-run gate
npm run workflow-engine -- run --heartbeat-ms 5000        # heartbeat every 5s while a task runs
npm run workflow-engine -- run --harness opencode --keep-alive   # warm opencode server for the run
npm run workflow-engine -- run --harness stub --viz --yes # run with the live Forge Board dashboard
```

The engine prints a pre-run summary (harness, phases, tasks) and, when run
interactively, pauses for confirmation before dispatching. The gate is
interactive-only: pass `--yes` (or set `FORGE_ENGINE_YES=1`) to skip it
explicitly for headless/CI runs, and it auto-skips when stdin is not a TTY.

### Heartbeat

While a task is executing (e.g. a long `opencode run` / `copilot -p` call), the
engine prints a `…still working on task <id> (@<agent>, Ns elapsed)` line at a
fixed interval so a quiet terminal doesn't look hung:

```bash
npm run workflow-engine -- run --heartbeat-ms 15000        # default: 15s
npm run workflow-engine -- run --heartbeat-ms 0            # disable
```

`--heartbeat-ms` overrides the `FORGE_ENGINE_HEARTBEAT_MS` environment variable.

### Keep-alive attach mode (opencode harness)

Cold-starting a fresh `opencode run` for every task re-boots the project
instance each time: config, AGENTS.md, skills, agent files, and every MCP server
(the biggest chunk of per-task overhead). To avoid that, the engine keeps a
single headless `opencode serve` warm and attaches every task to it.

**By default the engine is adaptive:** when more than one task remains, it boots
one `opencode serve` for the run and attaches every task to it; when a single
task remains (e.g. a short resume), it cold-starts that one task instead so it
does not pay the server boot cost. This applies to the `opencode` harness only.

You can override the default:

```bash
npm run workflow-engine -- run --harness opencode                 # adaptive (default)
npm run workflow-engine -- run --harness opencode --keep-alive    # force keep-alive
npm run workflow-engine -- run --harness opencode --no-keep-alive # force cold start per task
npm run workflow-engine -- run --harness opencode --keep-alive --keep-alive-port 4096
```

The server is torn down when the run finishes. Each `opencode run --attach` still
creates a fresh, isolated session per task - the server only keeps the shared
project instance (config/skills/MCP) warm. If you already keep an `opencode serve`
running (e.g. started manually or by the TUI), skip the lifecycle management and
point tasks at it:

```bash
npm run workflow-engine -- run --harness opencode --attach http://127.0.0.1:4096
```

`--keep-alive`, `--no-keep-alive`, and `--attach` also have env equivalents:
`FORGE_ENGINE_ATTACH=1` (force keep-alive), `FORGE_ENGINE_ATTACH=0` (force cold
start), and `FORGE_ENGINE_ATTACH_URL=<url>` (reuse an existing server).

### Live visualization (The Forge Board)

Pass `--viz` (or `--viz=<port>`, default `4299`) to run to launch a live PixiJS
dashboard of the build in your browser. The build renders as a kanban board:
one band per phase, with tasks as name-tag cards (each carrying the owning
agent's face and name) flowing left-to-right through To Do / In Progress /
Done / Failed, connected by dependency and artifact edges. Hover for tooltips,
click a card to expand it in place with task detail (description, status,
owner, phase, duration, artifact, inputs, dependencies, outputs, validation,
errors), drag to pan, scroll to zoom.

```bash
npm run workflow-engine -- run --harness stub --viz --yes
npm run workflow-engine -- run --viz=5000 --no-open   # fixed port, no browser auto-open
```

Attach to an already-running or detached engine run from any terminal:

```bash
npm run workflow-engine -- viz --repo <repo-dir>
```

The dashboard is loopback-only and streams events over SSE. See ADR-025.

### Task timeout

Each task runs against the harness with a per-task timeout. If the harness call
does not finish in time, the child process is killed and the task counts as
failed (subject to `--max-retries`). The default is **10 minutes**.

```bash
npm run workflow-engine -- run --task-timeout-ms 1500000       # 25 minutes
FORGE_ENGINE_TASK_TIMEOUT_MS=1500000 npm run workflow-engine -- run
```

Precedence: a task's `timeoutMs` field in the manifest (if present) overrides
the engine-wide value. Hand-edit `docs/EXECUTION-MANIFEST.json` to give one
heavy task a longer budget:

```json
{
  "id": "1.2",
  "title": "Migrate the monolith",
  "timeoutMs": 3600000
}
```

The pre-run summary prints the effective timeout. Adapters that shell out
(`opencode`, `copilot`, `flowforge-kernel`) enforce it on the child process; the
`openai` adapter enforces it on the API call via `AbortController`.

### Output verification gate (strict by default)

A harness call that exits 0 is **not** proof that a task did anything — a model
can reply "Ready for the task." and produce no files. The engine therefore
verifies a successful call before marking the task complete:

- **Expected outputs.** If a task declares `expectedOutputs`, every one must
  exist after the harness call. Missing outputs → the attempt is treated as
  failed, retried up to `--max-retries`, then marked `failed` with the missing
  list as the error.
- **No-op detection.** Tasks that declare no `expectedOutputs` must show evidence
  of work: file changes in the git working tree (diffed before/after the call,
  engine-owned `docs/` files excluded) **or** a substantive agent response. A
  task with no changes and only trivial output ("Ready for the task.") is a
  failed attempt, not a completion.
- **Relax it** with `--allow-noop` / `FORGE_ENGINE_ALLOW_NOOP=1` to skip the
  no-op heuristic (the expected-output check stays).
- **Validation commands.** Pass `--run-validation` /
  `FORGE_ENGINE_RUN_VALIDATION=1` to execute each task's manifest
  `validationCommands` (cwd = repo root) and require them all to exit 0 before
  the task counts as complete. Tasks that declare validation are gated on it
  rather than the no-op heuristic. (The commands are otherwise only *shown* in
  the task prompt.)

The pre-run summary prints the gate mode. The final summary and `status` also
flag tasks completed with no recorded output files, so a hollow run is visible.

### Check status

```bash
npm run workflow-engine -- status
```

### Replay a single failed task

```bash
npm run workflow-engine -- replay P1-T1
npm run workflow-engine -- replay P2.3 --harness opencode
```

### Pause & stop the engine

The engine runs detached, so it stops **gracefully after the current task** —
the in-flight task finishes, state is saved as `paused`, and `run` resumes from
the last completed task. Two commands request it:

```bash
npm run workflow-engine -- pause   # write a pause request (docs/engine-control.json)
npm run workflow-engine -- stop    # pause + SIGTERM the engine PID (docs/engine.pid)
```

`pause` writes a request to `docs/engine-control.json`; the engine polls it at
the top of each task wave and stops. `stop` does the same and additionally sends
`SIGTERM` to the PID the engine recorded in `docs/engine.pid` at startup, so a
live run stops even while a task is executing (still after that task completes).
Ctrl+C / SIGTERM on the engine process itself triggers the same graceful stop via
an in-process signal flag.

Resume the run at any time with `run` - the engine reads `docs/WORKFLOW-STATE.json`
and continues from the last completed task. If no engine is running, `pause`/`stop`
flip the state status so the next `run` honors the request (stop is a no-op when
the workflow is complete).

`forge-launcher resume` offers "Stop the engine after the current task" when it
detects a live run, and its resume/monitor commands reuse the last configured
engine options (see `docs/engine-config.json`).

---

## Harness Adapters

The engine is harness-agnostic. Select the backend with `--harness`:

| Adapter | Flag | How it invokes agents |
|---|---|---|
| **OpenCode CLI** (default) | `--harness opencode` | `opencode run --model <m> [--agent <name>] --dir <repo> "<task prompt>"` |
| **GitHub Copilot CLI** | `--harness copilot` | `copilot -p "/agent <name> <task prompt>" --yolo` (native for `.github/agents/`; inline-persona fallback otherwise) |
| **OpenAI API** | `--harness openai` | `POST /v1/chat/completions` with agent rawBody as system prompt |
| **Stub** | `--harness stub` | Returns synthetic success; no real calls (for testing) |
| **FlowForge Kernel CLI** | `--harness flowforge-kernel` | Hands off task execution to `flowforge run` against a compiled `.workforce` package |

### OpenCode adapter environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_BIN` | `opencode` | Path to the opencode binary |
| `OPENCODE_EXTRA_FLAGS` | *(empty)* | Extra flags appended to every `opencode run` call |
| `FORGE_ENGINE_ATTACH` | *(empty)* | `1` to force the `opencode serve` keep-alive for the run (`--keep-alive`); `0` to force cold start per task (`--no-keep-alive`); unset = adaptive (keep-alive when >1 task remains) |
| `FORGE_ENGINE_ATTACH_URL` | *(empty)* | Attach tasks to an existing `opencode serve` URL instead of cold-starting per task (`--attach`) |
| `FORGE_ENGINE_NATIVE_AGENT` | *(empty)* | `0` to force the inline-persona fallback instead of `--agent <name>` for `.opencode/` agents |

### Copilot adapter environment variables

| Variable | Default | Purpose |
|---|---|---|
| `COPILOT_BIN` | `copilot` | Path to the GitHub Copilot CLI binary |
| `COPILOT_EXTRA_FLAGS` | *(empty)* | Extra flags appended to every `copilot -p` call (e.g. `--model gpt-4o`) |

The copilot adapter selects the forge agent **natively** when its file lives
under the project's `.github/agents/` directory: it prepends the `/agent <name>`
directive to the prompt so the Copilot CLI loads the persona itself, and the
persona is **not** inlined. For other harness roots (`.agents`, `.claude`,
`.opencode`) Copilot cannot discover the agent files, so it falls back to
inlining the agent file body into the prompt. Tool permissions are auto-approved
with `--yolo`, mirroring the opencode adapter's `--auto`.

The opencode adapter selects the forge agent natively when its file lives under
the project's `.opencode/agents/` directory: it passes `--agent <name>` so
opencode loads the persona itself (sessions show the forge agent, not the
default build agent) and does **not** inline it. For other harness roots
(`.agents`, `.claude`, `.github`) opencode cannot discover the agent files, so it
falls back to inlining the persona (`agent.rawBody`) as an inline context block.
Tool permissions are auto-approved with `--auto` in both cases.

Set **`FORGE_ENGINE_NATIVE_AGENT=0`** on either harness to force the
inline-persona fallback instead of native agent selection (`--agent` /
`/agent`).

### OpenAI adapter environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | *(required)* | API key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for compatible APIs |
| `OPENAI_MODEL` | `gpt-4o` | Default model (overridden by agent `model:` frontmatter) |

### Stub adapter environment variables

| Variable | Default | Purpose |
|---|---|---|
| `STUB_FAIL_TASK_IDS` | *(empty)* | Comma-separated task IDs to fail synthetically |
| `STUB_DELAY_MS` | `0` | Simulated latency per task in milliseconds |

### FlowForge kernel adapter environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FLOWFORGE_KERNEL_BIN` | `flowforge` | Path to the FlowForge CLI |
| `FLOWFORGE_WORKFORCE_PATH` | *(auto-detected from `docs/KERNEL-BRIDGE.json`)* | Optional override for the compiled workforce package directory |
| `FLOWFORGE_WORKFLOW_ID` | `forge-build` | Workflow id inside the workforce package |
| `FLOWFORGE_KERNEL_MOCK` | `false` | When `true`, append `--mock` to the kernel command |
| `FLOWFORGE_KERNEL_EXTRA_FLAGS` | *(empty)* | Extra flags appended to the kernel command |
| `FLOWFORGE_KERNEL_COMMAND_ARGS_JSON` | *(empty)* | Optional JSON array of command args using `{repoRoot}`, `{workforce}`, `{workflow}`, `{taskId}`, `{agent}` placeholders |
| `FLOWFORGE_VALIDATE_WORKFORCE` | `true` | Run workforce validation gate before first task dispatch |

---

## Output Files

| File | Purpose |
|---|---|
| `docs/WORKFLOW-STATE.json` | Machine-readable run state - task statuses, retries, outputs, blockers |
| `docs/PROGRESS.md` | Human-readable progress (synced after every task, compatible with `forge-orchestrate-build` format) |
| `docs/EXECUTION-AUDIT.jsonl` | Append-only audit trail for every state transition |

---

## State Model

`docs/WORKFLOW-STATE.json` structure:

```json
{
  "runId": "uuid",
  "startedAt": "ISO-timestamp",
  "lastUpdatedAt": "ISO-timestamp",
  "manifestPath": "docs/EXECUTION-MANIFEST.json",
  "manifestVersion": "1.0",
  "harness": "opencode",
  "status": "running | paused | complete | failed",
  "currentPhase": "1",
  "tasks": {
    "1.1": {
      "taskId": "1.1",
      "status": "complete | running | pending | failed | skipped",
      "ownerAgent": "api-engineer",
      "startedAt": "ISO-timestamp",
      "completedAt": "ISO-timestamp",
      "attempt": 1,
      "outputFiles": ["src/api/routes.ts"],
      "agentOutput": "..."
    }
  },
  "blockers": [],
  "auditLog": []
}
```

---

## DAG Execution Order

The engine builds a live task graph from `EXECUTION-MANIFEST.json`:

1. Phases execute in dependency order (Phase 2 only starts after all Phase 1 tasks are complete or skipped).
2. Within a phase, tasks with resolved dependencies run first.
3. Tasks with no unresolved dependencies within a ready phase run immediately (sequential for safety in MVP mode).
4. A task whose `ownerAgent` cannot be matched to a discovered `.md` agent file is **skipped** with a warning rather than failing the run. Skipped tasks satisfy dependencies (they are treated as done), so a skipped task never blocks a downstream phase.

---

## Retry Logic

Each task is retried up to `--max-retries` times (default: 2) before being marked failed.

- Delay between retries defaults to 5 000 ms (`--retry-delay-ms`).
- A failed task blocks all downstream tasks in the same phase.
- Use `npm run workflow-engine -- replay <task-id>` to re-run a single failed task after fixing the root cause.

---

## Resume Behaviour

- `run` is idempotent: if `docs/WORKFLOW-STATE.json` already exists, the engine continues from the last non-complete task.
- Tasks marked `complete` or `skipped` are never re-executed.
- If the run was `paused`, `run` resumes it.
- If the run was `failed`, `run` resumes by re-trying tasks that are not yet complete (use `replay` to target a specific task).

---

## Integration with forge-launcher (terminal-driven build path)

The launcher is the canonical terminal entry point. Its auto-draft stages run
`forge-build-agent-team` headlessly and then offer to start the engine detached;
`forge-launcher engine-run` compiles the manifest and runs/resumes the engine as
a foreground or detached process:

```bash
forge-launcher engine-run --repo <repo> --harness opencode --yes        # run or resume
forge-launcher engine-run --repo <repo> --harness opencode --yes --viz  # with the Forge Board
forge-launcher resume --repo <repo>                                      # re-enter at the current stage
```

This gives the same project two mutually exclusive execution modes for a given run: interactive/prompt-driven (via `@project-orchestrator` in a chat harness) or autonomous/harness-driven (via this engine, from the terminal or `@workflow-orchestrator`).

For FlowForge-kernel execution, compile a workforce package first:

```bash
cd .agents/skills/forge-workforce-compiler && npm install && npm run forge-workforce-compiler -- compile
cd .agents/skills/forge-workflow-engine   && npm install && npm run workflow-engine -- run --harness flowforge-kernel
```

---

## Gotchas

- **Manifest must exist first.** The engine reads `docs/EXECUTION-MANIFEST.json` - it does not re-parse the PRD. If the PRD changes after a compile, re-run `forge-execution-adapter compile` and then start a fresh run.
- **State is tied to a run ID.** Compiling a new manifest after a partial run will produce a manifest that no longer matches the in-progress state. Start a new run (`rm docs/WORKFLOW-STATE.json`) rather than mixing them.
- **OpenCode must be in `$PATH`.** The `opencode` adapter shells out to the binary. If OpenCode is installed at a non-standard path, set `OPENCODE_BIN`.
- **Per-task cold start is the main harness overhead.** Every fresh `opencode run` re-boots config, skills, and all MCP servers. The engine now defaults to adaptive keep-alive (warm `opencode serve` when >1 task remains) to avoid this; pass `--no-keep-alive` to force cold starts.
- **Attach mode needs a healthy server.** Keep-alive (forced or adaptive) polls `GET /global/health` before dispatching and fails fast if `opencode serve` cannot start. Reusing `--attach` against a dead URL fails per task - start the server first.
- **Agent file paths must be absolute or resolvable from the repo root.** Discovery reads the agent `.md` file and sets `agent.path`. For `.opencode/agents/` files the adapter passes `--agent <name>` and skips the inline persona; for other harness roots it inlines `agent.rawBody` into the prompt.
- **Parallelism is opt-in and harness-gated.** The engine executes the ready-task frontier concurrently up to `--concurrency <n>` (default `1` = sequential). Only harness adapters that declare `supportsConcurrency` are parallelized; **same-owner tasks are always serialized** (at most one task per agent per wave), and repo-editing harnesses still rely on the dependency graph for file isolation. Cross-owner tasks on shared paths remain the operator's responsibility. See ADR-021.

---

## Artifact Pattern

The engine implements the **Task → Agent → Artifact → Task** pattern described in the MyForge research. Instead of passing the full workflow state or previous agent output to each agent, the engine:

1. Resolves which artifact types the next task declares as `inputs`
2. Loads only those artifacts from `docs/artifacts/`
3. Projects a compact summary (the fields the agent actually needs)
4. Prepends the projection block to the agent's prompt

This is the primary mechanism for **context-window efficiency** — especially useful with small local models.

### Declaring artifact contracts in the manifest

`forge-execution-adapter compile` **auto-declares** `produces` (and `inputs`)
for every task it emits, so the artifact layer is on by default — no hand-editing
required:

```json
{
  "id": "1.2",
  "produces": "work.1.2",
  "inputs": ["work.1.1"]
}
```

- **`inputs`** — list of artifact type strings the engine will load and project before running this task. The compiler wires each task to the previous task's `produces` (the linear dependency chain).
- **`produces`** — the artifact type the engine records for this task. If the agent does not write one explicitly, the engine synthesises a minimal one from the task's outputs.

You can still hand-edit `docs/EXECUTION-MANIFEST.json` to use semantic types
(e.g. `solution.architecture`, `implementation.result`, `test.result`) or to
declare cross-task `inputs` beyond the linear chain — the compiler's defaults are
just the starting point.

### Artifact storage layout

```
docs/artifacts/
  architecture/
    architecture-001.json
  implementation/
    implementation-001.json
    implementation-002.json
  review/
    review-001.json
```

Each artifact is a small JSON document with a `summary` field, an optional `payload`, and metadata (`taskId`, `producedBy`, `inputs`, `filesChanged`, `nextActions`).

### Audit events

Two new events appear in `docs/EXECUTION-AUDIT.jsonl`:

```jsonc
// Emitted once per projected context (before task starts)
{
  "event": "context.projected",
  "taskId": "review-api",
  "sourceTokenEstimate": 12480,
  "projectedTokenEstimate": 2180,
  "reductionPercent": 82.5
}

// Emitted once per artifact created (after task completes)
{
  "event": "artifact.created",
  "taskId": "implement-api",
  "artifactId": "implementation-001",
  "artifactType": "implementation.result",
  "inputArtifacts": ["architecture-001"]
}
```

The `reductionPercent` field is the quantitative proof-of-value: it records how much context was *not* sent to the agent.

### Skipping the artifact pattern

Tasks without `inputs` or `produces` are unaffected. The artifact layer is strictly additive — an existing hand-written manifest that omits them continues to work unchanged (the engine simply skips artifact creation and projection for those tasks).

---

## Validation

Before reporting a run complete:

- [ ] `docs/WORKFLOW-STATE.json` exists and `status` is `"complete"`
- [ ] All tasks in the manifest are `"complete"` or `"skipped"` in the state file
- [ ] `docs/PROGRESS.md` reflects the completed state
- [ ] `docs/EXECUTION-AUDIT.jsonl` contains a `run.complete` event
- [ ] No tasks have `status: "failed"` (if any do, the run status will be `"failed"`, not `"complete"`)
- [ ] For each task with `produces`, a corresponding artifact file exists in `docs/artifacts/`

---

## References

- Architecture decision: [ADR-017 — Artifact Store and Context Projection](../../../../docs/adr/017-artifact-store-and-context-projection.md)
- Pattern deep-dive: [docs/artifact-store-deep-dive.md](../../../../docs/artifact-store-deep-dive.md)
- Implementation: [`scripts/artifacts.ts`](scripts/artifacts.ts)
- ADR-014: [Dynamic Workflow Orchestration](../../../../docs/adr/014-dynamic-workflow-orchestration.md)
- ADR-016: [Forge Workforce Compiler and Kernel Handoff](../../../../docs/adr/016-forge-workforce-compiler-and-kernel-handoff.md)
