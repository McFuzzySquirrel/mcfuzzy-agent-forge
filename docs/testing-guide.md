# McFuzzy Agent Forge – Manual Testing Guide

This guide walks you through a concrete end-to-end scenario you can run by hand to verify that the forge pipeline works as expected.  It covers six capabilities in sequence:

1. **Skill creation from the team builder** – confirming `forge-build-agent-team` invokes `skill-creator` and enforces the `skill-review` quality gate.
2. **Workflow engine (dark orchestration)** – verifying that `forge-workflow-engine` can execute a compiled manifest autonomously.
3. **End-to-end with forge-launcher** – testing the full journey from zero to autonomous execution.
4. **Dark orchestration with the OpenAI harness** – running the workflow engine against the OpenAI API directly (no `opencode` or `claude` CLI required).
5. **Workforce compiler + kernel handoff path** – compiling a `.workforce` package, validating it, and running the workflow engine with `--harness flowforge-kernel`.
6. **Artifact store and context projection** – verifying that the engine writes typed JSON artifacts to `docs/artifacts/`, projects a minimal context block per task, and emits the expected audit events.

---

## A note on "dark orchestration"

The term **dark orchestration** is used throughout Agent Forge documentation and is not a security concern or anything harmful. It simply means **background execution with no human in the loop**: once the pre-run gate is accepted, the workflow engine dispatches agent invocations, waits for results, retries failures, and advances the task graph on its own - you do not need to approve each step. Think of it the same way you would a CI/CD pipeline: it runs "in the dark" (unattended) until it finishes or hits a blocker that needs human input.

This is the explicit opposite of the interactive `project-orchestrator` flow, where a human confirms each phase before the next one starts.

---

## Prerequisites

- An agent harness that reads agents and skills from a repository (GitHub Copilot, Claude Code, OpenCode, etc.)
- `node` ≥ 18 and `npm` installed (required for `forge-workflow-engine` and `forge-execution-adapter`)
- A fresh Git repository to run the test in (do not use an existing project)

---

## Part 1 – Skill Creation from the Team Builder

### Setup

**1. Create and bootstrap a test repository.**

```bash
mkdir ~/forge-test && cd ~/forge-test
git init
# Run the bootstrap from your Agent Forge clone
bash /path/to/mcfuzzy-agent-forge/scripts/bootstrap.sh
git add -A && git commit -m "bootstrap"
```

**2. Write a minimal PRD at `docs/PRD.md`.**

Use a PRD that contains at least one *repeating* pattern - that is what triggers skill creation. The notification example below works well:

```markdown
# Task Manager PRD

## Overview
A simple task manager that sends email notifications when tasks are created and when tasks are completed.

## Tech Stack
Node.js, Express, PostgreSQL

## Implementation Phases
Phase 1: API scaffolding
Phase 2: Task CRUD
Phase 3: Notification delivery (fires for task-created and task-completed events)
```

Commit the PRD:
```bash
git add docs/PRD.md && git commit -m "add PRD"
```

---

### Test Steps

**Step 1 – Invoke the team builder**

In your harness, run:
```
/forge-build-agent-team Build an agent team from docs/PRD.md
```

**Check ✓** The skill responds by detecting **Full Build** mode and confirms it is reading `docs/PRD.md`.

---

**Step 2 – Observe Step 4: Identify Reusable Skills**

Watch for the agent to reach Step 4 of its process. It should name one or more candidate skills (e.g. `send-notification`) and explain *why* the pattern is reusable.

**Check ✓** The agent explicitly names proposed skills with a reason. If it lists them silently and jumps straight to writing agent files, that is the bug.

---

**Step 3 – Confirm `skill-creator` is invoked**

For each identified skill, the agent should say it is running `skill-creator` and then walk through the five-step interview:

> "I'll now run `skill-creator` to create `send-notification` through the structured workflow."

**Check ✓** You see `skill-creator` interview questions for each skill (Step 1 of `skill-creator`). The agent does not silently write a skill file without the interview.

---

**Step 4 – Confirm `skill-review` runs before the skill is finalized**

After scaffolding each skill, the agent should invoke `skill-review` and present a six-axis quality report.

**Check ✓** Every axis scores ≥ 2.0 before the skill is handed to any agent. If a score is below 2.0, the agent should fix and re-review - not proceed.

---

**Step 5 – Test the hard stop when `skill-creator` is unavailable**

To verify the guardrail:

```bash
# Temporarily hide skill-creator
mv .agents/skills/skill-creator .agents/skills/_skill-creator-hidden
git add -A && git commit -m "test: hide skill-creator"
```

Re-run the team builder on the same PRD.

**Check ✓** The agent stops and reports that `skill-creator` is not available. It does **not** silently fall back to the raw template without telling you. Restore the skill when done:

```bash
mv .agents/skills/_skill-creator-hidden .agents/skills/skill-creator
git add -A && git commit -m "restore skill-creator"
```

---

**Step 6 – Inspect the output files**

After a successful run:

```bash
ls .agents/agents/   # *.md agent files
ls .agents/skills/   # skill directories, each with SKILL.md
```

**Check ✓** Each skill directory has:
- Valid YAML frontmatter with `name:` matching the directory name exactly
- A `## Validation` section with concrete checks
- A `## Gotchas` section with at least two project-specific entries

---

**Step 7 – Verify full PRD coverage**

Ask the agent to run its own Step 7:
```
Review the generated team against docs/PRD.md and confirm every functional requirement maps to exactly one agent.
```

**Check ✓** The agent produces a coverage table with no gaps, no duplicates, and no requirements mapped to more than one owner.

---

### Part 1 Pass/Fail Summary

| Check | Expected |
|---|---|
| Team builder reaches Step 4 and names candidate skills with reasons | ✅ |
| `skill-creator` interview runs for each skill | ✅ |
| `skill-review` scores every axis ≥ 2.0 before finalizing | ✅ |
| Hard stop when `skill-creator` is missing (no silent fallback) | ✅ |
| Output files exist with correct naming and required sections | ✅ |
| Full PRD coverage, no overlapping agent responsibilities | ✅ |

---

## Part 2 – Workflow Engine (Dark Orchestration)

This part verifies the autonomous execution layer. Recall: **dark orchestration means the engine runs unattended between the pre-run gate and the end of the build**. You approve once at the start; everything after that is automatic until the engine finishes or hits a blocker.

### Prerequisites for Part 2

- `opencode` in `$PATH`, **or** `OPENAI_API_KEY` set in your environment
- `forge-execution-adapter` compiled: `cd .agents/skills/forge-execution-adapter && npm install`
- `forge-workflow-engine` installed: `cd .agents/skills/forge-workflow-engine && npm install`

---

### Test Steps

**Step 1 – Prepare a workflow-engine-ready project**

Either:
- run Stages 1–3 of `forge-auto-build` and then start the engine path with `GO --workflow-engine`, or
- use the team you generated in Part 1 and compile a manifest manually.

The manifest must exist at `docs/EXECUTION-MANIFEST.json` before the engine can start.

If you don't have a manifest yet, compile one:
```bash
cd .agents/skills/forge-execution-adapter
npm run forge-execution-adapter -- compile
```

**Check ✓** `docs/EXECUTION-MANIFEST.json` exists and is non-empty.

---

**Step 2 – Start the engine (pre-run gate)**

```bash
cd .agents/skills/forge-workflow-engine
npm run workflow-engine -- run --harness opencode
```

The engine prints a pre-run summary (phases, task count, harness) and asks you to confirm before proceeding.

**Check ✓** You see the pre-run summary. The engine does **not** start dispatching tasks until you confirm.

---

**Step 3 – Confirm and observe autonomous execution**

Type `yes` (or the harness-specific confirmation) to proceed.

**Check ✓** The engine dispatches tasks one by one, printing status lines like:
```
[Phase 1 / Task 1] project-architect → scaffolding ... ok
[Phase 1 / Task 2] backend-engineer → database schema ... ok
```
No human input is required between tasks - this is dark orchestration in action.

---

**Step 4 – Check run state**

In a second terminal while the engine is running (or after it completes):

```bash
npm run workflow-engine -- status
```

**Check ✓** `docs/WORKFLOW-STATE.json` exists and shows per-task status (`pending` / `running` / `complete` / `failed`) plus retry counts. `docs/PROGRESS.md` should match.

---

**Step 5 – Test resume after interruption**

Kill the engine mid-run (`Ctrl+C`). Then restart it:

```bash
npm run workflow-engine -- run --harness opencode
```

**Check ✓** The engine resumes from the last incomplete task - it does not re-run tasks already marked `complete` in `WORKFLOW-STATE.json`.

---

**Step 6 – Test retry and replay**

