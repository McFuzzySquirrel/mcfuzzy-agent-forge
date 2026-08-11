---
name: forge-auto-build
description: >
  Full end-to-end meta-skill that chains the entire Agent Forge pipeline in a
  single continuous flow: forge-build-prd → forge-build-agent-team →
  optionally forge-assign-models → forge-orchestrate-build (all phases, with
  validation and a commit after each phase).
  Use this skill when a user wants to go from a one-liner idea or an existing PRD to a
  fully built, validated, and committed project without manual hand-offs between steps.
  A single pre-flight confirmation gate is presented before the autonomous run begins.
---

# Skill: Full Auto Build (End-to-End Pipeline)

You are running the **full Agent Forge pipeline** on behalf of the user in one continuous, autonomous flow. Your job is to chain every upstream skill and agent in order, validate outputs at each stage, commit after each phase, and produce a finished project -all from a single invocation.

The underlying skills (`forge-build-prd`, `forge-build-agent-team`, `forge-assign-models`, `forge-orchestrate-build`) each own their own work. You are the conductor: you invoke them in sequence, verify each handoff, commit progress, and keep the user informed without interrupting them.

---

## What This Skill Does vs. Existing Skills

| Skill | Scope | Pauses |
|---|---|---|
| `forge-bootstrap-project` | PRD → agent team (no build) | Mandatory gate after PRD, after team |
| `@project-orchestrator` | Build execution only (no bootstrap) | Optional pause between each phase |
| **`forge-auto-build`** | PRD → agent team → (optional models) → full build → committed result | **One** pre-flight gate, then fully autonomous |

Use this skill when you want the entire pipeline to run hands-free after a single approval.

---

## Operating Principles

- **One gate, then fully autonomous.** The pre-flight confirmation (Step 0) is the only mandatory pause. Once the user types `GO`, every stage runs to completion without further interruption.
- **Never skip a stage silently.** If a stage fails or produces an unexpected result, stop immediately, report what happened, and ask the user how to proceed. Do not guess or silently skip.
- **Invoke, do not re-implement.** The work -interviewing the user, drafting the PRD, designing the team, scaffolding, executing phases -belongs to the underlying skills. You sequence them. Never duplicate their logic.
- **Commit after every phase.** After each build phase completes and its validation passes, commit the changes with a descriptive message and update `docs/PROGRESS.md`.
- **Validate before continuing.** After each stage, verify the expected output exists and is well-formed before moving to the next stage.
- **Be explicit about progress.** At every message, state which stage you are in (e.g., "Stage 3 of 6: forge-build-agent-team") and what comes next.
- **Resumability.** If re-invoked mid-flow, inspect the repo state and resume from the earliest incomplete stage rather than starting over.

---

## Process

### Step 0: Pre-Flight Confirmation (Mandatory -the only pause)

When the user invokes this skill, perform the following before touching any files:

1. **Resolve the effective input source.** Determine what idea or PRD to use with the following precedence:
   - If the user supplied an explicit argument (inline idea text or file path), use it as-is.
   - Otherwise, check repository files in this order: `docs/PRD.md`, `docs/IDEA.md`, `IDEA.md`.
   - If multiple candidate files exist and no explicit argument was supplied, present a short numbered choice and ask the user to pick one source for this run.
   - If no explicit argument and no candidate files exist, ask the user for a one-line idea or PRD path.
2. **Echo the selected input.** Restate the selected idea or PRD path in one or two sentences so the user can see what this run will use.
   - Do not add any extra confirmation gate here; continue to the normal pre-flight summary and `GO` checkpoint.
3. **Check repo state** and flag anything that changes the flow:
   - Does `docs/PRD.md` already exist? If yes, note that Stage 1 (PRD generation) will be skipped and the existing PRD will be used.
   - Do `.agent.md` files already exist in `.agents/agents/` (beyond the forge templates)? If yes, note that Stage 2 (team generation) will run in **Feature Increment Mode**.
   - Does `docs/product-vision.md` with `docs/features/*.md` exist? If yes, note that Stage 2 will run in **Vision + Features Mode**.
