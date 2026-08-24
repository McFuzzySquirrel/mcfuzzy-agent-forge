---
name: forge-auto-build
description: >
  Execution fast-path meta-skill that chains the build pipeline from an existing
  PRD in a single continuous flow: forge-build-agent-team →
  optionally forge-assign-models → one build execution path
  (`forge-orchestrate-build` or `forge-workflow-engine`).
  Use this skill when a PRD already exists (docs/PRD.md or the decomposed
  product-vision + features layout) and you want to go from that approved PRD to
  a fully built, validated, and committed project without manual hand-offs
  between steps. A single pre-flight confirmation gate is presented before the
  autonomous run begins.
---

# Skill: Full Auto Build (End-to-End Pipeline)

You are running the **build pipeline** on behalf of the user in one continuous, autonomous flow. Your job is to chain the downstream skills and agents in order, validate outputs at each stage, commit after each phase, and produce a finished project -all from a single invocation.

The underlying skills (`forge-build-agent-team`, `forge-assign-models`, `forge-orchestrate-build`) each own their own work. You are the conductor: you invoke them in sequence, verify each handoff, commit progress, and keep the user informed without interrupting them.

**A PRD is a required prerequisite.** This skill does **not** create or generate a PRD. It consumes one that already exists: `docs/PRD.md`, or the decomposed representation `docs/product-vision.md` together with `docs/features/*.md`. PRD creation is a deliberate stage owned by `forge-build-prd` / `forge-auto-build-prd`.

---

## What This Skill Does vs. Existing Skills

| Skill | Scope | Pauses |
|---|---|---|
| `forge-auto-build-prd` | idea → reviewed PRD (with automatic decomposition) | Review gate inside PRD flow |
| `forge-build-prd` | idea/seed docs → `docs/PRD.md` | Review gate before save |
| `@project-orchestrator` | Build execution only (no PRD, no team) | Optional pause between each phase |
| `@workflow-orchestrator` | Build execution via the workflow engine only | One pre-run gate |
| **`forge-auto-build`** | existing PRD → agent team → (optional models) → choose manual or engine build path → committed result | **One** pre-flight gate, then fully autonomous |

Use this skill when you want the build pipeline to run hands-free after a single approval, from a PRD that has already been reviewed and confirmed.

---

## Operating Principles

- **The PRD is a quality gate, not an input to be manufactured here.** Before any work, verify a PRD representation exists. If it does not, stop and direct the user to `forge-auto-build-prd` or `forge-build-prd`. Never fall back to interviewing the user for a one-line idea.
- **One gate, then fully autonomous.** The pre-flight confirmation (Step 0) is the only mandatory pause. Once the user types `GO`, every stage runs to completion without further interruption.
- **Never skip a stage silently.** If a stage fails or produces an unexpected result, stop immediately, report what happened, and ask the user how to proceed. Do not guess or silently skip.
- **Invoke, do not re-implement.** The work -designing the team, scaffolding, executing phases -belongs to the underlying skills. You sequence them. Never duplicate their logic.
- **Commit after every phase.** After each build phase completes and its validation passes, commit the changes with a descriptive message and update `docs/PROGRESS.md`.
- **Validate before continuing.** After each stage, verify the expected output exists and is well-formed before moving to the next stage.
- **Be explicit about progress.** At every message, state which stage you are in (e.g., "Stage 1 of 3: forge-build-agent-team") and what comes next.
- **Resumability.** If re-invoked mid-flow, inspect the repo state and resume from the earliest incomplete stage rather than starting over.

---

## Process

### Step 0: Pre-Flight Confirmation (Mandatory -the only pause)

When the user invokes this skill, perform the following before touching any files:

1. **Verify the PRD prerequisite.** Confirm one of the following exists:
   - `docs/PRD.md`, or
   - `docs/product-vision.md` together with `docs/features/*.md`.
   If neither representation exists, **stop immediately** and direct the user to first run `forge-auto-build-prd` or `forge-build-prd`. Do not ask for a one-line idea and do not proceed.
