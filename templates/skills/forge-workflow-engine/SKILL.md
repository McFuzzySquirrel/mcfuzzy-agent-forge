---
name: forge-workflow-engine
description: >
  Dynamic workflow orchestration engine that reads docs/EXECUTION-MANIFEST.json
  and drives every task to completion through a pluggable harness adapter
  (OpenCode CLI, OpenAI API, or stub). Maintains docs/WORKFLOW-STATE.json for
  machine-readable run state and syncs docs/PROGRESS.md after every task.
  Use this skill after forge-execution-adapter has compiled the manifest.
---

# Skill: Forge Workflow Engine

You are the **runtime execution layer** for an Agent Forge repository. Where `forge-auto-build` and `project-orchestrator` operate as prompt-driven orchestrators inside a chat harness, this skill runs **outside** the chat session - it reads the structured execution contract produced by `forge-execution-adapter` and drives every agent task through a real execution backend until the workflow is complete.

This skill is the autonomous execution alternative to the prompt-driven flows. Teams use it when they want **dark orchestration**: a background process that fires agent invocations autonomously, persists state across interruptions, and requires no human intervention between tasks. In `forge-auto-build`, choosing `GO --workflow-engine` selects this skill as the Stage 4 executor instead of `forge-orchestrate-build`.

---

## Prerequisites

Before running this skill, the following must exist in the repository:

- `docs/EXECUTION-MANIFEST.json` - compiled by `forge-execution-adapter`
- Agent `.agent.md` files under the harness agents directory:
  - `.agents/agents/` (default harness)
  - `.opencode/agents/` (OpenCode harness)
  - `.github/agents/` or `.claude/agents/` (other harnesses)
- A configured execution harness (OpenCode CLI in `$PATH`, or `OPENAI_API_KEY` set)

If the manifest does not exist yet, run the adapter first:

```bash
cd .agents/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

---

## Install & Run

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
npm run workflow-engine -- run --max-retries 3 --retry-delay-ms 10000
```

### Check status

```bash
npm run workflow-engine -- status
```

### Replay a single failed task

```bash
npm run workflow-engine -- replay P1-T1
npm run workflow-engine -- replay P2.3 --harness opencode
```

### Graceful pause after the current task

```bash
npm run workflow-engine -- pause
```

Resume the run at any time with `run` - the engine reads `docs/WORKFLOW-STATE.json` and continues from the last completed task.

---

## Harness Adapters

The engine is harness-agnostic. Select the backend with `--harness`:

| Adapter | Flag | How it invokes agents |
|---|---|---|
| **OpenCode CLI** (default) | `--harness opencode` | `opencode run --model <m> --system-prompt <agent.md> "<prompt>"` |
| **OpenAI API** | `--harness openai` | `POST /v1/chat/completions` with agent rawBody as system prompt |
| **Stub** | `--harness stub` | Returns synthetic success; no real calls (for testing) |

### OpenCode adapter environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_BIN` | `opencode` | Path to the opencode binary |
| `OPENCODE_EXTRA_FLAGS` | *(empty)* | Extra flags appended to every `opencode run` call |

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

1. Phases execute in dependency order (Phase 2 only starts after all Phase 1 tasks are complete).
2. Within a phase, tasks with resolved dependencies run first.
3. Tasks with no unresolved dependencies within a ready phase run immediately (sequential for safety in MVP mode).
4. A task whose `ownerAgent` cannot be matched to a discovered `.agent.md` file is **skipped** with a warning rather than failing the run.

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

## Integration with forge-auto-build (alternative Stage 4 path)

`forge-auto-build` can optionally select this engine as its Stage 4 build path instead of `forge-orchestrate-build`:

```bash
# Stage 4 alternative: harness-driven build path
cd .agents/skills/forge-execution-adapter && npm install && npm run forge-execution-adapter -- compile
cd .agents/skills/forge-workflow-engine  && npm install && npm run workflow-engine -- run --harness opencode
```

This gives the same project two mutually exclusive execution modes for a given run: interactive/prompt-driven (via `project-orchestrator`) or autonomous/harness-driven (via the workflow engine).

---

## Gotchas

- **Manifest must exist first.** The engine reads `docs/EXECUTION-MANIFEST.json` - it does not re-parse the PRD. If the PRD changes after a compile, re-run `forge-execution-adapter compile` and then start a fresh run.
- **State is tied to a run ID.** Compiling a new manifest after a partial run will produce a manifest that no longer matches the in-progress state. Start a new run (`rm docs/WORKFLOW-STATE.json`) rather than mixing them.
- **OpenCode must be in `$PATH`.** The `opencode` adapter shells out to the binary. If OpenCode is installed at a non-standard path, set `OPENCODE_BIN`.
- **Agent file paths must be absolute or resolvable from the repo root.** The adapter passes `--system-prompt <agent.path>` to OpenCode; the path comes from discovery, which returns absolute paths.
- **No speculative parallelism in MVP.** Tasks within a phase execute sequentially even if they have independent dependencies. True parallel dispatch requires a backend that guarantees isolation.

---

## Validation

Before reporting a run complete:

- [ ] `docs/WORKFLOW-STATE.json` exists and `status` is `"complete"`
- [ ] All tasks in the manifest are `"complete"` or `"skipped"` in the state file
- [ ] `docs/PROGRESS.md` reflects the completed state
- [ ] `docs/EXECUTION-AUDIT.jsonl` contains a `run.complete` event
- [ ] No tasks have `status: "failed"` (if any do, the run status will be `"failed"`, not `"complete"`)
