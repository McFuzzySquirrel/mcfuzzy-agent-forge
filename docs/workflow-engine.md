# Workflow Engine

> The autonomous execution layer for Agent Forge. Reads a compiled `docs/EXECUTION-MANIFEST.json` and drives every task to completion through a pluggable harness — no human prompting between tasks.

---

## Overview

`forge-workflow-engine` is the "dark orchestration" half of Agent Forge. Where `forge-auto-build` and `project-orchestrator` run *inside* a chat harness as prompt-driven orchestrators, this engine runs **outside** the chat session as a standalone Node process:

1. Reads `docs/EXECUTION-MANIFEST.json` (the compiled build contract).
2. Builds a task DAG and walks it phase-by-phase, task-by-task.
3. Dispatches each task to a **harness adapter** (`opencode`, `copilot`, `openai`, `stub`, or `flowforge-kernel`).
4. Persists state after every transition, so a run can be resumed, replayed, or audited at any time.

It is the execution alternative to the prompt-driven flows: choose `GO --workflow-engine` inside `forge-auto-build`, or run it directly once a manifest exists.

---

## Prerequisites

- A compiled manifest at `docs/EXECUTION-MANIFEST.json` (produced by `forge-execution-adapter`).
- Agent `.md` files under the harness agents directory (`.opencode/agents/`, `.claude/agents/`, `.github/agents/`, or `.agents/agents/`).
- A configured harness — the `opencode` CLI in `$PATH` (default), `copilot`, an `OPENAI_API_KEY`, or the FlowForge kernel.
- `node >= 18` and `npm` at *build time* (the engine's `node_modules/` is installed on first run, not committed).

If the manifest does not exist yet, compile it first:

```bash
cd <harness-dir>/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

---

## Getting started

### Directly (inside the repo)

```bash
cd <harness-dir>/skills/forge-workflow-engine
npm install
npm run workflow-engine -- run --harness opencode --yes
```

### Standalone runner (any terminal, CI, or `nohup`)

```bash
forge-launcher engine-run --repo <repo-dir> --harness opencode --yes
# or the legacy wrapper: ./scripts/forge-engine-run.sh --repo <repo-dir> --harness opencode --yes
```

This installs the adapter and engine dependencies, compiles the manifest if missing, then runs the engine in the foreground. Add `--dry-run` to print the command sequence without executing it.

### Via `forge-auto-build`

At `forge-auto-build`'s pre-flight gate, type `GO --workflow-engine`. The team is generated, the manifest is compiled, and the engine starts **detached** (log: `docs/engine-run.log`) while `forge-auto-build` polls `docs/WORKFLOW-STATE.json` to completion.

---

## Harness adapters

The engine is harness-agnostic. Select the backend with `--harness`:

| Adapter | Flag | How it invokes agents |
|---|---|---|
| **OpenCode CLI** (default) | `--harness opencode` | `opencode run --auto --dir <repo> "<agent body + task prompt>"` |
| **GitHub Copilot CLI** | `--harness copilot` | `copilot -p "<agent body + task prompt>" --yolo` |
| **OpenAI API** | `--harness openai` | `POST /v1/chat/completions` with the agent `rawBody` as the system prompt |
| **Stub** | `--harness stub` | Returns synthetic success; no real calls (for testing) |
| **FlowForge Kernel CLI** | `--harness flowforge-kernel` | Hands off to `flowforge run` against a compiled `.workforce` package |

The `opencode` and `copilot` adapters inline the agent persona into the prompt
(neither CLI has a `--system-prompt` flag) and run the child process
asynchronously, so the engine's heartbeat stays responsive.

---

## CLI reference

```
npm run workflow-engine -- run     [--repo <path>] [--harness <name>] [--max-retries <n>]
                                   [--retry-delay-ms <ms>] [--heartbeat-ms <ms>]
                                   [--concurrency <n>] [--task-timeout-ms <ms>] [--yes]
npm run workflow-engine -- status  [--repo <path>]
npm run workflow-engine -- replay  <task-id> [--repo <path>] [--harness <name>]
npm run workflow-engine -- pause   [--repo <path>]
```

| Flag | Default | Purpose |
|---|---|---|
| `--repo <path>` | detected (walks up for `.git`) | Repository root |
| `--harness <name>` | `opencode` | Backend: `opencode`, `copilot`, `openai`, `stub`, `flowforge-kernel` |
| `--max-retries <n>` | `2` | Attempts per task before it is marked `failed` |
| `--retry-delay-ms <ms>` | `5000` | Delay between retries |
| `--heartbeat-ms <ms>` | `15000` | Heartbeat interval while a task runs; `0` disables |
| `--concurrency <n>` | `1` | Max ready tasks to run in parallel (see *Parallel dispatch* below) |
| `--task-timeout-ms <ms>` | `600000` (10 min) | Per-task timeout before the harness call is killed; a task's own `timeoutMs` in the manifest overrides this |
| `--yes` | *(off)* | Skip the interactive pre-run gate |

### Pre-run gate

Before dispatching, the engine prints a pre-run summary (harness, phases, tasks)
and, when run interactively, pauses for confirmation. The gate is
interactive-only: `--yes` (or `FORGE_ENGINE_YES=1`) skips it explicitly, and it
auto-skips when stdin is not a TTY (CI / headless).

### Heartbeat

A long harness call is silent, which can look like a hang. While a task executes,
the engine prints a heartbeat line every `--heartbeat-ms`:

```
[engine] …still working on task 1.1 (@project-architect, 45s elapsed)
```

### Task timeout

Each task runs against the harness with a per-task timeout (default **10
minutes**). If the harness call does not finish in time, the child is killed and
the task fails (subject to `--max-retries`). Raise it before running:

```
npm run workflow-engine -- run --task-timeout-ms 1500000
FORGE_ENGINE_TASK_TIMEOUT_MS=1500000 npm run workflow-engine -- run
```

Precedence: a task's `timeoutMs` field in `docs/EXECUTION-MANIFEST.json`
overrides the engine-wide value, so one heavy task can get a longer budget
without affecting the rest. Adapters that shell out (`opencode`, `copilot`,
`flowforge-kernel`) enforce it on the child process; `openai` enforces it on the
API call via `AbortController`. See [ADR-022](adr/022-task-granularity-and-configurable-timeout.md).

### Parallel dispatch (opt-in)
By default the engine runs tasks **sequentially** (concurrency `1`). With
`--concurrency <n>` it drains each wave of ready tasks (all tasks whose
dependencies are satisfied) through a bounded worker pool of at most `n` in
flight, merging results in manifest order and saving state once per wave:

```
npm run workflow-engine -- run --harness stub --concurrency 3 --yes
```

Parallelism only applies when the selected harness declares
`supportsConcurrency` (all current adapters do). Repo-editing harnesses rely on
the manifest dependency graph for file isolation - so declare dependencies
correctly before raising `n`. `FORGE_ENGINE_CONCURRENCY` sets the default, and
`forge-launcher engine-run` (or the legacy
`scripts/forge-engine-run.sh` / `.ps1`) accepts `--concurrency <n>` /
`-Concurrency <n>` to pass it through. See [ADR-021](adr/021-parallel-task-dispatch.md).

---

## How a task executes

1. Look up the owning agent by name (unmatched tasks are **skipped**, not failed).
2. Project input artifacts into a compact context block (see *Artifact pattern* below).
3. Mark the task `running`, then invoke the harness — retrying up to `--max-retries` on failure.
4. On success, record the task `complete` (and synthesize a work artifact if `produces` is declared).
5. Save `WORKFLOW-STATE.json` and sync `PROGRESS.md` after every task.

Tasks within a phase run sequentially (MVP); a failed task blocks downstream tasks in that phase, and the run stops with `status: "failed"`. A **skipped** task is treated as done for dependency purposes, so it never blocks the next phase.

> **Owner assignment.** `forge-execution-adapter compile` guarantees every task has an owner: if no agent confidently matches a task, it falls back to an `*orchestrator`-named agent (else the first agent) and records a warning. Unassigned tasks are therefore rare and only arise from a hand-edited manifest — in which case the engine skips them safely rather than deadlocking.

---

## Output files

| File | Purpose |
|---|---|
| `docs/WORKFLOW-STATE.json` | Machine-readable run state: task statuses, attempts, outputs, blockers |
| `docs/PROGRESS.md` | Human-readable progress (synced after every task) |
| `docs/EXECUTION-AUDIT.jsonl` | Append-only audit trail for every state transition |
| `docs/artifacts/<type>/<id>.json` | Typed JSON artifacts written by the artifact store |

---

## Artifact pattern

The engine implements the **Task → Agent → Artifact → Task** hand-off. Rather than
passing the full workflow state to each agent, it passes a compact projection of
the artifacts the task declares as `inputs`.

`forge-execution-adapter compile` **auto-declares** `produces` (and `inputs`) for
every task, so artifacts are written on every successful run by default:

```json
{
  "id": "1.2",
  "produces": "work.1.2",
  "inputs": ["work.1.1"]
}
```

- **`inputs`** — artifact types loaded and projected into this task's context.
  The compiler wires each task to the previous task's `produces`.
- **`produces`** — artifact type recorded for this task. If the agent does not
  write one explicitly, the engine synthesizes a minimal one from its output.

Artifacts live under `docs/artifacts/<type>/<id>.json` (dots in the type become
hyphens, e.g. `work.1.1` → `docs/artifacts/work-1-1/work-1-1-001.json`). You can
hand-edit the manifest to use semantic types (`solution.architecture`,
`implementation.result`) or add cross-task `inputs` beyond the linear chain.

---

## Resume, replay & pause

- **`run`** is idempotent: if `WORKFLOW-STATE.json` exists, the engine continues from the last non-complete task (complete/skipped tasks are never re-run).
- **`replay <task-id>`** re-runs a single failed task after you fix its root cause.
- **`pause`** requests a graceful stop after the current task; `run` resumes a paused run.

To start fresh (e.g. after recompiling the manifest), delete `docs/WORKFLOW-STATE.json` first.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FORGE_ENGINE_YES` | *(unset)* | `1` skips the pre-run gate (same as `--yes`) |
| `FORGE_ENGINE_HEARTBEAT_MS` | `15000` | Heartbeat interval in ms |
| `FORGE_ENGINE_CONCURRENCY` | `1` | Max ready tasks to run in parallel (same as `--concurrency`; only for harnesses that declare `supportsConcurrency`) |
| `FORGE_ENGINE_TASK_TIMEOUT_MS` | `600000` | Per-task timeout in ms (same as `--task-timeout-ms`; per-task manifest `timeoutMs` overrides) |
| `FORGE_ENGINE_HARNESS` | `opencode` | Default harness for the standalone runner |
| `OPENCODE_BIN` | `opencode` | Path to the opencode binary |
| `OPENCODE_EXTRA_FLAGS` | *(empty)* | Extra flags appended to every `opencode run` |
| `COPILOT_BIN` | `copilot` | Path to the copilot binary |
| `COPILOT_EXTRA_FLAGS` | *(empty)* | Extra flags appended to every `copilot -p` (e.g. `--model gpt-4o`) |
| `OPENAI_API_KEY` | *(required)* | API key for the OpenAI adapter |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for compatible APIs |
| `OPENAI_MODEL` | `gpt-4o` | Default model (overridden by agent `model:` frontmatter) |
| `STUB_FAIL_TASK_IDS` | *(empty)* | Comma-separated task IDs to fail synthetically |
| `STUB_DELAY_MS` | `0` | Simulated latency per task for the stub adapter |
| `FLOWFORGE_KERNEL_BIN` / `FLOWFORGE_WORKFORCE_PATH` / `FLOWFORGE_WORKFLOW_ID` / `FLOWFORGE_KERNEL_MOCK` / `FLOWFORGE_KERNEL_EXTRA_FLAGS` / `FLOWFORGE_KERNEL_COMMAND_ARGS_JSON` / `FLOWFORGE_VALIDATE_WORKFORCE` | — | FlowForge kernel hand-off |

---

## Troubleshooting

| Symptom | Fix |
|---|---|---|
| `Execution manifest not found` | Compile it first: `npm run forge-execution-adapter -- compile` |
| Task failed after N attempts | Inspect `docs/EXECUTION-AUDIT.jsonl` / the task's `errorMessage`, fix the cause, then `replay <task-id>` |
| Task failed: `timed out after <N>ms` | The task exceeded its timeout. Either split it into smaller tasks (recompile with fine granularity — the default) or raise the budget with `--task-timeout-ms` / a per-task `timeoutMs` |
| No artifact files written | Recompile the manifest (the compiler auto-declares `produces`); hand-written manifests must declare `produces` |
| Run seems hung | It isn't — watch the heartbeat lines; lower `--heartbeat-ms` for more frequent updates |
| `OpenCode must be in $PATH` | Set `OPENCODE_BIN` to the binary path |

---

## References

- Deep-dive: [`docs/workflow-engine-deep-dive.md`](workflow-engine-deep-dive.md)
- Skill reference: [`templates/skills/forge-workflow-engine/SKILL.md`](../templates/skills/forge-workflow-engine/SKILL.md)
- Artifact store: [`docs/artifact-store-deep-dive.md`](artifact-store-deep-dive.md)
- Launcher: [`docs/forge-launcher.md`](forge-launcher.md)
- Choosing prompt-driven vs engine-driven: [`docs/prompt-playbook.md`](prompt-playbook.md)
- ADR-022: [`task granularity and configurable timeout`](adr/022-task-granularity-and-configurable-timeout.md)