2. **Resolve the PRD source.** Determine which PRD representation to use with the following precedence:
   - If the user supplied an explicit argument (a PRD path), use it as-is.
   - Otherwise, use `docs/PRD.md`.
   - Otherwise, use the decomposed layout (`docs/product-vision.md` + `docs/features/*.md`).
   - If both a monolithic PRD and the decomposed layout exist, present a short numbered choice and ask the user to pick one for this run.
3. **Echo the selected PRD.** Restate the selected PRD (or vision + features) path in one or two sentences so the user can see what this run will use.
   - Do not add any extra confirmation gate here; continue to the normal pre-flight summary and `GO` checkpoint.
4. **Check repo state** and flag anything that changes the flow:
   - Do `.md` agent files already exist in `HARNESS_AGENTS_DIR` (beyond the forge templates)? If yes, note that Stage 1 (team generation) will run in **Feature Increment Mode**.
   - Does `docs/product-vision.md` with `docs/features/*.md` exist? If yes, note that Stage 1 will run in **Vision + Features Mode**.
   - Note whether the PRD is monolithic or decomposed so the team builder and orchestrator select the right mode.
5. **Present the planned stages** as a numbered list:
   - Stage 1: `forge-build-agent-team` → produce agent and skill files
   - Stage 2 (optional): `forge-assign-models` → recommend or apply per-agent models *(opt-in -include if user passed `--assign-models`)*
   - Stage 3: Build execution *(choose one path)*:
     - Default: `forge-orchestrate-build` - execute all phases continuously, committing after each phase
     - With `--workflow-engine`: compile `docs/EXECUTION-MANIFEST.json` and execute the build through `forge-workflow-engine`
6. **State the commit strategy** explicitly:
   - After Stage 1: `chore: bootstrap Agent Forge agent and skill templates`
   - After each build phase N: `feat: complete Phase N -<phase name>`
   - After all phases: `chore: auto-build complete -all phases delivered`
7. **Present the pre-flight checklist** (see below).
8. **Prompt**: *"Review the plan above. Type `GO` to start the auto-build on the default prompt-driven path, `GO --assign-models` to also run model assignment, `GO --workflow-engine` to use the workflow-engine path instead of `forge-orchestrate-build`, or `stop` to exit."*

**PRD-requirement behavior examples:**

- User ran `forge-auto-build docs/PRD.md`: use that explicit PRD path.
- User ran `forge-auto-build` and `docs/PRD.md` exists: use `docs/PRD.md`.
- User ran `forge-auto-build` and only `docs/product-vision.md` + `docs/features/*.md` exist: use the decomposed layout.
- User ran `forge-auto-build` and both layouts exist: ask the user to choose one for this run.
- User ran `forge-auto-build` and no PRD representation exists: stop and direct to `forge-auto-build-prd` or `forge-build-prd`.

**Do not proceed until the user types `GO` (or a clear equivalent such as `start`, `run it`, `proceed`).**

**Pre-flight checklist (emit verbatim):**

```
Pre-flight checklist -verify before typing GO:

Input
- [ ] A PRD representation exists and is correct
      (docs/PRD.md, or docs/product-vision.md + docs/features/)
- [ ] The PRD has been reviewed and you are ready to build from it
- [ ] The target project directory is open and git-initialised
- [ ] Agent Forge templates are bootstrapped (`HARNESS_AGENTS_DIR` and `HARNESS_SKILLS_DIR` exist)

Scope
- [ ] You understand that this skill will run autonomously until all phases are complete
- [ ] You are comfortable with the commit strategy listed above
- [ ] There are no uncommitted changes that could be lost (run `git status` if unsure)

Expectations
- [ ] You have reviewed the note on skipped stages (existing agents, decomposed layout)
- [ ] You know you can interrupt at any time with Ctrl+C or by closing the session -PROGRESS.md
      will record the last completed task so you can resume manually
```

---

### Stage 1: Run `forge-build-agent-team`