Force a task failure by setting `FORGE_STUB_FAIL_TASK=<task-id>` and running with the stub adapter:

```bash
FORGE_STUB_FAIL_TASK=backend-engineer-phase2-task1 \
  npm run workflow-engine -- run --harness stub
```

**Check ✓** The engine retries the task up to the configured limit (default: 2), then marks it `failed` and stops the phase. Downstream tasks are not started.

Replay the failed task:
```bash
npm run workflow-engine -- replay --task backend-engineer-phase2-task1
```

**Check ✓** Only the replayed task re-runs; all previously completed tasks remain untouched.

---

### Part 2 Pass/Fail Summary

| Check | Expected |
|---|---|
| `EXECUTION-MANIFEST.json` compiled successfully | ✅ |
| Pre-run gate shown before any tasks fire | ✅ |
| Tasks execute autonomously (no human input between tasks) | ✅ |
| `WORKFLOW-STATE.json` and `PROGRESS.md` kept in sync | ✅ |
| Resume skips already-complete tasks | ✅ |
| Failed task retried, then stopped; replay re-runs only that task | ✅ |

---

## Part 3 – End-to-End with forge-launcher (Dark Orchestration)

This part tests the full journey from zero to autonomous execution using `forge-launcher` to set up the repository and then running the workflow engine through dark orchestration. It combines the launcher's onboarding flow with the Parts 1 and 2 checks in a single pass.

### Prerequisites for Part 3

- All prerequisites from Parts 1 and 2
- `forge-launcher.sh` (Linux / macOS) or `forge-launcher.ps1` (Windows) in `scripts/`
- `gh` CLI installed and authenticated, **or** a parent directory writable for a local `git init`

---

### Test Steps

**Step 1 – Run forge-launcher to create and bootstrap a fresh repository**

From the root of your `mcfuzzy-agent-forge` clone:

```bash
./scripts/forge-launcher.sh
```

Walk through the prompts:

- **Step 2 (Harness):** Choose your harness. For a dark-orchestration test, option `2` (opencode) or `3` (Claude Code) is recommended because the engine supports those harnesses directly.
- **Step 3 (Repo):** Provide a name such as `forge-dark-test` and accept the defaults.
- **Step 5 (Idea):** Enter a short idea that implies at least one repeating pattern, for example:
  ```
  A simple task manager that sends email notifications when tasks are created and when tasks are completed.
  Node.js, Express, PostgreSQL.
  ```
- **Step 6 (PRD):** Skip if you don't have an existing PRD; the pipeline will generate one.
- **Step 8 (Auto-build):** Answer `n` - you will start the build manually in the next step.

**Check ✓** The launcher prints `forge-launcher: Complete` and reports the repo path, harness, and `docs/IDEA.md` path. The harness directory (`.opencode/`, `.claude/`, `.github/`, or `.agents/`) exists and contains agent and skill templates.

---

**Step 2 – Verify the repository layout**

```bash
cd <repo-path-from-launcher-summary>
ls docs/           # IDEA.md (and optionally PRD.md)
ls <harness-dir>/agents/   # agent templates
ls <harness-dir>/skills/   # skill templates
```

**Check ✓** `docs/IDEA.md` (and root `IDEA.md`) exists and contains the idea text you entered. Agent and skill templates are in the correct harness directory.

---

**Step 3 – Start the either/or auto-build flow**

In your harness (Copilot Chat, opencode, or Claude Code), run:

```
/forge-auto-build Use docs/IDEA.md as the project idea
```

At the pre-flight gate, choose the workflow-engine path:

```
GO --workflow-engine
```

This runs Stages 1–3, then Stage 4 via the workflow engine path. That path installs the required execution packages, compiles `docs/EXECUTION-MANIFEST.json`, and starts the engine. Alternatively, compile the manifest manually:

