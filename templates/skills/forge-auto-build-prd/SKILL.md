---
name: forge-auto-build-prd
description: "Author reviewed product vision and feature requirements from an idea, then stop before team generation. Use when starting a project, drafting requirements, or repairing incomplete canonical feature documents."
---

# Author Product Vision and Features

This is the requirements-authoring stage, not the build stage. Invoke
`forge-build-prd`; do not duplicate its interview, drafting or review logic.
Every solution uses `docs/PRD.md` plus at least one
`docs/features/*.md`, including a one-task solution. Do not first write a
monolithic document or generate a second task catalogue.

## Step 1: Confirm Input and Inspect State

Read the supplied idea, `docs/IDEA.md`, `docs/requirements-source.md`, research
and relevant existing project documents. Echo the intended scope briefly.
Interactive mode requires confirmation and the owning skill's review gate.
Headless mode (`FORGE_HEADLESS=1`, explicit headless/auto-proceed instructions,
or noninteractive invocation) records assumptions instead of blocking for answers.
If there is insufficient source material to infer a coherent product, report
the missing input rather than inventing requirements.

If canonical files already exist, run `validate-prd` before offering handoff.
Completion markers and nonempty files do not prove readiness. For an authorized
retry, ask `forge-build-prd` to repair the failing files in place, preserving
accepted meanings and completed task IDs. Supplied legacy documents are source
material only; use `forge-decompose-prd` for their conversion when needed.

## Step 2: Invoke the Authoring Skill

Invoke `forge-build-prd` with the confirmed source material and invocation mode.
It authors the vision and feature set directly, reviews scope, stack currency,
security, privacy, accessibility, performance, task sizing, acceptance checks
and separate human-review gates. Do not answer an interactive interview on the
user's behalf. Headless approval of requirements never approves implementation
evidence, native-language review, or any later human gate.

## Step 3: Verify

Load `forge-build-prd/references/task-contract.md`. Run the sibling adapter's
read-only `validate-prd` command without `--allow-legacy`. Require:

- A nonempty product vision and a feature table listing every feature file.
- At least one feature with bounded executable tasks and exact dependency IDs.
- One owning definition per requirement/story/constraint; ID-only traceability.
- Version-2 authoring contracts resolving all mandatory rules, task-specific
  acceptance criteria, concrete outputs, planned owners and meaningful tests.
- Coverage, valid feature/task DAGs, no copied active tasks, and separate human gates.

Review prose-duplication warnings. Delegate gap repair to the owning authoring
skill and rerun validation. Do not substitute file existence or JSON parsing.

## Step 4: Hand Off and Stop

Report the vision and feature paths, assumptions, and validation outcome.
Next: `forge-launcher resume` or `forge-build-agent-team`, then project skills
generation and `project-orchestrator` / `workflow-orchestrator` execution.
Do not generate teams or skills, assign models, compile manifests, or build here.
Re-entry resumes the earliest incomplete stage, not the entire pipeline.