Invoke the `forge-build-agent-team` skill against the approved PRD (`docs/PRD.md`, or against `docs/product-vision.md` + `docs/features/*.md` if that layout exists). Let the skill detect its own mode (Full Build, Vision + Features, or Feature Increment).

When it finishes:
- Verify `.md` agent files exist under `HARNESS_AGENTS_DIR`.
- Verify the forge template agents (`project-orchestrator`, `forge-team-builder`) are still present and untouched.
- Commit the generated files:
  ```
  git add {HARNESS_AGENTS_DIR}/ {HARNESS_SKILLS_DIR}/ docs/
  git commit -m "chore: bootstrap Agent Forge agent and skill templates"
  ```
- Report: "Stage 1 complete -agent team committed. Moving to Stage 2."

---

### Stage 2 (Optional): Run `forge-assign-models`

Run this stage only if the user included `--assign-models` in their `GO` command.

Invoke the `forge-assign-models` skill in **Recommend** mode first (produce `docs/MODEL-PLAN.md` without modifying agent files). Then immediately invoke it again in **Apply** mode to write the models into agent YAML frontmatter.

When it finishes:
- Verify `docs/MODEL-PLAN.md` exists and each agent file has a `model:` field.
- Commit:
  ```
  git add {HARNESS_AGENTS_DIR}/ docs/MODEL-PLAN.md
  git commit -m "chore: apply per-agent model assignments"
  ```
- Report: "Stage 2 complete -per-agent models applied. Moving to Stage 3."

If `--assign-models` was not requested, skip this stage and note: "Stage 2 skipped (no --assign-models flag). You can run forge-assign-models manually at any time. Moving to Stage 3."

---

### Stage 3: Execute the Build - Choose One Path

By default, use the prompt-driven path below. If the user included `--workflow-engine` in the `GO` command, skip Path A and run Path B instead. Do **not** run both paths in the same auto-build invocation.

#### Path A (default): Run `forge-orchestrate-build` - All Phases

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

#### Path B (`--workflow-engine`): Run `forge-workflow-engine` - Harness-Driven Build

Run this path only if the user included `--workflow-engine` in their `GO` command.

This path uses the workflow engine as the build executor instead of `forge-orchestrate-build`. The manifest is the execution plan; the engine performs the actual autonomous run through the selected harness (OpenCode CLI by default). As part of this path, run the required `npm install` steps for both `forge-execution-adapter` and `forge-workflow-engine`, then compile the manifest and start the engine.

**Step 3a: Compile the execution manifest**

```bash
cd .agents/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

Verify that `docs/EXECUTION-MANIFEST.json` was written and contains at least one phase with tasks. If the adapter reports warnings, surface them to the user before continuing.

**Step 3b: Run the workflow engine**

```bash
cd .agents/skills/forge-workflow-engine
npm install
npm run workflow-engine -- run --harness opencode
```

Monitor the engine until it reports `status: "complete"` or stops with `status: "failed"`.

**Step 3c: Verify completion**

- [ ] `docs/WORKFLOW-STATE.json` exists and `status` is `"complete"`
- [ ] All tasks in the manifest are `"complete"` or `"skipped"`
- [ ] `docs/PROGRESS.md` reflects the completed state
- [ ] `docs/EXECUTION-AUDIT.jsonl` contains a `run.complete` event

If the engine reports failures, surface the failing task IDs and error messages. Do not mark Stage 3 complete until the run status is `"complete"`.

When it finishes:
- Report: "Stage 3 complete - workflow-engine path finished. All tasks complete."

If `--workflow-engine` was not requested, skip this path and note: "Workflow-engine path not selected. Using `forge-orchestrate-build` for Stage 3."

---

### Final Stage: Completion Summary

After the selected Stage 3 build path is complete:

1. Commit any remaining uncommitted work:
   ```
   git add .
   git commit -m "chore: auto-build complete -all phases delivered"
   ```
2. Produce a **Final Summary** report in the terminal:

```
=== forge-auto-build: Complete ===

Stages completed:
  ✅ Stage 1: Agent team generated (N agents, M skills)
  [✅ or ⏭️] Stage 2: Per-agent models [applied | skipped]
  ✅ Stage 3: Build execution completed via [forge-orchestrate-build | forge-workflow-engine]