```bash
cd <harness-dir>/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

**Check ✓** `docs/EXECUTION-MANIFEST.json` exists and is non-empty, and the workflow-engine path begins instead of the prompt-driven `forge-orchestrate-build` path.

---

**Step 4 – Confirm skill creation used skill-creator (Part 1 gate)**

During Stage 3 (team builder), watch for the same checks from Part 1:

**Check ✓** `skill-creator` interview runs for each reusable skill identified. `skill-review` scores every axis ≥ 2.0 before any skill is finalised.

---

**Step 5 – Start the workflow engine (dark orchestration)**

```bash
cd <harness-dir>/skills/forge-workflow-engine
npm install
npm run workflow-engine -- run --harness <your-harness>
```

Replace `<your-harness>` with `opencode`, `claude`, `github`, or `stub`.

The engine prints a pre-run summary and pauses for confirmation.

**Check ✓** You see the pre-run gate. The engine does **not** dispatch tasks until you type `yes`.

---

**Step 6 – Confirm and observe autonomous execution**

Type `yes` to proceed.

**Check ✓** Tasks execute one by one with status lines and no human input between them - this is dark orchestration running end-to-end from a launcher-bootstrapped repository.

---

**Step 7 – Verify state files**

```bash
cat docs/WORKFLOW-STATE.json   # per-task status
cat docs/PROGRESS.md           # human-readable summary
```

**Check ✓** Both files exist and reflect the completed tasks. `docs/EXECUTION-AUDIT.jsonl` contains one event per task dispatch.

---

### Non-interactive variant (CI)

You can run the entire setup unattended:

```bash
export FORGE_HARNESS_CHOICE="2"          # opencode
export FORGE_REPO_NAME="forge-dark-ci"
export FORGE_REPO_PARENT_DIR="/tmp"
export FORGE_IDEA="A task manager with email notifications. Node.js, Express, PostgreSQL."
export FORGE_YN_DEFAULT="n"
./scripts/forge-launcher.sh --non-interactive
```

Then run the functional test script to assert the expected layout:

```bash
./scripts/test-forge-launcher.sh
```

**Check ✓** All assertions pass (`0 failed`). Proceed to Steps 3–7 above in the newly created repository.

---

### Part 3 Pass/Fail Summary

| Check | Expected |
|---|---|
| forge-launcher completes and reports the repo path | ✅ |
| Harness directory and templates exist in the correct location | ✅ |
| `docs/IDEA.md` contains the entered idea text | ✅ |
| `EXECUTION-MANIFEST.json` compiled successfully | ✅ |
| `skill-creator` interview ran for each skill; `skill-review` ≥ 2.0 on all axes | ✅ |
| Pre-run gate shown before any tasks fire | ✅ |
| Tasks execute autonomously (no human input between tasks) | ✅ |
| `WORKFLOW-STATE.json`, `PROGRESS.md`, and `EXECUTION-AUDIT.jsonl` all present | ✅ |

---

## Part 4 – Dark Orchestration with the OpenAI Harness

This part verifies that the workflow engine can execute a compiled manifest by calling the OpenAI API directly. **No `opencode`, `claude`, or other CLI harness is required** — only an API key and Node.js. Use this path when you want to run dark orchestration on any machine that already has internet access and an OpenAI (or compatible) API key.

### Prerequisites for Part 4

- All prerequisites from Part 2 (`forge-execution-adapter` compiled, `forge-workflow-engine` installed)
- `OPENAI_API_KEY` set in your environment (see Step 1 below)
- `node` ≥ 18 and `npm` installed
- `docs/EXECUTION-MANIFEST.json` must exist before starting the engine

---

### Test Steps

**Step 1 – Verify your API key is exported**

```bash
echo $OPENAI_API_KEY     # should print a non-empty value starting with sk-
```

If it is empty, export it now:

```bash
export OPENAI_API_KEY=sk-...your-key-here...
```

Optionally smoke-test connectivity to the API:

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: ******" \
  https://api.openai.com/v1/models
```

**Check ✓** The `curl` command returns `200`. A `401` means the key is invalid or not exported; a `429` means you have hit a rate limit.

---

**Step 2 – (Optional) Set model and base URL overrides**

The engine defaults to `gpt-4o` and `https://api.openai.com/v1`. Override either with environment variables before running:

```bash
# Use a different model
export OPENAI_MODEL=gpt-4o-mini

# Azure OpenAI or any OpenAI-compatible endpoint
export OPENAI_BASE_URL=https://<your-resource>.openai.azure.com/openai/deployments/<deployment>/

# Local LLM with an OpenAI-compatible API (e.g. LM Studio, Ollama with openai-compat)
export OPENAI_BASE_URL=http://localhost:11434/v1
export OPENAI_MODEL=llama3
```

Individual agents can still override the model via their `model:` frontmatter field; the environment variable is the fallback default.

**Check ✓** Variables are set as intended (`echo $OPENAI_MODEL`, `echo $OPENAI_BASE_URL`). Leave them unset to use the OpenAI defaults.

---

