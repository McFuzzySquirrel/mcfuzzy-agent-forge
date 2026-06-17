# Agent Forge Prompt Playbook

A step-by-step command and prompt reference for anyone bootstrapping a new project with Agent Forge. Copy-paste each command or prompt in sequence.

---

## Prerequisites

- An agent harness — **GitHub Copilot** in VS Code or [Copilot CLI](https://docs.github.com/en/copilot/copilot-cli), **Claude Code**, or any runtime that detects agents and skills from a repo directory
- This repository cloned locally
- A target project directory created and initialized as a git repo

```bash
mkdir ~/Projects/my-new-project
cd ~/Projects/my-new-project
git init
```

---

## Step 1 — Bootstrap Agent Forge into Your Project

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

> Open your target project before running the prompts below — your agent harness auto-detects agents and skills from `.agents/agents/` and `.agents/skills/` (or `.github/` / `.claude/` if bootstrapped with the matching `--harness` flag).
>
> The prompts below use `@workspace` syntax. If your harness uses different syntax for invoking agents and skills, adapt accordingly (e.g., `/forge-build-prd ...` directly in Copilot CLI).

---

## Fast Path — One-Prompt Bootstrap (Optional)

If you just want to go from a one-liner idea to a reviewed PRD and a generated agent team without copy-pasting between skills, use the `forge-bootstrap-project` meta-skill. It chains `forge-build-prd` → **pause for PRD review** → `forge-build-agent-team` → **pause for team review** → optionally `forge-assign-models`. The review pauses are preserved — each one emits a verification checklist before the next step runs.

```
@workspace /forge-bootstrap-project I want to build [describe your idea in one sentence].
```

At each pause, reply `approved` to continue, `revise: <notes>` to iterate on the current artifact, or `stop` to end the flow. At Pause 2, reply `approved and assign models` to also run `forge-assign-models` in Recommend mode.

If you prefer to drive each step yourself, skip this section and follow Steps 2–4.5 below.

---

## Step 2 — Build the PRD

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

## Step 3 — (Optional) Decompose into Features

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

## Step 4 — Generate the Agent Team

### 4a. Build the team

**From a monolithic PRD:**
```
@workspace /forge-build-agent-team Analyze docs/PRD.md and generate a complete specialist agent team.
Create agent files in .agents/agents/ and skill files in .agents/skills/.
Ensure every PRD requirement has a clearly assigned primary owner agent.
```

**From a decomposed Product Vision + Features:**
```
@workspace /forge-build-agent-team Analyze docs/product-vision.md and all feature documents in docs/features/.
Generate a complete specialist agent team in .agents/agents/ and skills in .agents/skills/ 
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

## Step 4.5 — Assign Models per Agent (Optional but Recommended)

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

## Step 4.6 — Scaffold the Solution (when the PRD selects Microsoft Agent Framework)

If your PRD's Technology Stack picks **[Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/)**,
run the `forge-build-agent-framework-solution` skill **before** asking the orchestrator to
execute Phase 1. It scaffolds the .NET or Python project (folder layout, packages, host,
sample agent, tools, workflow, tests, README) so the specialist agents have a real
codebase to build on.

### 4.6a. Plan the scaffold (no files written)

```
@workspace /forge-build-agent-framework-solution Read docs/PRD.md, confirm Microsoft Agent
Framework is the chosen stack, and present an extracted plan: language stack (.NET or
Python), agents, tools, orchestration topology, hosting surface, and required env vars.
Do not write any files yet.
```

### 4.6b. Generate the scaffold

After approving the plan:

```
@workspace /forge-build-agent-framework-solution Scaffold the solution as planned. Use
ecosystem tooling (dotnet new / uv init) and verify the project restores, builds, and
runs an empty test suite. Report the folder tree, packages used, and the exact commands
to run it.
```

### 4.6c. Add scaffolding for a new feature

When `forge-build-feature-prd` produces a Feature PRD that needs new agents, tools, or
workflow nodes on top of an existing Agent Framework solution:

```
@workspace /forge-build-agent-framework-solution Read docs/features/feature-XX-[name].md
and extend the existing Agent Framework solution in place. Add only what the Feature PRD
requires (new agent factory, new tool, new workflow edge) and leave unrelated code alone.
```

Then commit:

```bash
git add .
git commit -m "feat: scaffold Microsoft Agent Framework solution"
```

---

## Step 5 — Plan and Execute the Build

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

## Step 6 — Add a Feature to an Existing Project

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
Review the Agent Impact Assessment and update the agent team in .agents/agents/ accordingly.
Only modify or create agents that are directly affected by this feature.
```

### 6c. Execute the feature

```
@workspace @project-orchestrator A new Feature PRD is at docs/features/feature-XX-[name].md.
Read it, build the feature execution plan, and execute Phase F1 only.
Stop after F1 and report status.
```

---

## Step 7 — Optimize Existing Skills

After building a project, audit the generated skills against agentskills.io best practices:

### 7a. Audit skills

```
@workspace /forge-optimize-skills Audit all skills in .agents/skills/ against best practices.
Score each skill and produce docs/SKILL-AUDIT.md. Do not modify any files yet.
```

### 7b. Apply approved improvements

After reviewing `docs/SKILL-AUDIT.md`:

```
@workspace /forge-optimize-skills Apply the approved changes from docs/SKILL-AUDIT.md.
Only modify skills I've approved in the audit report.
```

---

## Quick Reference — All Prompts at a Glance

| Step | Command / Prompt |
|------|-----------------|
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
| Scaffold Agent Framework solution (plan) | `@workspace /forge-build-agent-framework-solution Read docs/PRD.md... present a plan, do not write files` |
| Scaffold Agent Framework solution (apply) | `@workspace /forge-build-agent-framework-solution Scaffold the solution as planned...` |
| Extend Agent Framework solution for a feature | `@workspace /forge-build-agent-framework-solution Read docs/features/feature-XX... extend the existing solution` |
| Generate execution plan | `@workspace @project-orchestrator Analyze docs/PRD.md and produce an execution plan only...` |
| Execute Phase N | `@workspace @project-orchestrator Execute Phase N only...` |
| Resume from checkpoint | `@workspace @project-orchestrator Read docs/PROGRESS.md and resume...` |
| New feature PRD | `@workspace /forge-build-feature-prd I want to add [feature]...` |
| Execute feature phase | `@workspace @project-orchestrator Read docs/features/feature-XX.md, execute Phase F1 only...` |
| Audit skills | `@workspace /forge-optimize-skills Audit all skills in .agents/skills/ against best practices...` |
| Apply skill improvements | `@workspace /forge-optimize-skills Apply the approved changes from docs/SKILL-AUDIT.md` |

---

## Tips

- **Open your target project first** — agents and skills resolve from the current workspace or repo directory.
- **Review before executing** — always run the execution plan prompt (Step 5a) before asking the orchestrator to build anything.
- **One phase at a time** — resist asking the orchestrator to "build everything". Phases are checkpoints; review each one.
- **Commit after each phase** — the orchestrator will prompt you, but make a habit of it. `git add . && git commit -m "feat: complete Phase N"`.
- **The PRD is the source of truth** — if something looks wrong, fix the PRD first, then re-run the affected steps.
- **Re-bootstrap safely** — run `bootstrap.sh --force` any time you want to pull in updated Agent Forge templates without losing your generated agents.
- **Optimize generated skills** — after the initial build, run `@workspace /forge-optimize-skills` to audit your skills against best practices. The audit surfaces specific improvements you can apply immediately.
