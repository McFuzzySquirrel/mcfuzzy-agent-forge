# MyForge Prompt Playbook

A step-by-step command and prompt reference for anyone bootstrapping a new project with MyForge. Copy-paste each command or prompt in sequence.

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

## Step 1 - Bootstrap MyForge into Your Project

If you prefer a browser-based workflow for creating, opening, and monitoring projects after bootstrap, see the [Forge Console user guide](forge-console-user-guide.md).

To use MyForge with an application that already exists, open the Console and
choose **Bootstrap an existing repo**, or run:

```bash
forge-launcher bootstrap ~/Projects/existing-app --harness opencode
```

The directory must already be a Git repository. For a non-Git directory, use
`--init-git` explicitly; non-interactive workflows must also provide that flag.
Bootstrap does not overwrite existing Forge files unless `--force` is supplied.

Copy the agent and skill templates into your project's harness directory with the launcher (Node, cross-platform):

```bash
forge-launcher bootstrap ~/Projects/my-new-project           # default → .agents/
forge-launcher bootstrap ~/Projects/my-new-project --harness github   # GitHub Copilot → .github/
forge-launcher bootstrap ~/Projects/my-new-project --harness claude   # Claude Code → .claude/
forge-launcher bootstrap ~/Projects/my-new-project --harness opencode # opencode → .opencode/
forge-launcher bootstrap ~/Projects/my-new-project --force   # force overwrite when re-bootstrapping
```

After bootstrapping, commit the templates so your harness can detect them:

```bash
cd ~/Projects/my-new-project
git add .agents/
git commit -m "chore: bootstrap MyForge agent and skill templates"
```

> Open your target project before running the prompts below - your agent harness auto-detects agents and skills from `.agents/agents/` and `.agents/skills/` (or `.github/` / `.claude/` if bootstrapped with the matching `--harness` flag).
>
> The prompts below use `@workspace` syntax. If your harness uses different syntax for invoking agents and skills, adapt accordingly (e.g., `/forge-build-prd ...` directly in Copilot CLI).

---

## Fast Path - Build a Reviewed PRD in One Prompt (Optional)

If you want to go from a one-liner idea to a **reviewed, confirmed PRD** without copy-pasting between skills, use the `forge-auto-build-prd` meta-skill. It confirms your idea, then chains `forge-build-prd` (interview → draft → review) and automatically runs the decomposition check - a qualifying PRD (15+ functional requirements or 3+ implementation phases) is decomposed into a Product Vision + Feature documents with no opt-in question. The skill stops after the PRD, before team generation.

```
@workspace /forge-auto-build-prd I want to build [describe your idea in one sentence].
```

`forge-build-prd` presents its PRD review checklist before the document is saved. Reply `revise: <notes>` to iterate on the PRD, or approve to finish. Once `docs/PRD.md` exists (plus `docs/product-vision.md` + `docs/features/*.md` when decomposed), generate the team and build - `forge-launcher resume` from the terminal, or in the harness `/forge-build-agent-team` then `@project-orchestrator` / `@workflow-orchestrator`.

If you prefer to drive the PRD yourself, use `forge-build-prd` directly (Step 2 below).

---

## Full Auto Build - Terminal Fast-Path (Requires an Existing PRD)

`forge-auto-build` is the **terminal/headless execution fast-path**: it takes an existing, reviewed PRD and runs the entire build pipeline with no manual hand-offs. It does **not** generate a PRD - that is a deliberate, separate stage. It is driven by `forge-launcher` (`--headless`, or the auto-draft flow) rather than invoked as an in-harness slash command - inside a chat harness use `@project-orchestrator` (interactive) or `@workflow-orchestrator` (autonomous) instead.

`forge-build-agent-team` → `forge-build-project-skills` → `forge-execution-adapter` → `forge-orchestrate-build` **(each stage has its own review boundary)**

```
# Terminal / headless (recommended entry):
forge-launcher --headless
opencode run --auto "/forge-auto-build Use docs/PRD.md as the project PRD. GO"
```

> If no PRD exists yet, `forge-auto-build` stops at its pre-flight check and directs you to `forge-auto-build-prd` or `forge-build-prd` first. It will not interview you for a one-line idea.

**How it works:**

1. Its pre-flight check verifies a PRD representation exists -`docs/PRD.md`, or `docs/product-vision.md` + `docs/features/*.md` -then presents a single pre-flight gate. Review the plan and type `GO` to launch.
2. After `GO`, the flow advances through three separate authoring stages - PRD, team, and project skills - before manifest compilation and execution. A failed skills stage must be reported and retried explicitly; it is not silently treated as "no skills required".
   The team-to-skills candidate handoff is required and immutable; an empty or
   all-`omit` candidate set is the explicit successful no-skills result.