**Step 3 – Dry-run with the stub harness first**

Always validate engine wiring with a stub run before spending tokens:

```bash
cd .agents/skills/forge-workflow-engine
npm run workflow-engine -- run --harness stub
```

Add `STUB_DELAY_MS` to simulate realistic task latency and expose any timing issues before committing to a real run:

```bash
STUB_DELAY_MS=500 npm run workflow-engine -- run --harness stub
```

**Check ✓** The engine runs through all tasks, printing status lines for each, and exits cleanly. `docs/WORKFLOW-STATE.json` shows every task as `complete`. If any task shows `failed`, investigate before proceeding to the OpenAI run.

---

**Step 4 – Start the engine with the OpenAI harness**

```bash
cd .agents/skills/forge-workflow-engine
npm run workflow-engine -- run --harness openai
```

The engine prints a pre-run summary showing the harness, phase count, task count, and model, then waits for confirmation:

```
Forge Workflow Engine – Pre-run Summary
  Harness : openai
  Model   : gpt-4o  (override with OPENAI_MODEL)
  Phases  : 3
  Tasks   : 12
Type "yes" to start dark orchestration, or Ctrl+C to abort.
```

**Check ✓** You see the pre-run summary. The engine does **not** dispatch any tasks until you confirm. The summary correctly shows `harness: openai`.

---

**Step 5 – Confirm and observe autonomous execution**

Type `yes` to proceed.

**Check ✓** The engine dispatches tasks one by one, printing status lines like:

```
[Phase 1 / Task 1] project-architect → scaffolding ... ok
[Phase 1 / Task 2] backend-engineer → database schema ... ok
```

No human input is required between tasks. Each task consumes real API tokens; monitor `docs/EXECUTION-AUDIT.jsonl` for a per-task record of every dispatch:

```bash
# Stream the audit log as tasks complete
tail -f docs/EXECUTION-AUDIT.jsonl | jq .
```

**Check ✓** `docs/EXECUTION-AUDIT.jsonl` grows with one event per task. Each event includes the task ID, agent name, model, and a timestamp.

---

**Step 6 – Resume after interruption and replay a failed task**

Kill the engine mid-run (`Ctrl+C`). Then restart:

```bash
npm run workflow-engine -- run --harness openai
```

**Check ✓** The engine resumes from the last incomplete task. Tasks already marked `complete` in `docs/WORKFLOW-STATE.json` are not re-run and no additional tokens are consumed for them.

To replay a single failed task:

```bash
npm run workflow-engine -- replay <task-id> --harness openai
```

**Check ✓** Only the replayed task re-runs against the OpenAI API. All other completed tasks remain untouched.

---

**Step 7 – Azure OpenAI and compatible-API variant**

Set `OPENAI_BASE_URL` to your Azure endpoint before running:

```bash
export OPENAI_API_KEY=<your-azure-api-key>
export OPENAI_BASE_URL=https://<resource-name>.openai.azure.com/openai/deployments/<deployment-name>/
export OPENAI_MODEL=<deployment-name>    # Azure uses the deployment name as the model

npm run workflow-engine -- run --harness openai
```

For any other endpoint that exposes the OpenAI chat completions API (LM Studio, vLLM, Together AI, etc.):

```bash
export OPENAI_BASE_URL=https://api.together.xyz/v1
export OPENAI_MODEL=meta-llama/Llama-3-70b-chat-hf
npm run workflow-engine -- run --harness openai
```

**Check ✓** The pre-run summary shows the overridden `OPENAI_BASE_URL` and model. Tasks complete successfully against the alternative endpoint.

---

### Part 4 Pass/Fail Summary

| Check | Expected |
|---|---|
| `OPENAI_API_KEY` exported and `/v1/models` returns `200` | ✅ |
| Stub dry-run completes with all tasks `complete` | ✅ |
| Pre-run gate shown before any tasks fire (harness shows `openai`) | ✅ |
| Tasks execute autonomously; no human input required between tasks | ✅ |
| `EXECUTION-AUDIT.jsonl` grows with one event per task | ✅ |
| Resume skips already-complete tasks; no duplicate token usage | ✅ |
| Replay re-runs only the targeted task | ✅ |
| Azure / compatible-API variant works with `OPENAI_BASE_URL` override | ✅ |

---

## Part 5 – Workforce Compiler + FlowForge Kernel Handoff

