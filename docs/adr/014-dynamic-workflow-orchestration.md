# ADR-014: Dynamic Workflow Orchestration via `forge-workflow-engine`

**Date:** 2026-08-11
**Status:** Accepted

---

## Context

Agent Forge already provides a complete authoring pipeline and two modes of prompt-driven orchestration:

- `forge-auto-build` chains PRD generation, team building, and build execution in a single meta-skill with one pre-flight gate.
- `project-orchestrator` + `forge-orchestrate-build` coordinate agents conversationally, phase by phase.
- `forge-execution-adapter` (ADR-011) compiles a neutral `docs/EXECUTION-MANIFEST.json` contract for external runners.

The execution adapter closes the **compilation gap** - there is now a structured, machine-readable contract that describes every phase, task, owning agent, dependency, expected output, and validation command. What it does not provide is a **runtime loop** that actually reads that contract and fires invocations against a real execution harness.

This leaves three gaps:

### Gap 1: No runtime driver

Every execution path in the current system terminates at a prompt instruction ("call this agent now"). There is no process that picks up `EXECUTION-MANIFEST.json` and autonomously dispatches agent invocations, waits for results, validates outputs, retries on failure, and advances the task graph - without a human in the loop.

### Gap 2: No machine-readable run state

`docs/PROGRESS.md` is the canonical progress store, but it is a human-readable markdown file. There is no structured state file that an external process can read to determine which tasks are complete, which are running, what outputs were produced, and how many retries remain. Resuming a run requires parsing markdown.

### Gap 3: No harness abstraction

Each prompt-driven flow assumes a specific execution context (the active chat harness). Teams that want to execute Agent Forge builds in CI/CD pipelines, scheduled jobs, or alternative CLI tools (OpenCode, direct API calls) have no supported integration path. ADR-011 introduces the concept of an "external runner" but does not provide a harness abstraction layer.

---

## Decision

We introduce a new **`forge-workflow-engine` skill package** and a companion **`workflow-orchestrator` agent** that together provide the missing runtime layer.

### 1. Scope

The engine starts where `forge-execution-adapter` ends:

- `docs/EXECUTION-MANIFEST.json` exists and is current
- Generated `.agent.md` files exist under the active harness root
- A supported execution harness is available (`opencode` in `$PATH`, or `OPENAI_API_KEY` set)

The engine is responsible for:

- Reading the execution manifest and building a live task graph (DAG)
- Maintaining `docs/WORKFLOW-STATE.json` as the machine-readable run state
- Dispatching each task to the configured harness adapter
- Retrying failed tasks up to a configurable limit
- Syncing `docs/PROGRESS.md` and appending `docs/EXECUTION-AUDIT.jsonl` after every state transition
- Providing a CLI for `run`, `status`, `replay`, and `pause` operations

The engine is **not** responsible for:

- PRD authoring, team generation, model assignment, or manifest compilation
- Replacing `forge-auto-build` or `project-orchestrator`
- Acting as the execution backend itself (that responsibility belongs to the harness adapter)

### 2. Three-layer architecture

The skill package is organized around three layers:

**Layer 1: State management** (`scripts/state.ts`)

- Reads and writes `docs/WORKFLOW-STATE.json`
- Provides pure functions for state transitions: `markTaskStarted`, `markTaskComplete`, `markTaskFailed`, `markTaskSkipped`
- Syncs `docs/PROGRESS.md` after every mutation so the human-readable view stays consistent
- Appends audit events to `docs/EXECUTION-AUDIT.jsonl`

**Layer 2: Harness adapters** (`scripts/harness/`)

A pluggable interface that decouples the engine from any specific execution backend:

```ts
interface HarnessAdapter {
  name: string;
  invoke(agent, task, context, repoRoot): Promise<TaskResult>
}
```

Three adapters ship in MVP:

| Adapter | Class | Invocation strategy |
|---|---|---|
| OpenCode CLI | `OpenCodeAdapter` | Shells out to `opencode run --model … --system-prompt <agent.md> "<prompt>"` |
| OpenAI API | `OpenAIAdapter` | Sends agent `rawBody` as system prompt, task description as user message |
| Stub | `StubAdapter` | Returns synthetic results; configurable failures via env var |

**Layer 3: DAG engine** (`scripts/engine.ts`)

- Loads the manifest and state
- Determines ready tasks (phase dependencies resolved, task dependencies complete)
- Dispatches ready tasks through the harness adapter sequentially (MVP; parallel dispatch deferred)
- Advances state after each result; stops on unresolvable failures
- Supports resume from any interruption point via `WORKFLOW-STATE.json`

### 3. State model

`docs/WORKFLOW-STATE.json` is the machine counterpart of `docs/PROGRESS.md`. Key differences:

| Concern | `PROGRESS.md` | `WORKFLOW-STATE.json` |
|---|---|---|
| Primary audience | Humans | Machines / the engine CLI |
| Mutability | Overwritten each sync | Overwritten each sync (audit log is append-only) |
| Task granularity | Completed + current | All tasks with full status, outputs, retries |
| Retry tracking | Not tracked | `attempt` counter per task |
| Agent output | Not stored | Stored as `agentOutput` string |

Both files coexist. The engine always syncs `PROGRESS.md` after every task so `forge-orchestrate-build`-style resume remains compatible.

### 4. DAG ordering