4. **Present the planned stages** as a numbered list:
   - Stage 1: `forge-build-prd` → produce `docs/PRD.md` *(skip if PRD already exists)*
   - Stage 2: `forge-build-agent-team` → produce agent and skill files
   - Stage 3 (optional): `forge-assign-models` → recommend or apply per-agent models *(opt-in -include if user passed `--assign-models`)*
   - Stage 4: `forge-orchestrate-build` -execute all phases continuously, committing after each
   - Stage 5 (optional): `forge-workflow-engine` → compile execution manifest and re-execute through a real harness *(opt-in -include if user passed `--workflow-engine`)*
5. **State the commit strategy** explicitly:
   - After Stage 2: `chore: bootstrap Agent Forge agent and skill templates`
   - After each build phase N: `feat: complete Phase N -<phase name>`
   - After all phases: `chore: auto-build complete -all phases delivered`
6. **Present the pre-flight checklist** (see below).
7. **Prompt**: *"Review the plan above. Type `GO` to start the full auto-build, `GO --assign-models` to also run model assignment, `GO --workflow-engine` to also run harness-driven execution after Stage 4, or `stop` to exit."*

**Input-resolution behavior examples:**

- User ran `forge-auto-build I want a CLI todo app`: use the explicit text input.
- User ran `forge-auto-build docs/PRD.md`: use that explicit PRD path.
- User ran `forge-auto-build` and only `docs/IDEA.md` exists: use `docs/IDEA.md`.
- User ran `forge-auto-build` and only `docs/PRD.md` exists: use `docs/PRD.md` and skip Stage 1.
- User ran `forge-auto-build` and both `docs/PRD.md` and `docs/IDEA.md` exist: ask user to choose one source for this run.
- User ran `forge-auto-build` and no candidate files exist: ask for a one-line idea or PRD path.

**Do not proceed until the user types `GO` (or a clear equivalent such as `start`, `run it`, `proceed`).**

**Pre-flight checklist (emit verbatim):**

```
Pre-flight checklist -verify before typing GO:

Input
- [ ] The idea or PRD path is correct
- [ ] The target project directory is open and git-initialised
- [ ] Agent Forge templates are bootstrapped (.agents/agents/ and .agents/skills/ exist)

Scope
- [ ] You understand that this skill will run autonomously until all phases are complete
- [ ] You are comfortable with the commit strategy listed above
- [ ] There are no uncommitted changes that could be lost (run `git status` if unsure)

Expectations
- [ ] You have reviewed the note on skipped stages (existing PRD, existing agents)
- [ ] You know you can interrupt at any time with Ctrl+C or by closing the session -PROGRESS.md
      will record the last completed task so you can resume manually
```

---

### Stage 1: Run `forge-build-prd`

*Skip this stage if the selected input source is an existing PRD path (for example `docs/PRD.md`) -proceed directly to Stage 2.*

Invoke the `forge-build-prd` skill, passing the selected idea input as-is. Let that skill drive its own clarifying-questions process. Do not answer on the user's behalf.

When `forge-build-prd` finishes and `docs/PRD.md` is saved:
- Verify the file exists and contains at minimum: Overview, Goals, Functional Requirements, Implementation Phases, and Acceptance Criteria sections.
- If any section is missing, re-invoke `forge-build-prd` in gap-fill mode before continuing.
- Report: "Stage 1 complete -`docs/PRD.md` produced. Moving to Stage 2."

---

### Stage 2: Run `forge-build-agent-team`

Invoke the `forge-build-agent-team` skill against the approved PRD (or against `docs/product-vision.md` + `docs/features/*.md` if that layout exists). Let the skill detect its own mode (Full Build, Vision + Features, or Feature Increment).

When it finishes:
- Verify `.agent.md` files exist under `.agents/agents/`.
- Verify the forge template agents (`project-orchestrator`, `forge-team-builder`) are still present and untouched.
- Commit the generated files:
  ```
  git add .agents/agents/ .agents/skills/ docs/
  git commit -m "chore: bootstrap Agent Forge agent and skill templates"
  ```