This part verifies the v3.6 packaging and kernel handoff path: compile Forge artifacts into a `.workforce` package, validate package shape, then execute the workflow engine using `--harness flowforge-kernel`.

### Prerequisites for Part 5

- All prerequisites from Part 2 (`forge-execution-adapter` compiled, `forge-workflow-engine` installed)
- `forge-workforce-compiler` installed: `cd .agents/skills/forge-workforce-compiler && npm install`
- A generated agent team and skills under your active harness root
- `docs/EXECUTION-MANIFEST.json` exists
- Optional: FlowForge CLI installed and available as `flowforge` (or set `FLOWFORGE_KERNEL_BIN`)

---

### Test Steps

**Step 1 – Inspect compiler inputs**

```bash
cd .agents/skills/forge-workforce-compiler
npm run forge-workforce-compiler -- inspect
```

**Check ✓** Output reports a valid `repoRoot`, a detected `harnessRoot`, and non-zero `agentCount`/`skillCount`.

---

**Step 2 – Compile workforce package**

```bash
npm run forge-workforce-compiler -- compile
```

**Check ✓** Compile succeeds and writes:

- `dist/<package-id>.workforce/workforce.json`
- `dist/<package-id>.workforce/workflows/<workflow-id>.json`
- `docs/KERNEL-BRIDGE.json`

Also confirm `docs/KERNEL-BRIDGE.json` contains a non-empty `taskNodeMap`.

---

**Step 3 – Run explicit validation**

```bash
npm run forge-workforce-compiler -- validate
```

**Check ✓** Validation returns `"ok": true` with `errorCount: 0`.

---

**Step 4 – Exercise workflow-engine kernel handoff**

In one terminal, switch to the workflow engine skill:

```bash
cd ../forge-workflow-engine
```

If you have the FlowForge CLI available, run:

```bash
FLOWFORGE_KERNEL_MOCK=true npm run workflow-engine -- run --harness flowforge-kernel
```

If you do not have FlowForge CLI yet, run a contract-level smoke test with `echo` as the kernel binary:

```bash
FLOWFORGE_KERNEL_BIN=echo npm run workflow-engine -- run --harness flowforge-kernel
```

**Check ✓** The pre-run summary shows `harness: flowforge-kernel`, then tasks dispatch without requiring human input between tasks once confirmed.

---

**Step 5 – Verify adapter package-path resolution and validation gate**

Unset any explicit path override and run again:

```bash
unset FLOWFORGE_WORKFORCE_PATH
FLOWFORGE_KERNEL_BIN=echo npm run workflow-engine -- run --harness flowforge-kernel
```

**Check ✓** The adapter resolves workforce path from `docs/KERNEL-BRIDGE.json` and starts dispatching tasks.

Now force a broken path:

```bash
FLOWFORGE_WORKFORCE_PATH=dist/does-not-exist.workforce \
FLOWFORGE_KERNEL_BIN=echo \
npm run workflow-engine -- run --harness flowforge-kernel
```

**Check ✓** Run fails fast with a workforce-path/validation error instead of silently dispatching tasks against missing artifacts.

---

### Part 5 Pass/Fail Summary

| Check | Expected |
|---|---|
| `forge-workforce-compiler -- inspect` detects repo, harness, and artifacts | ✅ |
| `forge-workforce-compiler -- compile` writes workforce package + bridge file | ✅ |
| `docs/KERNEL-BRIDGE.json` contains non-empty `taskNodeMap` | ✅ |
| `forge-workforce-compiler -- validate` reports `ok: true` | ✅ |
| Workflow engine runs with `--harness flowforge-kernel` and pre-run gate appears | ✅ |
| Adapter resolves package path from `KERNEL-BRIDGE.json` when no override is set | ✅ |
| Invalid workforce path fails fast with an explicit error | ✅ |

---

## Part 6 – Artifact Store and Context Projection

This part verifies the v3.7 artifact store and context projection path: the engine writes compact, typed JSON artifacts to `docs/artifacts/` after each task, projects only the relevant artifacts as the context block for the next agent, and records token-reduction telemetry in the audit log.

### Prerequisites for Part 6

- All prerequisites from Part 2 (`forge-execution-adapter` compiled, `forge-workflow-engine` installed)
- `docs/EXECUTION-MANIFEST.json` exists (compiled by the execution adapter)
- The manifest must have at least one task that declares `produces` and at least one task that declares `inputs`. See the sample below if you need to add these fields.

