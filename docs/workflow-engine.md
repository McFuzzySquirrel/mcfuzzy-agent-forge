# Workflow Engine

> The autonomous execution layer for MyForge. Reads a compiled `docs/EXECUTION-MANIFEST.json` and drives every task to completion through a pluggable harness - no human prompting between tasks.

---

## Overview

`forge-workflow-engine` is the "dark orchestration" half of MyForge. Where `project-orchestrator` runs *inside* a chat harness as a prompt-driven orchestrator, this engine runs **outside** the chat session as a standalone Node process:

1. Reads `docs/EXECUTION-MANIFEST.json` (the compiled build contract).
2. Builds a task DAG and walks it phase-by-phase, task-by-task.
3. Dispatches each task to a **harness adapter** (`opencode`, `copilot`, `openai`, `stub`, or `flowforge-kernel`).
4. Persists state after every transition, so a run can be resumed, replayed, or audited at any time.

It is the execution alternative to the prompt-driven flows: start it from the terminal with `forge-launcher engine-run`, drive it in-harness with `@workflow-orchestrator`, or select it inside the `forge-auto-build` terminal fast-path with `GO --workflow-engine`.

---

## Prerequisites

- A compiled manifest at `docs/EXECUTION-MANIFEST.json` (produced by `forge-execution-adapter`).
- Agent `.md` files under the harness agents directory (`.opencode/agents/`, `.claude/agents/`, `.github/agents/`, or `.agents/agents/`).
- A configured harness - the `opencode` CLI in `$PATH` (default), `copilot`, an `OPENAI_API_KEY`, or the FlowForge kernel.
- `node >= 18` and `npm` at *build time* (the engine's `node_modules/` is installed on first run, not committed).

If the manifest does not exist yet, compile it first:

```bash
cd <harness-dir>/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

`compile` auto-detects the PRD representation: monolithic `docs/PRD.md`, or the
**decomposed layout** (`docs/product-vision.md` + `docs/features/*.md`), which
compiles the features in dependency-graph order into feature-tagged phases
(e.g. `BUDGETS-2`). It also runs a team-validation gate (unassigned tasks,
duplicate file owners, orphan agents) and writes
`docs/agent-responsibility-matrix.md` - the engine's pre-run summary prints the
source layout, feature order, and matrix path.

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

> **Prefer a browser?** Run monitoring and control from the **Forge Console**
> (`forge-launcher console`) - a local web UI that reads the same `docs/*`
> artifacts and embeds the Forge Board. See
> [docs/forge-console.md](forge-console.md).

### Via `forge-auto-build` (terminal/headless fast-path)

At `forge-auto-build`'s pre-flight gate, type `GO --workflow-engine`. The team is generated, the manifest is compiled, and the engine starts **detached** (log: `docs/engine-run.log`) while `forge-auto-build` polls `docs/WORKFLOW-STATE.json` to completion. To pick up a run later from any terminal, use `forge-launcher resume` or `forge-launcher engine-run`.

---

## Output verification gate

A harness call that exits 0 is **not** proof a task did anything. The engine
verifies every successful call before marking the task complete:

- **Expected outputs** - every `task.expectedOutputs` must exist after the call.
  Missing → the attempt fails, retries, then the task is marked `failed`.
- **No-op detection** - tasks with no `expectedOutputs` must show file changes in
  the git working tree (diffed before/after the call) or a substantive response.
  A task that changed nothing and replied only "Ready for the task." is a failed
  attempt, never a completion.
- **Relax** with `--allow-noop` / `FORGE_ENGINE_ALLOW_NOOP=1` (expected-output
  check stays).
- **Validation commands** - `--run-validation` / `FORGE_ENGINE_RUN_VALIDATION=1`
  executes each task's manifest `validationCommands` (cwd = repo root) and
  requires exit 0 before completion.

The final run summary and `workflow-engine status` flag tasks completed with no
recorded output files, so a hollow "complete" run is visible. Both the opencode
(`--agent <name>`) and copilot (`/agent <name>`) harnesses select forge agents
natively when their files live under the harness's agents directory;
`FORGE_ENGINE_NATIVE_AGENT=0` forces the inline-persona prompt (the pre-v3.21
behavior) on either harness.

---

## Auto-commit

After each task completes, the engine commits the working tree — one commit per
task, sequenced after the wave merge so it is safe at any `--concurrency`. This
produces a git history aligned with the manifest's task decomposition: review,
bisect, or roll back any single task's work.

- **Default on.** The engine commits by default. Disable with
  `--no-auto-commit` / `FORGE_ENGINE_AUTO_COMMIT=0` (e.g. when you are
  mid-rebase, or the working tree already has changes you don't want mixed with
  agent output).
- **What is committed.** `git add -A` scoped to the repo root, so the task's
  work and the engine-owned files (`docs/WORKFLOW-STATE.json`,
  `docs/EXECUTION-AUDIT.jsonl`, `docs/PROGRESS.md`) land in the same commit.
- **Commit message.** Default
  `feat(forge-engine): complete task {taskId} - {taskTitle}`; override with
  `--commit-message-template` / `FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE` using
  `{taskId}` and `{taskTitle}` placeholders.
- **Non-fatal.** No `.git`, an empty diff ("nothing to commit"), or a failed
  commit (e.g. no git identity) is skipped/logged — it never fails the task or
  the run. A `task.committed` audit event records the SHA of each successful
  commit (visible in `docs/EXECUTION-AUDIT.jsonl` and the console Timeline).
- **See also** [ADR-035](adr/035-auto-commit-after-task.md) for the design
  rationale and the deviation from the research plan (default on).

---

## Upgrading the engine in an existing project

The gate (and this fix) lives entirely in the forge skill code - the PRD,
feature documents, generated agent team, and `docs/EXECUTION-MANIFEST.json` do
**not** need to change. To upgrade a project that was bootstrapped with an older
forge, refresh the skills and reset the run state:

```bash
# 1. Get the fixed forge code (e.g. the release/main branch once merged).
git clone -b <branch> https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git ~/forge-fixed

# 2. Refresh the forge skills in the existing project. --force overwrites only
#    the forge *template* agents and skills (including this engine); generated
#    agents, PRD, features, and the manifest are untouched.
cd ~/forge-fixed/scripts/forge-launcher
npm install && npm run build
node dist/cli.js bootstrap ~/path/to/project --harness <copilot|opencode|claude|agents> --force

# 3. Reset the old run: a completed WORKFLOW-STATE.json makes the engine a no-op.
cd ~/path/to/project
rm -f docs/WORKFLOW-STATE.json
rm -rf docs/artifacts && rm -f docs/EXECUTION-AUDIT.jsonl   # optional cleanup

# 4. Re-run with the strict output gate (default on).
cd ~/forge-fixed/scripts/forge-launcher
node dist/cli.js engine-run --repo ~/path/to/project --harness <copilot|opencode> --yes
```

A hollow task (no expected outputs produced, no file changes, only trivial
output) is now retried then marked `failed` with a reason instead of being
reported complete. Use `--allow-noop` only if the old lenient behavior is
wanted (the expected-output check still applies).

---

## Harness adapters

The engine is harness-agnostic. Select the backend with `--harness`:

| Adapter | Flag | How it invokes agents |
|---|---|---|
| **OpenCode CLI** (default) | `--harness opencode` | `opencode run --auto [--agent <name>] --dir <repo> "<task prompt>"` |
| **GitHub Copilot CLI** | `--harness copilot` | `copilot -p "<agent body + task prompt>" --yolo` |
| **OpenAI API** | `--harness openai` | `POST /v1/chat/completions` with the agent `rawBody` as the system prompt |
| **Stub** | `--harness stub` | Returns synthetic success; no real calls (for testing) |
| **FlowForge Kernel CLI** | `--harness flowforge-kernel` | Hands off to `flowforge run` against a compiled `.workforce` package |

The `copilot` adapter inlines the agent persona into the prompt (there is no
`--system-prompt` flag on `copilot -p`). The `opencode` adapter selects the forge
agent natively when its file lives under the project's `.opencode/agents/`
directory (`--agent <name>`), so sessions show the forge agent rather than the
default build agent; for other harness roots it inlines the persona the same way
the copilot adapter does. Both run the child process asynchronously, so the
engine's heartbeat stays responsive.

---

## CLI reference

```
npm run workflow-engine -- run     [--repo <path>] [--harness <name>] [--max-retries <n>]
                                   [--retry-delay-ms <ms>] [--heartbeat-ms <ms>]
                                   [--concurrency <n>] [--task-timeout-ms <ms>] [--yes]
                                   [--allow-noop] [--run-validation]
                                   [--auto-commit|--no-auto-commit] [--commit-message-template <tmpl>]
                                   [--keep-alive] [--keep-alive-port <n>] [--no-keep-alive] [--attach <url>]
                                   [--viz [port]] [--no-open]
npm run workflow-engine -- status  [--repo <path>]
npm run workflow-engine -- replay  <task-id> [--repo <path>] [--harness <name>]
npm run workflow-engine -- pause   [--repo <path>]
npm run workflow-engine -- stop    [--repo <path>]
npm run workflow-engine -- viz     [--repo <path>] [--port <n>] [--no-open]
```

| Flag | Default | Purpose |
|---|---|---|
| `--repo <path>` | detected (walks up for `.git`) | Repository root |
| `--harness <name>` | `opencode` | Backend: `opencode`, `copilot`, `openai`, `stub`, `flowforge-kernel` |
| `--max-retries <n>` | `2` | Attempts per task before it is marked `failed` |
| `--retry-delay-ms <ms>` | `5000` | Delay between retries |
| `--heartbeat-ms <ms>` | `60000` | Heartbeat interval while a task runs; `0` disables |
| `--concurrency <n>` | `1` | Max ready tasks to run in parallel (see *Parallel dispatch* below) |
| `--task-timeout-ms <ms>` | `600000` (10 min) | Per-task timeout before the harness call is killed; a task's own `timeoutMs` in the manifest overrides this |
| `--yes` | *(off)* | Skip the interactive pre-run gate |
| `--keep-alive` | adaptive | OpenCode harness only: boot one `opencode serve` for the run and attach every task to it, avoiding per-task cold boots (see *Keep-alive attach mode* below). **Default is adaptive** - on when more than one task remains, off for a single-task run |
| `--keep-alive-port <n>` | free port | Port for the engine-managed `opencode serve` instance |
| `--no-keep-alive` | *(off)* | OpenCode harness only: force a cold-start `opencode run` per task (bypasses the adaptive default) |
| `--attach <url>` | *(off)* | Attach tasks to an already-running `opencode serve` instance (e.g. `http://127.0.0.1:4096`) with no lifecycle management |
| `--viz [port]` | *(off)* | Launch the live Forge Board dashboard (default port `4299`, next free port if busy) |
| `--no-open` | *(off)* | Do not auto-open the browser (the URL is still printed) |
| `--allow-noop` | *(off)* | Relax the output-verification no-op gate (missing/trivial output still fails) |
| `--run-validation` | *(off)* | Execute each task's manifest `validationCommands` and require them to pass |
| `--auto-commit` | **on** | Commit the working tree after each completed task (one commit per task; see *Auto-commit* below) |
| `--no-auto-commit` | *(off)* | Disable per-task auto-commit (e.g. mid-rebase or with a dirty working tree) |
| `--commit-message-template <tmpl>` | *(built-in)* | Commit message with `{taskId}` / `{taskTitle}` placeholders; default `feat(forge-engine): complete task {taskId} - {taskTitle}` |

### Pre-run gate

Before dispatching, the engine prints a pre-run summary (harness, phases, tasks,
per-task timeout, max retries, retry delay, concurrency, keep-alive mode) and,
when run interactively, pauses for confirmation. The gate is interactive-only:
`--yes` (or `FORGE_ENGINE_YES=1`) skips it explicitly, and it auto-skips when
stdin is not a TTY (CI / headless).

### Heartbeat

A long harness call is silent, which can look like a hang. While a task executes,
the engine prints a heartbeat line every `--heartbeat-ms`:

```
[engine] …still working on task 1.1 (@project-architect, 45s elapsed)
```

### Keep-alive attach mode (opencode harness)

Cold-starting a fresh `opencode run` for **every task** re-boots the project
instance each time - config, AGENTS.md, skills, agent files, and every MCP
server - and on multi-task runs that per-task overhead can rival the actual model
work. The engine avoids it by attaching tasks to a single warm `opencode serve`
instance. **This is the adaptive default**: keep-alive kicks in automatically
when more than one task remains, and a single-task run (e.g. a short resume)
cold-starts instead so it does not pay the server boot cost.

```
npm run workflow-engine -- run --harness opencode --yes                 # adaptive (default)
npm run workflow-engine -- run --harness opencode --keep-alive --yes    # force keep-alive
npm run workflow-engine -- run --harness opencode --no-keep-alive --yes # force cold start
npm run workflow-engine -- run --harness opencode --keep-alive --keep-alive-port 4096 --yes
```

The engine boots one headless `opencode serve` bound to the repo, waits for
`GET /global/health`, runs every task via `opencode run --attach`, and tears the
server down when the run finishes (even on error). Each attach invocation still
creates a **fresh, isolated session** - the server only keeps the shared project
instance warm, so a task's context never leaks into the next. To reuse a server
you already keep running (e.g. the TUI or a long-lived `opencode serve`), pass
`--attach <url>` and skip the lifecycle management:

```
npm run workflow-engine -- run --harness opencode --attach http://127.0.0.1:4096 --yes
```

Env equivalents: `FORGE_ENGINE_ATTACH=1` (force keep-alive), `FORGE_ENGINE_ATTACH=0`
(force cold start), and `FORGE_ENGINE_ATTACH_URL=<url>` (reuse an existing
server). The engine-spawned server is loopback-only and strips ambient
`OPENCODE_SERVER_*` auth so the engine's own health probe and attach calls
aren't 401'd; attaching to a user-managed authenticated server still works (the
client auto-sends credentials). While attaching, the adapter prints a per-task
startup split (`[opencode] task <id>: boot=… total=…`) so the cold-boot removal
is measurable against `docs/EXECUTION-AUDIT.jsonl`.

### Live visualization (The Forge Board)

Pass `--viz` to run (or `forge-launcher engine-run --viz`) to launch a live
dashboard in your browser at `http://127.0.0.1:4299`:

```
npm run workflow-engine -- run --harness stub --viz --yes
```

The dashboard renders the build as a **kanban board**. Each phase is a
horizontal **band** (auto-sized to its tasks so cards never overlap), and tasks
are **name-tag cards** that flow left-to-right through **To Do · In Progress ·
Done · Failed** as their status changes. Each card carries a procedurally-drawn
**agent face** - deterministic skin/hair tinted per agent (matching its
legend color) with a mouth that reacts: neutral when pending, working when
running, a smile on complete, a frown on failure - plus the agent's name, the
task title, and the task id. Dependency and artifact **edges** connect the
cards (brightening on hover), artifact hand-offs animate as glowing dots, and
`context.projected` shows a `ctx −N%` badge on the producing card.

Interactions: hover a card for a tooltip, **click a card to expand it in place**
with task detail (description, status, owner, phase, duration, artifact, inputs,
dependencies, output files, validation commands, errors), click it again, the
board, or press Escape to collapse it. Drag to pan, scroll to zoom (text stays
crisp up to 2× - the dashboard bakes text at 2× resolution). Events stream over
Server-Sent Events; a snapshot is replayed on every
(re)connect, and the engine persists a task's `running` status so the In
Progress column reflects in-flight work even on a mid-run refresh.

To **attach to an already-running (or detached) engine run**, use the `viz`
subcommand from any terminal - it tails the audit log and serves the same
dashboard:

```
npm run workflow-engine -- viz --repo <repo-dir>
```

Both modes bind to `127.0.0.1` only. Pass `--no-open` to skip auto-opening the
browser (the URL is printed instead). See
[ADR-026](adr/026-forge-board-kanban-dashboard.md) for the redesign and
[ADR-025](adr/025-squirrel-forge-live-workflow-viz.md) for the original design.

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
`supportsConcurrency` (all current adapters do). **Same-owner tasks are always
serialized**: within a wave the engine keeps at most one task per owning agent,
so tasks sharing a subsystem (project dir, build outputs, ports) never run
concurrently even when the dependency graph considers them independent.
Different-owner tasks still parallelize up to `n`. Repo-editing harnesses rely on
the manifest dependency graph plus the same-owner guard for file isolation - so
declare dependencies correctly before raising `n`, and be aware that cross-owner
tasks on shared paths (e.g. one task scaffolding a directory while another
builds inside it) are still the operator's responsibility. `FORGE_ENGINE_CONCURRENCY`
sets the default, and `forge-launcher engine-run` (or the legacy
`scripts/forge-engine-run.sh` / `.ps1`) accepts `--concurrency <n>` /
`-Concurrency <n>` to pass it through. See [ADR-021](adr/021-parallel-task-dispatch.md).

---

## How a task executes

1. Look up the owning agent by name (unmatched tasks are **skipped**, not failed).
2. Project input artifacts into a compact context block (see *Artifact pattern* below).
3. Mark the task `running`, then invoke the harness - retrying up to `--max-retries` on failure.
4. On success, record the task `complete` (and synthesize a work artifact if `produces` is declared).
5. Save `WORKFLOW-STATE.json` and sync `PROGRESS.md` after every task.

Tasks within a phase run sequentially (MVP); a failed task blocks downstream tasks in that phase, and the run stops with `status: "failed"`. A **skipped** task is treated as done for dependency purposes, so it never blocks the next phase.

> **Owner assignment.** `forge-execution-adapter compile` guarantees every task has an owner: if no agent confidently matches a task, it falls back to an `*orchestrator`-named agent (else the first agent) and records a warning. Unassigned tasks are therefore rare and only arise from a hand-edited manifest - in which case the engine skips them safely rather than deadlocking.

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

- **`inputs`** - artifact types loaded and projected into this task's context.
  The compiler wires each task to the previous task's `produces`.
- **`produces`** - artifact type recorded for this task. If the agent does not
  write one explicitly, the engine synthesizes a minimal one from its output.

Artifacts live under `docs/artifacts/<type>/<id>.json` (dots in the type become
hyphens, e.g. `work.1.1` → `docs/artifacts/work-1-1/work-1-1-001.json`). You can
hand-edit the manifest to use semantic types (`solution.architecture`,
`implementation.result`) or add cross-task `inputs` beyond the linear chain.

### Context projection (how it works)

Context projection is the engine's **token firewall**: a downstream task
receives a short typed summary of the artifacts it consumes, never the full
artifact payloads or previous conversations.

When a task declares `inputs`, the engine (`ArtifactStore.project`) takes the
latest **completed** artifact of each input type and keeps only a few fields:
`artifactId`, `type`, `summary`, `confidence` (plus any task-requested
`fields`). `renderProjection` turns that into a compact markdown block
(`## Context from previous tasks`), and the harness adapter prepends only that
block to the agent's prompt - the full `WorkflowState` and the artifact JSONs
are never sent. That is where the tokens are saved: the agent receives a few
lines of summary, not the previous agent's whole output.

The `[engine] Context projected for <task>: ~N tokens (X% reduction from ~M)`
log line is **telemetry, not a billing meter**. `estimateTokens` counts
characters and divides by 4 (the "~4 chars per token" GPT-family rule of thumb)
- see `artifacts.ts`. So "~130 tokens (49.6% reduction from ~258)" means the
full source artifacts were ~258 estimated tokens and the projection is ~130: a
~50% cut **of the artifact bytes**, not of the whole request (the persona file,
task text, and budget hints are unchanged).

What the percentage does *not* mean:

- It is relative to the artifact payloads, not the entire prompt.
- It is a character-count proxy, not the model's real tokenizer.
- It only trims input tokens; output tokens are unaffected.
- The default projection is deliberately tiny (`summary` + `confidence`), so
  the larger the artifacts, the larger the real saving.

Plainly: each task hands off a short typed summary of what it produced, not its
full output; the engine estimates the reduction (~4 chars/token) from the full
payloads to that summary. The mechanism genuinely shrinks what the next agent
receives - the percentage is just an estimate.

---

## Resume, replay, pause & stop

- **`run`** is idempotent: if `WORKFLOW-STATE.json` exists, the engine continues from the last non-complete task (complete/skipped tasks are never re-run).
- **`replay <task-id>`** re-runs a single failed task after you fix its root cause.
- **`pause`** requests a graceful stop after the current task: it writes
  `docs/engine-control.json`, the engine polls it at the top of each task wave,
  finishes the in-flight task, saves state as `paused`, and exits. `run` resumes
  a paused run.
- **`stop`** does the same as `pause` and additionally sends `SIGTERM` to the
  engine PID recorded in `docs/engine.pid` (the engine writes its own PID at
  startup), so a live detached run stops even mid-task - still after the current
  task completes. Ctrl+C / SIGTERM on the engine process triggers the same
  graceful stop via an in-process flag.

To start fresh (e.g. after recompiling the manifest), delete `docs/WORKFLOW-STATE.json` first.

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FORGE_ENGINE_YES` | *(unset)* | `1` skips the pre-run gate (same as `--yes`) |
| `FORGE_ENGINE_HEARTBEAT_MS` | `60000` | Heartbeat interval in ms |
| `FORGE_ENGINE_CONCURRENCY` | `1` | Max ready tasks to run in parallel (same as `--concurrency`; only for harnesses that declare `supportsConcurrency`) |
| `FORGE_ENGINE_TASK_TIMEOUT_MS` | `600000` | Per-task timeout in ms (same as `--task-timeout-ms`; per-task manifest `timeoutMs` overrides) |
| `FORGE_ENGINE_HARNESS` | `opencode` | Default harness for the standalone runner |
| `FORGE_ENGINE_VIZ` | *(unset)* | `1` enables `--viz` on the standalone runner |
| `FORGE_ENGINE_VIZ_PORT` | `4299` | Dashboard port when `--viz` is enabled |
| `FORGE_ENGINE_ATTACH` | *(unset)* | `1` forces the `opencode serve` keep-alive (same as `--keep-alive`); `0` forces cold start per task (same as `--no-keep-alive`); unset = adaptive |
| `FORGE_ENGINE_ATTACH_URL` | *(unset)* | Attach tasks to an existing `opencode serve` URL (same as `--attach`) |
| `FORGE_ENGINE_ALLOW_NOOP` | *(unset)* | `1` relaxes the no-op output gate (same as `--allow-noop`) |
| `FORGE_ENGINE_RUN_VALIDATION` | *(unset)* | `1` runs manifest `validationCommands` per task (same as `--run-validation`) |
| `FORGE_ENGINE_AUTO_COMMIT` | `1` | `0` disables auto-commit after each completed task (same as `--no-auto-commit`); default on |
| `FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE` | *(built-in)* | Commit message template with `{taskId}` / `{taskTitle}` placeholders |
| `OPENCODE_BIN` | `opencode` | Path to the opencode binary |
| `OPENCODE_EXTRA_FLAGS` | *(empty)* | Extra flags appended to every `opencode run` |
| `COPILOT_BIN` | `copilot` | Path to the copilot binary |
| `COPILOT_EXTRA_FLAGS` | *(empty)* | Extra flags appended to every `copilot -p` (e.g. `--model gpt-4o`) |
| `OPENAI_API_KEY` | *(required)* | API key for the OpenAI adapter |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Override for compatible APIs |
| `OPENAI_MODEL` | `gpt-4o` | Default model (overridden by agent `model:` frontmatter) |
| `STUB_FAIL_TASK_IDS` | *(empty)* | Comma-separated task IDs to fail synthetically |
| `STUB_DELAY_MS` | `0` | Simulated latency per task for the stub adapter |
| `FLOWFORGE_KERNEL_BIN` / `FLOWFORGE_WORKFORCE_PATH` / `FLOWFORGE_WORKFLOW_ID` / `FLOWFORGE_KERNEL_MOCK` / `FLOWFORGE_KERNEL_EXTRA_FLAGS` / `FLOWFORGE_KERNEL_COMMAND_ARGS_JSON` / `FLOWFORGE_VALIDATE_WORKFORCE` | - | FlowForge kernel hand-off |

---

## Troubleshooting

| Symptom | Fix |
|---|---|---|
| `Execution manifest not found` | Compile it first: `npm run forge-execution-adapter -- compile` |
| Task failed after N attempts | Inspect `docs/EXECUTION-AUDIT.jsonl` / the task's `errorMessage`, fix the cause, then `replay <task-id>` |
| Task failed: `timed out after <N>ms` | The task exceeded its timeout. Either split it into smaller tasks (recompile with fine granularity - the default) or raise the budget with `--task-timeout-ms` / a per-task `timeoutMs` |
| No artifact files written | Recompile the manifest (the compiler auto-declares `produces`); hand-written manifests must declare `produces` |
| Run seems hung | It isn't - watch the heartbeat lines; lower `--heartbeat-ms` for more frequent updates |
| `OpenCode must be in $PATH` | Set `OPENCODE_BIN` to the binary path |

---

## References

- Deep-dive: [`docs/workflow-engine-deep-dive.md`](workflow-engine-deep-dive.md)
- Skill reference: [`templates/skills/forge-workflow-engine/SKILL.md`](../templates/skills/forge-workflow-engine/SKILL.md)
- Artifact store: [`docs/artifact-store-deep-dive.md`](artifact-store-deep-dive.md)
- Launcher: [`docs/forge-launcher.md`](forge-launcher.md)
- Choosing prompt-driven vs engine-driven: [`docs/prompt-playbook.md`](prompt-playbook.md)
- ADR-022: [`task granularity and configurable timeout`](adr/022-task-granularity-and-configurable-timeout.md)