- Report: "Stage 2 complete -agent team committed. Moving to Stage 3."

---

### Stage 3 (Optional): Run `forge-assign-models`

Run this stage only if the user included `--assign-models` in their `GO` command.

Invoke the `forge-assign-models` skill in **Recommend** mode first (produce `docs/MODEL-PLAN.md` without modifying agent files). Then immediately invoke it again in **Apply** mode to write the models into agent YAML frontmatter.

When it finishes:
- Verify `docs/MODEL-PLAN.md` exists and each agent file has a `model:` field.
- Commit:
  ```
  git add .agents/agents/ docs/MODEL-PLAN.md
  git commit -m "chore: apply per-agent model assignments"
  ```
- Report: "Stage 3 complete -per-agent models applied. Moving to Stage 4."

If `--assign-models` was not requested, skip this stage and note: "Stage 3 skipped (no --assign-models flag). You can run forge-assign-models manually at any time. Moving to Stage 4."

---

### Stage 4: Run `forge-orchestrate-build` -All Phases

Invoke the `forge-orchestrate-build` skill in **continuous mode** (execute all phases without pausing between them).

For each phase, the skill will:
1. Execute each task by calling the appropriate specialist agent.
2. Verify deliverables exist and are well-formed.
3. Run build/lint/test validation for the phase's changes.
4. Update `docs/PROGRESS.md`.

After each phase completes validation, you **must** perform the following before the skill proceeds to the next phase:

**Per-phase commit sequence:**
```
git add .
git commit -m "feat: complete Phase N -<phase name from PRD>"
```

Verify the commit succeeded before the skill moves to the next phase. If the commit fails, stop and report the error.

**Build validation gate (per phase):**
Before committing and before proceeding to the next phase, verify:
- [ ] All files the phase was supposed to produce exist at the correct paths
- [ ] Build/lint/test commands pass for the phase's changes (run the project's own build and test commands, or those defined in the PRD)
- [ ] `docs/PROGRESS.md` reflects the completed phase
- [ ] No phase acceptance criteria from the PRD are unmet

If any validation check fails, do **not** commit and do **not** proceed. Stop and report: which check failed, the exact error output, and which agent or task is responsible. Ask the user how to proceed.

---

### Stage 5 (Optional): Run `forge-workflow-engine` — Harness-Driven Execution

Run this stage only if the user included `--workflow-engine` in their `GO` command.

This stage compiles the completed build into a structured execution manifest and re-executes every task through a real model harness (OpenCode CLI by default), producing a fully harness-driven execution record alongside the prompt-driven build.

**Step 5a: Compile the execution manifest**

```bash
cd .agents/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

Verify that `docs/EXECUTION-MANIFEST.json` was written and contains at least one phase with tasks. If the adapter reports warnings, surface them to the user before continuing.

**Step 5b: Run the workflow engine**

```bash
cd .agents/skills/forge-workflow-engine
npm install
npm run workflow-engine -- run --harness opencode
```

Monitor the engine until it reports `status: "complete"` or stops with `status: "failed"`.

**Step 5c: Verify completion**

- [ ] `docs/WORKFLOW-STATE.json` exists and `status` is `"complete"`
- [ ] All tasks in the manifest are `"complete"` or `"skipped"`
- [ ] `docs/PROGRESS.md` reflects the completed state
- [ ] `docs/EXECUTION-AUDIT.jsonl` contains a `run.complete` event

If the engine reports failures, surface the failing task IDs and error messages. Do not mark Stage 5 complete until the run status is `"complete"`.

When it finishes:
- Report: "Stage 5 complete — harness-driven execution finished. All tasks complete."

If `--workflow-engine` was not requested, skip this stage and note: "Stage 5 skipped (no --workflow-engine flag). You can run the workflow engine manually at any time. Moving to Final Stage."

---

### Final Stage: Completion Summary

After all phases in Stage 4 are complete and committed:

1. Commit any remaining uncommitted work:
   ```
   git add .
   git commit -m "chore: auto-build complete -all phases delivered"
   ```
2. Produce a **Final Summary** report in the terminal:

```
=== forge-auto-build: Complete ===