**Minimal manifest extension example** — edit `docs/EXECUTION-MANIFEST.json` and add `inputs`/`produces` to two tasks:

```json
{
  "id": "architecture-task",
  "title": "Design system architecture",
  "ownerAgent": "project-architect",
  "dependencies": [],
  "expectedOutputs": ["docs/ARCHITECTURE.md"],
  "validationCommands": [],
  "approvalRequired": false,
  "produces": "solution.architecture"
},
{
  "id": "implement-api-task",
  "title": "Implement API layer",
  "ownerAgent": "backend-engineer",
  "dependencies": ["architecture-task"],
  "expectedOutputs": ["src/api/index.ts"],
  "validationCommands": [],
  "approvalRequired": false,
  "inputs": ["solution.architecture"],
  "produces": "implementation.result"
}
```

Tasks that declare neither `inputs` nor `produces` continue to work unchanged — the artifact layer is additive.

---

### Test Steps

**Step 1 – Run the engine with the stub harness**

Use the stub adapter so tasks complete immediately without a live harness:

```bash
cd .agents/skills/forge-workflow-engine
npm run workflow-engine -- run --harness stub
```

Confirm at the pre-run gate and let the run complete.

**Check ✓** The run completes without errors and `docs/WORKFLOW-STATE.json` shows all tasks `"complete"`.

---

**Step 2 – Verify artifact files were created**

```bash
ls -R docs/artifacts/
```

**Check ✓** A `docs/artifacts/` directory exists and contains at least one subdirectory (e.g. `architecture/`, `implementation/`) with `*.json` artifact files.

Inspect one file:

```bash
cat docs/artifacts/architecture/architecture-001.json
```

**Check ✓** The file is valid JSON and contains at minimum the fields `id`, `type`, `createdAt`, `taskId`, `producedBy`, and `summary`.

---

**Step 3 – Verify task records link to artifacts**

```bash
cat docs/WORKFLOW-STATE.json | python3 -m json.tool | grep -A4 "artifactId"
```

(If `python3` is not available, open `docs/WORKFLOW-STATE.json` in any editor.)

**Check ✓** Tasks that declared `produces` have a non-null `"artifactId"` field. Tasks that declared `inputs` have a non-empty `"inputArtifactIds"` array.

---

**Step 4 – Verify context projection audit events**

```bash
grep "context.projected" docs/EXECUTION-AUDIT.jsonl
```

**Check ✓** At least one line contains `"event":"context.projected"` with `sourceTokenEstimate`, `projectedTokenEstimate`, and `reductionPercent` fields — confirming the projection layer fired before the consuming task.

Example expected output:

```json
{"timestamp":"...","action":"context.projected","taskId":"implement-api-task","sourceTokenEstimate":9840,"projectedTokenEstimate":1720,"reductionPercent":82.5}
```

---

**Step 5 – Verify artifact.created audit events**

```bash
grep "artifact.created" docs/EXECUTION-AUDIT.jsonl
```

**Check ✓** One `"artifact.created"` event exists for each task that declared `produces`, each containing `artifactId`, `artifactType`, and `inputArtifacts`.

---

**Step 6 – Confirm tasks without artifact declarations are unaffected**

Run the engine on a manifest that has no `inputs`/`produces` fields at all:

```bash
# Remove inputs/produces temporarily (or use a clean manifest copy)
npm run workflow-engine -- run --harness stub
```

**Check ✓** The run completes without errors. No `docs/artifacts/` directory is created (or the existing one is unchanged). The audit log contains no `artifact.created` or `context.projected` events for those tasks.

---

**Step 7 – Confirm artifact data persists across resume**

Start a run, kill it after the first task completes (`Ctrl+C`), then resume:

```bash
npm run workflow-engine -- run --harness stub
# Ctrl+C after first task
npm run workflow-engine -- run --harness stub
```

**Check ✓** On resume, the artifact file written by the first task still exists in `docs/artifacts/`. The engine does not attempt to recreate it; it reads it from the store when projecting context for downstream tasks.

---

### Part 6 Pass/Fail Summary