3. After every build phase completes, validation checks run (build, lint, tests) and a commit is made automatically.
4. If any validation fails, the run stops and reports the exact error -it does not proceed past a broken phase.
5. A final summary lists every stage completed, every commit made, and the recommended next steps.

> **Using the workflow engine:** at the pre-flight gate, type `GO --workflow-engine` to execute the compiled manifest through `forge-workflow-engine` instead of the prompt-driven `forge-orchestrate-build`. That path installs the execution packages and runs the native engine (default harness: OpenCode), which owns retries and durable run state.

> **Resuming after interruption:** If the run is interrupted, use
> `forge-launcher resume` to pick up the current authoring or manifest stage.
> Once the engine has started, it resumes from `docs/WORKFLOW-STATE.json` and
> the latest durable `docs/PROGRESS.md` checkpoint; authoring readiness comes
> from `docs/authoring-state.json`, not an LLM-authored execution plan.

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

> **Automatic decomposition:** once you confirm the PRD is ready and it is saved to `docs/PRD.md`, `forge-build-prd` runs its decomposition check automatically. If the PRD has **15+ functional requirements or 3+ implementation phases**, it invokes `forge-decompose-prd` to produce `docs/product-vision.md` + `docs/features/*.md` -no opt-in question. If it does not qualify, the monolithic `docs/PRD.md` is kept and the outcome is reported.

---

## Step 3 - (Optional) Decompose into Features

For larger projects, break the PRD into a Product Vision + individual Feature documents before building the team. **This now happens automatically** when a PRD qualifies (15+ functional requirements or 3+ implementation phases) -see Step 2b. Use the manual skill below for older PRDs, PRDs modified after generation, or documents you want to decompose below the automatic threshold.

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
Create agent files (`.md`) in .agents/agents/ and persist ownership metadata.
Ensure every PRD requirement has a clearly assigned primary owner agent. Do not
create project skill packages in this stage.
```

**From a decomposed Product Vision + Features:**
```
@workspace /forge-build-agent-team Analyze docs/product-vision.md and all feature documents in docs/features/.
Generate a complete specialist agent team (`.md` files) in .agents/agents/
that covers all features holistically without overlap or gaps. Do not create
project skill packages in this stage.
```

### 4b. Validate the team

```
@workspace /forge-build-agent-team Validate the agent team you just generated.
Confirm that every PRD requirement (or every feature in docs/features/) maps to exactly one 
primary owner agent, there are no ownership gaps, and no two agents have conflicting responsibilities.
Produce a responsibility matrix as a markdown table and save it to docs/agent-responsibility-matrix.md.
```

After generating agents, commit the team and ownership artifacts:

```bash
git add .agents/agents/ docs/
git commit -m "feat: generate specialist agent team from PRD"
```

### 4c. Generate project skills

Run the project-skill authoring stage separately after the team is reviewed.
The stage must report an explicit success, including a valid no-skills-required
outcome when appropriate; a missing or failed result is not silently treated as
an empty skills set.

The team stage writes the versioned handoff at
`docs/SKILL-CANDIDATES.json`:

```json
{
  "version": 1,
  "candidates": [
    {
      "name": "project-skill-id",
      "description": "What the project skill handles",
      "consumers": ["agent-id"],
      "action": "reuse",
      "reason": "Existing skill satisfies the responsibility"
    }
  ]
}
```

The project-skill stage may choose `reuse`, `extend`, `create`, or `omit`.
`omit` preserves an existing package unless reconciliation explicitly retires
it. The stage does not create or replace the execution manifest.

From the launcher, invoke the independent stage with:

```bash
forge-launcher draft-skills --repo <path> \
  --prd-model <id|inherit> --team-model <id|inherit> --skills-model <id|inherit>