Stages completed:
  ✅ Stage 1: PRD produced (docs/PRD.md)
  ✅ Stage 2: Agent team generated (N agents, M skills)
  [✅ or ⏭️] Stage 3: Per-agent models [applied | skipped]
  ✅ Stage 4: All N phases built and committed
  [✅ or ⏭️] Stage 5: Harness-driven execution [run | skipped]

Commits made: <N>
Files produced: <list key output files>
Docs updated: docs/PROGRESS.md, docs/PRD.md, docs/agent-responsibility-matrix.md

Next steps:
  - Review docs/PROGRESS.md for the full task history
  - Run your project's tests to verify the final state: <test command from PRD>
  - Add a new feature: @workspace /forge-build-feature-prd I want to add [feature]...
  - Audit generated skills (automated): cd .agents/skills/skill-review && npm install && npm run skill-review -- --provider stdout --min-score 1.5
  - Audit generated skills (manual): @workspace /forge-optimize-skills Audit all skills...
  - Dark orchestration: cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- run --harness opencode
```

---

## Resuming After Interruption

If this skill is invoked in a repo that has an incomplete auto-build (detected by `docs/PROGRESS.md` having uncompleted tasks):

1. Read `docs/PROGRESS.md` to determine the last completed task.
2. Determine which stage was interrupted:
   - If interrupted mid-Stage 1: re-invoke `forge-build-prd`.
   - If interrupted mid-Stage 2: re-invoke `forge-build-agent-team`.
   - If interrupted mid-Stage 3: re-run the affected stage from the beginning.
   - If interrupted mid-Stage 4: invoke `forge-orchestrate-build` with `resume from last checkpoint`.
   - If interrupted mid-Stage 5: run `npm run workflow-engine -- run` in the `forge-workflow-engine` skill directory; the engine resumes from `docs/WORKFLOW-STATE.json`.
3. Report to the user: "Resuming auto-build from Stage N, last completed: [task description]."
4. Do not re-run stages whose outputs are already committed and verified.

---

## Error Handling

| Situation | Response |
|---|---|
| Stage 1 produces incomplete PRD | Re-invoke `forge-build-prd` in gap-fill mode before continuing |
| Stage 2 produces no agent files | Stop and report; do not proceed to build |
| Stage 3 model assignment fails | Log the failure, skip Stage 3, continue to Stage 4 -report at the end |
| Stage 4 phase fails validation | Stop after the failing phase; report error, blocked phase, and responsible agent |
| Stage 4 commit fails | Stop immediately; report the git error |
| Stage 5 manifest compile fails | Surface adapter warnings; do not start the engine until resolved |
| Stage 5 engine task fails | Surface the failing task ID and error; suggest `npm run workflow-engine -- replay <task-id>` |
| Any unexpected file conflict | Stop and ask the user whether to overwrite, merge, or abort |

---

## Gotchas

- **Do not skip the pre-flight gate.** Even if the user says "just run everything," you must present the pre-flight checklist and require a `GO` before starting. This is the only safeguard in a fully autonomous run.
- **Never auto-apply models without `--assign-models`.** Stage 3 is opt-in. Writing to agent YAML frontmatter without explicit intent is a violation of `forge-assign-models`'s safety constraint.
- **Commit after every phase, not at the end.** Batching commits defeats the purpose of phase-level checkpoints and makes debugging harder.
- **Do not suppress validation errors.** If a phase fails its build/test validation, stopping is the correct behavior -not retrying silently or moving on with a warning.
- **Respect agent boundaries.** When driving Stage 4, do not instruct agents to do work outside their documented expertise. Delegate cross-cutting tasks to the correct owner agents.
- **One invocation, one run.** This skill does not support running two independent projects simultaneously. If the workspace has multiple PRDs or project roots, ask the user to clarify which one to build before starting.
