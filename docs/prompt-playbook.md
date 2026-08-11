# Agent Forge Prompt Playbook

A step-by-step command and prompt reference for anyone bootstrapping a new project with Agent Forge. Copy-paste each command or prompt in sequence.

---

## Prerequisites

- An agent harness - **GitHub Copilot** in VS Code or [Copilot CLI](https://docs.github.com/en/copilot/copilot-cli), **Claude Code**, or any runtime that detects agents and skills from a repo directory
- This repository cloned locally
- A target project directory created and initialized as a git repo

```bash
mkdir ~/Projects/my-new-project
cd ~/Projects/my-new-project
git init
```

---

## Step 1 - Bootstrap Agent Forge into Your Project

Run the bootstrap script from the Agent Forge repo, pointing it at your new project:

**Bash (Linux/macOS):**
```bash
./scripts/bootstrap.sh ~/Projects/my-new-project
```

**PowerShell (Windows):**
```powershell
.\scripts\bootstrap.ps1 -Target C:\Projects\my-new-project
```

**Force overwrite if re-bootstrapping:**
```bash
./scripts/bootstrap.sh ~/Projects/my-new-project --force
```

After bootstrapping, commit the templates so your harness can detect them:

```bash
cd ~/Projects/my-new-project
git add .agents/
git commit -m "chore: bootstrap Agent Forge agent and skill templates"
```

> Open your target project before running the prompts below - your agent harness auto-detects agents and skills from `.agents/agents/` and `.agents/skills/` (or `.github/` / `.claude/` if bootstrapped with the matching `--harness` flag).
>
> The prompts below use `@workspace` syntax. If your harness uses different syntax for invoking agents and skills, adapt accordingly (e.g., `/forge-build-prd ...` directly in Copilot CLI).

---

## Fast Path - One-Prompt Bootstrap (Optional)

If you just want to go from a one-liner idea to a reviewed PRD and a generated agent team without copy-pasting between skills, use the `forge-bootstrap-project` meta-skill. It chains `forge-build-prd` → **pause for PRD review** → `forge-build-agent-team` → **pause for team review** → optionally `forge-assign-models`. The review pauses are preserved - each one emits a verification checklist before the next step runs.

```
@workspace /forge-bootstrap-project I want to build [describe your idea in one sentence].
```

At each pause, reply `approved` to continue, `revise: <notes>` to iterate on the current artifact, or `stop` to end the flow. At Pause 2, reply `approved and assign models` to also run `forge-assign-models` in Recommend mode.

If you prefer to drive each step yourself, skip this section and follow Steps 2–4.5 below.

---

## Full Auto Build - One Command, Entire Pipeline (Optional)

If you want to go from a one-liner idea all the way to a **fully built, validated, and committed project** without any manual hand-offs between steps, use the `forge-auto-build` meta-skill. It chains the entire pipeline:

`forge-build-prd` → `forge-build-agent-team` → *(optional)* `forge-assign-models` → `forge-orchestrate-build` **(all phases, with validation + commit after each phase)**

```
@workspace /forge-auto-build I want to build [describe your idea in one sentence].
```

With per-agent model assignment:

```
@workspace /forge-auto-build I want to build [describe your idea in one sentence]. GO --assign-models
```

From an existing PRD (skips PRD generation):

```
@workspace /forge-auto-build docs/PRD.md
```

**How it works:**

1. A single pre-flight gate is presented -review the plan and type `GO` to launch.
2. After `GO`, the skill runs autonomously through all stages and phases.
3. After every build phase completes, validation checks run (build, lint, tests) and a commit is made automatically.
4. If any validation fails, the run stops and reports the exact error -it does not proceed past a broken phase.
5. A final summary lists every stage completed, every commit made, and the recommended next steps.

> **When to use `forge-auto-build` vs. `forge-bootstrap-project`:**
> Use `forge-bootstrap-project` when you want human review gates after the PRD and after the agent team are generated -good for unfamiliar or complex projects.
> Use `forge-auto-build` when you have a clear idea and want to go directly from idea to working code with a single command.

> **Resuming after interruption:** If the run is interrupted, re-invoke `forge-auto-build` in the same repo. It reads `docs/PROGRESS.md` and resumes from the last completed task without re-running already-committed stages.

---

## Step 2 - Build the PRD

### 2a. Generate the PRD

If you have seed documents (vision, research, architecture notes, specs), list them explicitly:

```
@workspace /forge-build-prd Build a complete PRD for this project using the following source documents:
- docs/product-vision.md
- docs/research/architecture-options.md
- docs/specs/event-schema.md
- docs/specs/privacy-and-redaction.md
- docs/roadmap/mvp-plan.md
- docs/adr/001-separate-project-packaging.md

Save the output to docs/PRD.md.
```

If you are starting from scratch with just an idea:

```
@workspace /forge-build-prd I want to build [describe your idea in 2–3 sentences]. 
Interview me for requirements and then produce a full PRD saved to docs/PRD.md.
```

### 2b. Quality Pass on the PRD

After the PRD is generated, run a gap check:

```
@workspace /forge-build-prd Review the generated docs/PRD.md for gaps.
Check that every major component has: clear acceptance criteria, a defined tech stack, 
non-functional requirements (performance, security, privacy), and implementation phases. 
Flag anything missing and fill in the gaps.
```

---

## Step 3 - (Optional) Decompose into Features

For larger projects, break the PRD into a Product Vision + individual Feature documents before building the team. Skip this step for small-to-medium projects.

### 3a. Decompose

```
@workspace /forge-decompose-prd Analyze docs/PRD.md and decompose it into:
- A Product Vision document at docs/product-vision.md
- Individual Feature documents in docs/features/
Ensure each feature is self-contained with its own user stories, requirements, phases, and acceptance criteria.
```

### 3b. Validate decomposition

```
@workspace /forge-decompose-prd Review the feature documents in docs/features/ and confirm:
- Every PRD requirement is covered by exactly one feature
- Feature dependencies are declared correctly
- No feature has circular dependencies
Report any gaps or issues.
```

---

## Step 4 - Generate the Agent Team

### 4a. Build the team

**From a monolithic PRD:**
```
@workspace /forge-build-agent-team Analyze docs/PRD.md and generate a complete specialist agent team.
Create agent files (`.agent.md`) in .agents/agents/ and skill files in .agents/skills/.
Ensure every PRD requirement has a clearly assigned primary owner agent.
```

**From a decomposed Product Vision + Features:**
```
@workspace /forge-build-agent-team Analyze docs/product-vision.md and all feature documents in docs/features/.
Generate a complete specialist agent team (`.agent.md` files) in .agents/agents/ and skills in .agents/skills/ 
that covers all features holistically without overlap or gaps.
```

### 4b. Validate the team

```
@workspace /forge-build-agent-team Validate the agent team you just generated.
Confirm that every PRD requirement (or every feature in docs/features/) maps to exactly one 
primary owner agent, there are no ownership gaps, and no two agents have conflicting responsibilities.
Produce a responsibility matrix as a markdown table and save it to docs/agent-responsibility-matrix.md.
```

After generating agents, commit them:

```bash
git add .agents/agents/ .agents/skills/ docs/
git commit -m "feat: generate specialist agent team from PRD"
```

---

## Step 4.5 - Assign Models per Agent (Optional but Recommended)

By default every agent uses your globally-selected model. Use the `forge-assign-models`
skill to discover what models you actually have access to (harness subscription + local
Ollama) and assign each agent an appropriately sized model so lightweight agents don't
default to the most expensive one.

### 4.5a. Discover available models

```
@workspace /forge-assign-models Discover what models are available in my environment
(local Ollama plus my harness subscription) and cache the inventory at
docs/research/model-inventory.json. Do not change any agent files.
```

### 4.5b. Recommend a per-agent assignment

```
@workspace /forge-assign-models Read the cached inventory and the agent team in
.agents/agents/, classify each agent's workload, and produce docs/MODEL-PLAN.md with a
proposed primary + fallback model per agent. Do not modify the agent files yet.
```

### 4.5c. Apply the recommended models

After reviewing `docs/MODEL-PLAN.md`:

```
@workspace /forge-assign-models Apply the recommended models from docs/MODEL-PLAN.md by
adding model: and modelFallback: to each agent's YAML frontmatter. Show me a diff
summary first and ask for confirmation before writing.
```

### 4.5d. Re-tune after team changes

After `forge-build-agent-team` runs in Feature Increment Mode:

```
@workspace /forge-assign-models Re-tune the model assignment for the changes introduced
by the latest feature. Only re-evaluate agents whose role changed; leave the rest alone.
Update docs/MODEL-PLAN.md.
```

---

## Step 5 - Plan and Execute the Build

### 5a. Generate an execution plan (inspect before committing to action)

```
@workspace @project-orchestrator Analyze docs/PRD.md and produce an execution plan only.
Do not implement anything yet. List each phase, the agents involved, their tasks, 
and the dependencies between phases. Save the plan to docs/PROGRESS.md.
```

**For feature-based builds:**
```
@workspace @project-orchestrator Analyze docs/product-vision.md and all feature documents in docs/features/.
Build a feature dependency graph and produce an execution plan showing which features will be built 
in which order and why. Save the plan to docs/PROGRESS.md. Do not implement anything yet.
```

### 5b. Execute one phase at a time

Start with Phase 1 and review output before proceeding:

```
@workspace @project-orchestrator Execute Phase 1 only.
After completing Phase 1, stop and summarize what was built, what tests passed, 
and what the next phase will require. Update docs/PROGRESS.md.
```

Continue phase by phase:

```
@workspace @project-orchestrator Phase 1 is approved. Execute Phase 2 only.
Stop after Phase 2 and report status.
```

**For feature-based builds, execute one feature at a time:**
```
@workspace @project-orchestrator The execution plan is approved. 
Build Feature 1 (docs/features/feature-01-event-capture.md) only.
Stop after it is complete and all acceptance criteria pass. Update docs/PROGRESS.md.
```

### 5c. Resume from a checkpoint

If a session ends mid-build:

```
@workspace @project-orchestrator Read docs/PROGRESS.md to understand the current state of the build.
Resume from where we left off. What is the next uncompleted task?
```

---

## Step 6 - Add a Feature to an Existing Project

After the initial build is complete, use this workflow to add new features:

### 6a. Create a Feature PRD

```
@workspace /forge-build-feature-prd I want to add [describe the new feature] to this project.
Analyze the existing codebase and agent team, then produce a Feature PRD saved to 
docs/features/feature-XX-[name].md. Include an Agent Impact Assessment showing which 
existing agents are affected and whether any new agents are needed.
```

### 6b. Extend the agent team if needed

```
@workspace /forge-build-agent-team A new Feature PRD has been added at docs/features/feature-XX-[name].md.
Review the Agent Impact Assessment and update the agent team (`.agent.md` files) in .agents/agents/ accordingly.
Only modify or create agents that are directly affected by this feature.
```

### 6c. Execute the feature

```
@workspace @project-orchestrator A new Feature PRD is at docs/features/feature-XX-[name].md.
Read it, build the feature execution plan, and execute Phase F1 only.
Stop after F1 and report status.
```

---

## Step 7 - Dark Orchestration / Workflow-Engine Build Path (Optional)

After the PRD and agent team are generated, you can choose to execute the build through a real model harness instead of the prompt-driven `project-orchestrator` flow. Use one execution path per run. This is "dark orchestration" - a background process that fires actual model invocations, persists state, and requires no human input between tasks.

### 7a. Compile the execution manifest

The workflow engine reads `docs/EXECUTION-MANIFEST.json`, which is produced by the `forge-execution-adapter` skill. The commands below install dependencies for the adapter before compiling:

```bash
cd .agents/skills/forge-execution-adapter
npm install
npm run forge-execution-adapter -- compile
```

Inspect the compiled manifest and review any warnings before running:

```bash
npm run forge-execution-adapter -- inspect
```

### 7b. Run the workflow engine

Choose your execution harness. The commands below install the workflow-engine dependencies and then start the engine:

```bash
cd .agents/skills/forge-workflow-engine
npm install

# OpenCode CLI (default) - requires `opencode` in $PATH
npm run workflow-engine -- run --harness opencode

# OpenAI API - requires OPENAI_API_KEY env var
npm run workflow-engine -- run --harness openai

# Stub / dry-run - no real calls, verifies engine setup
npm run workflow-engine -- run --harness stub
```

Or, use the `workflow-orchestrator` agent for a guided interactive experience:

```
@workspace @workflow-orchestrator Run the workflow using OpenCode.
```

### 7c. Monitor and recover

```bash
# Check current run state
npm run workflow-engine -- status

# Replay a failed task after fixing the root cause
npm run workflow-engine -- replay P1-T1 --harness opencode

# Pause after the current task (then resume with `run`)
npm run workflow-engine -- pause
```

> **When to use `workflow-orchestrator` vs. `project-orchestrator`:**
>
> Use `project-orchestrator` for interactive, phase-by-phase builds with human review at each stage.
> Use `workflow-orchestrator` (backed by the workflow engine) for fully autonomous execution in CI/CD, scheduled jobs, or when you want zero interruptions after the pre-run gate.
> Both can be used on the same project - they share `docs/PROGRESS.md` as the common state.

---

## Step 8 - Optimize Existing Skills

After building a project, audit the generated skills against agentskills.io best practices:

### 8a. Audit skills

```
@workspace /forge-optimize-skills Audit all skills in .agents/skills/ against best practices.
Score each skill and produce docs/SKILL-AUDIT.md. Do not modify any files yet.
```

### 8b. Apply approved improvements

After reviewing `docs/SKILL-AUDIT.md`:

```
@workspace /forge-optimize-skills Apply the approved changes from docs/SKILL-AUDIT.md.
Only modify skills I've approved in the audit report.
```

---

## Quick Reference - All Prompts at a Glance

| Step | Command / Prompt |
|------|-----------------|
| **Full auto build (idea → built project)** | `@workspace /forge-auto-build I want to build [idea]` |
| **Full auto build (with model assignment)** | `@workspace /forge-auto-build I want to build [idea]. GO --assign-models` |
| **Full auto build from existing PRD** | `@workspace /forge-auto-build docs/PRD.md` |
| Bootstrap (Bash, default) | `./scripts/bootstrap.sh ~/Projects/my-project` |
| Bootstrap (Bash, GitHub) | `./scripts/bootstrap.sh ~/Projects/my-project --harness github` |
| Bootstrap (Bash, Claude) | `./scripts/bootstrap.sh ~/Projects/my-project --harness claude` |
| Bootstrap (PowerShell) | `.\scripts\bootstrap.ps1 -Target C:\Projects\my-project` |
| Bootstrap (PowerShell, harness) | `.\scripts\bootstrap.ps1 -Target C:\Projects\my-project -Harness github` |
| Build PRD from seed docs | `@workspace /forge-build-prd Build a complete PRD using docs/...` |
| Build PRD from idea | `@workspace /forge-build-prd I want to build [idea]...` |
| PRD quality pass | `@workspace /forge-build-prd Review docs/PRD.md for gaps...` |
| Decompose PRD (optional) | `@workspace /forge-decompose-prd Analyze docs/PRD.md...` |
| Generate agent team (PRD) | `@workspace /forge-build-agent-team Analyze docs/PRD.md...` |
| Generate agent team (features) | `@workspace /forge-build-agent-team Analyze docs/product-vision.md...` |
| Validate agent team | `@workspace /forge-build-agent-team Validate the agent team...` |
| Discover available models | `@workspace /forge-assign-models Discover what models are available...` |
| Recommend per-agent models | `@workspace /forge-assign-models Recommend a per-agent model and write docs/MODEL-PLAN.md...` |
| Apply per-agent models | `@workspace /forge-assign-models Apply the recommended models...` |
| Re-tune models after a feature | `@workspace /forge-assign-models Re-tune the model assignment...` |
| Generate execution plan | `@workspace @project-orchestrator Analyze docs/PRD.md and produce an execution plan only...` |
| Execute Phase N | `@workspace @project-orchestrator Execute Phase N only...` |
| Resume from checkpoint | `@workspace @project-orchestrator Read docs/PROGRESS.md and resume...` |
| New feature PRD | `@workspace /forge-build-feature-prd I want to add [feature]...` |
| Execute feature phase | `@workspace @project-orchestrator Read docs/features/feature-XX.md, execute Phase F1 only...` |
| Audit skills | `@workspace /forge-optimize-skills Audit all skills in .agents/skills/ against best practices...` |
| Apply skill improvements | `@workspace /forge-optimize-skills Apply the approved changes from docs/SKILL-AUDIT.md` |
| Compile execution manifest | `cd .agents/skills/forge-execution-adapter && npm install && npm run forge-execution-adapter -- compile` |
| Dark run (OpenCode harness) | `cd .agents/skills/forge-workflow-engine && npm install && npm run workflow-engine -- run --harness opencode` |
| Dark run (OpenAI harness) | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- run --harness openai` |
| Dark run (stub / dry-run) | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- run --harness stub` |
| Workflow status | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- status` |
| Replay failed task | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- replay <task-id>` |
| Dark run (via agent) | `@workspace @workflow-orchestrator Run the workflow using OpenCode.` |

---

## Tips

- **Open your target project first** - agents and skills resolve from the current workspace or repo directory.
- **Review before executing** - always run the execution plan prompt (Step 5a) before asking the orchestrator to build anything.
- **One phase at a time** - resist asking the orchestrator to "build everything". Phases are checkpoints; review each one.
- **Commit after each phase** - the orchestrator will prompt you, but make a habit of it. `git add . && git commit -m "feat: complete Phase N"`.
- **The PRD is the source of truth** - if something looks wrong, fix the PRD first, then re-run the affected steps.
- **Re-bootstrap safely** - run `bootstrap.sh --force` any time you want to pull in updated Agent Forge templates without losing your generated agents.
- **Optimize generated skills** - after the initial build, run `@workspace /forge-optimize-skills` to audit your skills against best practices. The audit surfaces specific improvements you can apply immediately.
- **Full auto build** - use `forge-auto-build` when you have a clear idea and want a single command to take you from idea to committed, validated code. One pre-flight gate, then fully autonomous. If the run is interrupted, just re-invoke it -it resumes from `docs/PROGRESS.md`.
- **Dark orchestration** - use `workflow-orchestrator` + the workflow engine for fully autonomous execution through a real harness (OpenCode or OpenAI API). Dry-run first with `--harness stub` to verify the engine setup before spending tokens.