Phase-level dependencies from the manifest are honored first: Phase N does not start until all tasks in Phase N−1 are complete. Within a phase, task-level dependencies are resolved: a task only becomes ready when all tasks listed in its `dependencies` array are complete.

In MVP mode, ready tasks within a phase execute sequentially. Speculative parallelism is deferred because safely parallel dispatch requires the harness to guarantee isolation between concurrent invocations, which cannot be assumed of all backends.

### 5. Retry policy

Each task is retried up to `--max-retries` times (default: 2) with a configurable delay (default: 5 000 ms). A task that exhausts retries is marked `failed`. Any failed task stops the current phase and prevents downstream tasks from starting. The `replay` CLI command resets a failed task to `pending` and re-dispatches it, allowing targeted recovery without re-running the whole workflow.

### 6. Integration with forge-auto-build (optional Stage 5)

`forge-auto-build` can optionally invoke this engine after Stage 4 (prompt-driven build phases). When a user wants the build executed through a real harness rather than via prompt instructions, they compile the manifest and run the engine:

```bash
# Stage 5 (optional): harness-driven execution
cd .agents/skills/forge-execution-adapter && npm install && npm run forge-execution-adapter -- compile
cd .agents/skills/forge-workflow-engine  && npm install && npm run workflow-engine -- run --harness opencode
```

This is additive - `forge-auto-build` Stages 1–4 are unchanged. The engine is an opt-in alternative to Stage 4's prompt-driven orchestration, not a replacement for it.

### 7. Companion agent: `workflow-orchestrator`

A new `templates/agents/workflow-orchestrator.md` agent provides a human-facing interface to the engine. It handles:

- Pre-run verification and confirmation
- CLI invocation and status reporting
- Blocker escalation and replay coordination
- Post-run summaries and next-step suggestions

The agent is a thin shell: all execution logic lives in the skill, mirroring the `project-orchestrator` → `forge-orchestrate-build` pattern established in ADR-001.

### 8. Bootstrap integration

`scripts/bootstrap.sh` and `scripts/bootstrap.ps1` already iterate `templates/skills/*/` and copy each package. No changes to the bootstrap scripts are required. New projects bootstrapped after this ADR will automatically include `forge-workflow-engine` in `.agents/skills/`.

Similarly, `templates/agents/workflow-orchestrator.md` is in `templates/agents/`, which the bootstrap scripts also copy.

---

## Consequences

### Positive

- **Dark orchestration is now possible.** Teams can execute a full Agent Forge build without a human in the loop after the pre-run gate, including in CI/CD pipelines and scheduled jobs.
- **Harness-agnostic.** The adapter interface means any execution backend (OpenCode, direct API, future runners) can be used without changing the engine.
- **Machine-readable run state.** `docs/WORKFLOW-STATE.json` gives external tooling a stable contract for querying task status, outputs, and retry history.
- **Resume across machines.** Because all state is in files, a paused or interrupted run can be resumed from any machine that has the repository.
- **Non-breaking.** All existing prompt-driven flows are unchanged. Teams that prefer interactive orchestration continue to use `project-orchestrator` and `forge-auto-build` exactly as before.
- **Auto-deployed by bootstrap.** No bootstrap changes needed; the skill and agent are included automatically.

### Negative

- **Harness availability is a runtime precondition.** If `opencode` is not in `$PATH`, or `OPENAI_API_KEY` is not set, the engine fails at startup. This is a deployment concern that each team must manage.
- **Sequential execution in MVP.** Tasks within a phase execute one at a time. Parallel dispatch - which could significantly reduce wall-clock time on large projects - is deferred until a backend isolation model is defined.
- **Heuristic agent matching.** The engine inherits the manifest's owner-agent assignments, which are heuristic matches from `forge-execution-adapter`. Unmatched tasks are skipped rather than failed, which is safe but may produce incomplete builds if the agent team is sparse.
- **New TypeScript dependency.** Like `forge-execution-adapter`, this skill requires `npm install` before use. The `node_modules` directory is not committed.

### Neutral

- **`docs/WORKFLOW-STATE.json` is a new generated artifact.** It should be added to `.gitignore` in projects that do not want run state committed, or committed for audit purposes in teams that prefer a full history.
- **`project-orchestrator` and `workflow-orchestrator` are complementary.** The prompt playbook documents both so users can choose based on their context (interactive vs. autonomous).
- **The audit log is shared.** `forge-execution-adapter` and the workflow engine both append to `docs/EXECUTION-AUDIT.jsonl`. Events are distinguishable by their `action` field.

---

## References

- Skill: [forge-workflow-engine](../../templates/skills/forge-workflow-engine/SKILL.md)
- Agent: [workflow-orchestrator](../../templates/agents/workflow-orchestrator.md)
- Skill: [forge-execution-adapter](../../templates/skills/forge-execution-adapter/SKILL.md)
- Skill: [forge-auto-build](../../templates/skills/forge-auto-build/SKILL.md)
- Agent: [project-orchestrator](../../templates/agents/project-orchestrator.md)
- ADR: [ADR-001 Agent/Skill Separation and Progress Reporting](001-agent-skill-separation-and-progress-reporting.md)
- ADR: [ADR-009 Full Auto Build Meta-Skill](009-full-auto-build-meta-skill.md)
- ADR: [ADR-011 Forge Execution Adapter](011-forge-execution-adapter.md)
