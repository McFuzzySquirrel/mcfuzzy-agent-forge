# McFuzzy Agent Forge – Manual Testing Guide

This guide walks you through a concrete end-to-end scenario you can run by hand to verify that the forge pipeline works as expected.  It covers two capabilities in sequence:

1. **Skill creation from the team builder** – confirming `forge-build-agent-team` invokes `skill-creator` and enforces the `skill-review` quality gate.
2. **Workflow engine (dark orchestration)** – verifying that `forge-workflow-engine` can execute a compiled manifest autonomously.

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
ls .agents/agents/   # *.agent.md files
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

**Step 1 – Run the full forge pipeline through Stage 4**

Complete Stages 1–4 of `forge-auto-build` (or use the team you generated in Part 1 if it has an `EXECUTION-MANIFEST.json`). The manifest must exist at `docs/EXECUTION-MANIFEST.json` before the engine can start.

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

**Step 3 – Run the forge pipeline through Stage 4 to produce an execution manifest**

In your harness (Copilot Chat, opencode, or Claude Code), run:

```
/forge-auto-build Use docs/IDEA.md as the project idea
```

Wait for the pipeline to complete Stages 1–4 and produce `docs/EXECUTION-MANIFEST.json`. Alternatively, compile the manifest manually:

```bash
cd <harness-dir>/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

**Check ✓** `docs/EXECUTION-MANIFEST.json` exists and is non-empty.

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

## Quick Reference: Key File Locations

| File | Purpose |
|---|---|
| `.agents/agents/*.agent.md` | Generated specialist agents |
| `.agents/skills/*/SKILL.md` | Generated and forge skills |
| `docs/PRD.md` | Input requirements document |
| `docs/EXECUTION-MANIFEST.json` | Compiled task graph for the engine |
| `docs/WORKFLOW-STATE.json` | Machine-readable run state (generated at runtime) |
| `docs/PROGRESS.md` | Human-readable progress (kept in sync by engine) |
| `docs/EXECUTION-AUDIT.jsonl` | Append-only event log (generated at runtime) |

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