```

Use `forge-launcher authoring-config` to save or clear the versioned project
settings, and `forge-launcher authoring-models --runner copilot|opencode
--refresh` to refresh the runner inventory before choosing an explicit model.
Config writes validate schema only; live availability is checked when a stage
is invoked. The inventory is stored separately from execution-agent overrides.

---

## Step 4.5 - Assign Models per Agent (Optional but Recommended)

An unset authoring or execution model inherits the active runner default. Do not
claim a concrete default model ID unless the runner inventory reports one. The
authoring model settings use `docs/authoring-config.json` with optional `prd`,
`team`, and `skills` keys, plus `FORGE_PRD_MODEL`, `FORGE_TEAM_MODEL`, and
`FORGE_SKILLS_MODEL` stage overrides. Explicit unavailable selections must fail
clearly rather than being silently replaced.

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
Review the Agent Impact Assessment and update the agent team (`.md` files) in .agents/agents/ accordingly.
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

# Parallel dispatch (opt-in, harness-gated) - up to 3 ready tasks at once
npm run workflow-engine -- run --harness opencode --concurrency 3

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
| **Build reviewed PRD from idea** | `@workspace /forge-auto-build-prd I want to build [idea]` |
| **Headless PRD from idea** | `opencode run --auto --dir "<repo>" "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD. After drafting, run a PRD gap check: every major component must have clear acceptance criteria, a defined tech stack, non-functional requirements (performance, security, privacy), and implementation phases; fill any gaps before approving."` |
| **Interactive build in the harness** | `@workspace @project-orchestrator Execute the full build` |
| **Autonomous engine build** | `forge-launcher engine-run --harness opencode --yes` or `@workspace @workflow-orchestrator Run the workflow` |
| **Pick up where you left off** | `forge-launcher resume` (or `--repo <path>`) |
| **Full auto build (terminal/headless, requires PRD)** | `forge-launcher --headless` (drives `opencode run --auto "/forge-auto-build Use docs/PRD.md as the project PRD. GO"` / `copilot -p "..." --yolo`) |
| **Full auto build (workflow-engine path)** | `opencode run --auto --dir "<repo>" "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine"` |
| **Launcher headless (whole pipeline)** | `forge-launcher --headless` (add `--dry-run` to print the command) |
| **Launcher auto-draft (idea → PRD → team)** | `forge-launcher --draft` (non-interactive: set `FORGE_AUTO_DRAFT=1`) |
| Bootstrap (default) | `forge-launcher bootstrap ~/Projects/my-project` |
| Bootstrap (GitHub Copilot) | `forge-launcher bootstrap ~/Projects/my-project --harness github` |
| Bootstrap (Claude Code) | `forge-launcher bootstrap ~/Projects/my-project --harness claude` |
| Bootstrap (opencode) | `forge-launcher bootstrap ~/Projects/my-project --harness opencode` |
| Build PRD from seed docs | `@workspace /forge-build-prd Build a complete PRD using docs/...` |
| Build PRD from idea | `@workspace /forge-build-prd I want to build [idea]...` |
| PRD quality pass | `@workspace /forge-build-prd Review docs/PRD.md for gaps...` |
| Decompose PRD (manual, when needed) | `@workspace /forge-decompose-prd Analyze docs/PRD.md...` |
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
| Dark run (GitHub Copilot harness) | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- run --harness copilot` |
| Dark run (OpenAI harness) | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- run --harness openai` |
| Dark run (stub / dry-run) | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- run --harness stub` |
| Standalone engine run (outside CLI) | `./scripts/forge-engine-run.sh --harness opencode --yes` (PowerShell: `.\scripts\forge-engine-run.ps1 -Harness copilot -Yes`; add `--dry-run`/`-DryRun` to print) |
| Workflow status | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- status` |
| Replay failed task | `cd .agents/skills/forge-workflow-engine && npm run workflow-engine -- replay <task-id>` |
| Dark run (via agent) | `@workspace @workflow-orchestrator Run the workflow using OpenCode.` |

---

## Tips

- **Open your target project first** - agents and skills resolve from the current workspace or repo directory.
- **Review before executing** - always run the execution plan prompt (Step 5a) before asking the orchestrator to build anything.
- **Headless runs get the same quality checks** - the headless/auto-draft PRD flow runs the Step 2b gap check (acceptance criteria, tech stack, NFRs, phases) and fills gaps before approving, and the skills' built-in validations (decomposition Step 6, team Step 7) always run - headless or not.
- **One phase at a time** - resist asking the orchestrator to "build everything". Phases are checkpoints; review each one.
- **Commit after each phase** - the orchestrator will prompt you, but make a habit of it. `git add . && git commit -m "feat: complete Phase N"`.
- **The PRD is the source of truth** - if something looks wrong, fix the PRD first, then re-run the affected steps.
- **Re-bootstrap safely** - run `forge-launcher bootstrap . --force` any time you want to pull in updated MyForge templates without losing your generated agents.
- **Optimize generated skills** - after the initial build, run `@workspace /forge-optimize-skills` to audit your skills against best practices. The audit surfaces specific improvements you can apply immediately.
- **Full auto build** - use `forge-auto-build` when a reviewed PRD already exists (`docs/PRD.md`, or the decomposed layout) and you want a single command to take you from that PRD to committed, validated code. One pre-flight gate, then fully autonomous. If no PRD exists yet, run `forge-auto-build-prd` first. If the run is interrupted, just re-invoke it -it resumes from `docs/PROGRESS.md`.
- **Dark orchestration** - use `workflow-orchestrator` + the workflow engine for fully autonomous execution through a real harness (OpenCode or OpenAI API). Dry-run first with `--harness stub` to verify the engine setup before spending tokens.