Commits made: <N>
Files produced: <list key output files>
Docs updated: docs/PROGRESS.md, docs/PRD.md, docs/agent-responsibility-matrix.md

Next steps:
  - Review docs/PROGRESS.md for the full task history
  - Run your project's tests to verify the final state: <test command from PRD>
  - Add a new feature: @workspace /forge-build-feature-prd I want to add [feature]...
  - Audit generated skills (automated): cd .agents/skills/skill-review && npm install && npm run skill-review -- --provider stdout --min-score 1.5
  - Audit generated skills (manual): @workspace /forge-optimize-skills Audit all skills...
  - Run the alternate build path later if desired: cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- run --harness opencode
```

---

## Resuming After Interruption

If this skill is invoked in a repo that has an incomplete auto-build (detected by `docs/PROGRESS.md` having uncompleted tasks):

1. Read `docs/PROGRESS.md` to determine the last completed task.
2. Determine which stage was interrupted:
   - If interrupted mid-Stage 1: re-invoke `forge-build-agent-team`.
   - If interrupted mid-Stage 2: re-run the affected stage from the beginning.
   - If interrupted mid-Stage 3 on the prompt-driven path: invoke `forge-orchestrate-build` with `resume from last checkpoint`.
   - If interrupted mid-Stage 3 on the workflow-engine path: run `npm run workflow-engine -- run` in the `forge-workflow-engine` skill directory; the engine resumes from `docs/WORKFLOW-STATE.json`.
3. Report to the user: "Resuming auto-build from Stage N, last completed: [task description]."
4. Do not re-run stages whose outputs are already committed and verified.

---

## Error Handling

| Situation | Response |
|---|---|
| No PRD representation exists at pre-flight | Stop before Stage 1; direct the user to `forge-auto-build-prd` or `forge-build-prd` |
| Stage 1 produces no agent files | Stop and report; do not proceed to build |
| Stage 2 model assignment fails | Log the failure, skip Stage 2, continue to Stage 3 -report at the end |
| Stage 3 prompt-driven phase fails validation | Stop after the failing phase; report error, blocked phase, and responsible agent |
| Stage 3 prompt-driven commit fails | Stop immediately; report the git error |
| Stage 3 workflow-engine manifest compile fails | Surface adapter warnings; do not start the engine until resolved |
| Stage 3 workflow-engine task fails | Surface the failing task ID and error; suggest `npm run workflow-engine -- replay <task-id>` |
| Any unexpected file conflict | Stop and ask the user whether to overwrite, merge, or abort |

---

## Gotchas

- **Do not skip the pre-flight gate.** Even if the user says "just run everything," you must present the pre-flight checklist and require a `GO` before starting. This is the only safeguard in a fully autonomous run.
- **Never generate a PRD or interview for an idea.** This skill requires an existing PRD. If none exists, stop and point the user to `forge-auto-build-prd` / `forge-build-prd`. Manufacturing requirements inside the build pipeline is forbidden.
- **Never auto-apply models without `--assign-models`.** Stage 2 is opt-in. Writing to agent YAML frontmatter without explicit intent is a violation of `forge-assign-models`'s safety constraint.
- **Commit after every phase, not at the end.** Batching commits defeats the purpose of phase-level checkpoints and makes debugging harder.
- **Choose exactly one build path per run.** `--workflow-engine` switches Stage 3 to the engine path; without it, use `forge-orchestrate-build`. Do not run one path and then replay the whole build through the other in the same invocation.
- **Do not suppress validation errors.** If a phase fails its build/test validation, stopping is the correct behavior -not retrying silently or moving on with a warning.
- **Respect agent boundaries.** When driving Stage 3, do not instruct agents to do work outside their documented expertise. Delegate cross-cutting tasks to the correct owner agents.
- **One invocation, one run.** This skill does not support running two independent projects simultaneously. If the workspace has multiple PRDs or project roots, ask the user to clarify which one to build before starting.