| Check | Expected |
|---|---|
| Engine completes run without errors | ✅ |
| `docs/artifacts/` created with typed JSON files | ✅ |
| Each artifact file contains `id`, `type`, `createdAt`, `taskId`, `producedBy`, `summary` | ✅ |
| Tasks with `produces` have non-null `artifactId` in `WORKFLOW-STATE.json` | ✅ |
| Tasks with `inputs` have non-empty `inputArtifactIds` in `WORKFLOW-STATE.json` | ✅ |
| `context.projected` events present in audit log with token telemetry | ✅ |
| `artifact.created` events present in audit log for each producing task | ✅ |
| Tasks with no `inputs`/`produces` declarations complete without errors | ✅ |
| Artifact files survive a resume cycle and are not re-written | ✅ |

---

## Quick Reference: Key File Locations

| File | Purpose |
|---|---|
| `.agents/agents/*.md` | Generated specialist agents |
| `.agents/skills/*/SKILL.md` | Generated and forge skills |
| `docs/PRD.md` | Input requirements document |
| `docs/EXECUTION-MANIFEST.json` | Compiled task graph for the engine |
| `docs/WORKFLOW-STATE.json` | Machine-readable run state (generated at runtime) |
| `docs/PROGRESS.md` | Human-readable progress (kept in sync by engine) |
| `docs/EXECUTION-AUDIT.jsonl` | Append-only event log (generated at runtime) |
| `dist/<package-id>.workforce/workforce.json` | Compiled FlowForge-compatible package manifest |
| `dist/<package-id>.workforce/workflows/<workflow-id>.json` | Generated workflow definition for kernel runtimes |
| `docs/KERNEL-BRIDGE.json` | Task↔workflow-node mapping and kernel handoff metadata |
| `docs/artifacts/<type>/<id>.json` | Typed JSON artifact files written by the engine (one per producing task) |

---

## Troubleshooting

**`skill-creator` not found**
The bootstrap script must have run successfully. Check that `.agents/skills/skill-creator/SKILL.md` exists.

**`opencode: command not found`**
Install OpenCode or set `OPENAI_API_KEY` and use `--harness openai` instead.

**Engine exits immediately with "manifest not found"**
Run `forge-execution-adapter -- compile` first to generate `docs/EXECUTION-MANIFEST.json`.

**Skill `name:` mismatch warning**
The `name:` field in a skill's YAML frontmatter must match the directory name exactly. Edit the frontmatter to fix it.

**`401 Unauthorized` from the OpenAI harness**
Your `OPENAI_API_KEY` is missing, expired, or incorrect. Re-export the correct key and retry.

**`FLOWFORGE_WORKFORCE_PATH is not set ...` when using `flowforge-kernel`**
Compile first (`npm run forge-workforce-compiler -- compile`) so `docs/KERNEL-BRIDGE.json` includes `workforcePath`, or set `FLOWFORGE_WORKFORCE_PATH` explicitly.

**`docs/artifacts/` is empty after a run**
Only tasks that declare a `produces` field write artifacts. If no tasks in your manifest have `produces`, no artifact files are created — this is expected. Add the field to any task you want to participate in the artifact pattern.

**`context.projected` events missing from audit log**
Context projection only fires for tasks that declare at least one entry in `inputs`. Confirm the consuming task has `"inputs": ["<artifact-type>"]` in `docs/EXECUTION-MANIFEST.json` and that a prior task already created an artifact of that type.

**Artifact file is missing for a task that declares `produces`**
If the task failed or was skipped, no artifact is written. Check `docs/WORKFLOW-STATE.json` for the task's `status` and `errorMessage`. Replay the task (`npm run workflow-engine -- replay --task <task-id>`) to retry after fixing the underlying issue.

**`forge-workforce-compiler skill was not found` in kernel mode**
The workflow engine could not find the compiler skill under your harness root. Re-run bootstrap or restore `forge-workforce-compiler` under `.agents/skills/` (or your active harness equivalent).

**`429 Too Many Requests` from the OpenAI harness**
You have hit the API rate limit. Wait a moment and re-run, or add `--retry-delay-ms 15000` to give the engine more time between retries: `npm run workflow-engine -- run --harness openai --retry-delay-ms 15000`.

**`model_not_found` error from the OpenAI harness**
The value of `OPENAI_MODEL` (or an agent's `model:` frontmatter field) does not match a model available to your API key. Check your OpenAI account's model access and update `OPENAI_MODEL` accordingly.

**Azure endpoint returns `404` or `ResourceNotFound`**
`OPENAI_BASE_URL` for Azure must include the deployment name and end with a trailing slash, e.g. `https://<resource>.openai.azure.com/openai/deployments/<deployment>/`. Also ensure `OPENAI_MODEL` matches the deployment name exactly.
