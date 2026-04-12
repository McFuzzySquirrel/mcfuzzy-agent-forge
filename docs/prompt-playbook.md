# Agent Forge Prompt Playbook

A step-by-step command and prompt reference for anyone bootstrapping a new project with Agent Forge. Copy-paste each command or prompt in sequence.

---

## Prerequisites

- GitHub Copilot active in VS Code
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

After bootstrapping, commit the templates so Copilot can see them:

```bash
cd ~/Projects/my-new-project
git add .github/
git commit -m "chore: bootstrap Agent Forge agent and skill templates"
```

> Open your new project in VS Code before running the prompts below. All prompts must run in that project's Copilot Chat workspace context.

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
Create agent files in .github/agents/ and skill files in .github/skills/.
Ensure every PRD requirement has a clearly assigned primary owner agent.
```

**From a decomposed Product Vision + Features:**
```
@workspace /forge-build-agent-team Analyze docs/product-vision.md and all feature documents in docs/features/.
Generate a complete specialist agent team in .github/agents/ and skills in .github/skills/ 
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
git add .github/agents/ .github/skills/ docs/
git commit -m "feat: generate specialist agent team from PRD"
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
Review the Agent Impact Assessment and update the agent team in .github/agents/ accordingly.
Only modify or create agents that are directly affected by this feature.
```

### 6c. Execute the feature

```
@workspace @project-orchestrator A new Feature PRD is at docs/features/feature-XX-[name].md.
Read it, build the feature execution plan, and execute Phase F1 only.
Stop after F1 and report status.
```

---

## Quick Reference — All Prompts at a Glance

| Step | Command / Prompt |
|------|-----------------|
| Bootstrap (Bash) | `./scripts/bootstrap.sh ~/Projects/my-project` |
| Bootstrap (PowerShell) | `.\scripts\bootstrap.ps1 -Target C:\Projects\my-project` |
| Build PRD from seed docs | `@workspace /forge-build-prd Build a complete PRD using docs/...` |
| Build PRD from idea | `@workspace /forge-build-prd I want to build [idea]...` |
| PRD quality pass | `@workspace /forge-build-prd Review docs/PRD.md for gaps...` |
| Decompose PRD (optional) | `@workspace /forge-decompose-prd Analyze docs/PRD.md...` |
| Generate agent team (PRD) | `@workspace /forge-build-agent-team Analyze docs/PRD.md...` |
| Generate agent team (features) | `@workspace /forge-build-agent-team Analyze docs/product-vision.md...` |
| Validate agent team | `@workspace /forge-build-agent-team Validate the agent team...` |
| Generate execution plan | `@workspace @project-orchestrator Analyze docs/PRD.md and produce an execution plan only...` |
| Execute Phase N | `@workspace @project-orchestrator Execute Phase N only...` |
| Resume from checkpoint | `@workspace @project-orchestrator Read docs/PROGRESS.md and resume...` |
| New feature PRD | `@workspace /forge-build-feature-prd I want to add [feature]...` |
| Execute feature phase | `@workspace @project-orchestrator Read docs/features/feature-XX.md, execute Phase F1 only...` |

---

## Tips

- **Always open your target project in VS Code** before running prompts — `@workspace` resolves to the currently open workspace.
- **Review before executing** — always run the execution plan prompt (Step 5a) before asking the orchestrator to build anything.
- **One phase at a time** — resist asking the orchestrator to "build everything". Phases are checkpoints; review each one.
- **Commit after each phase** — the orchestrator will prompt you, but make a habit of it. `git add . && git commit -m "feat: complete Phase N"`.
- **The PRD is the source of truth** — if something looks wrong, fix the PRD first, then re-run the affected steps.
- **Re-bootstrap safely** — run `bootstrap.sh --force` any time you want to pull in updated Agent Forge templates without losing your generated agents.
