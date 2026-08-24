# McFuzzy Agent Forge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Bash](https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=fff)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?logo=powershell&logoColor=fff)
![Forge Launcher](https://img.shields.io/badge/forge--launcher-interactive%20CLI-blueviolet)

> Turn a reviewed PRD into a coordinated team of specialist agents and an autonomous build - in minutes. Works with any agent harness that reads agents and skills from a repo.

**McFuzzy Agent Forge** turns your requirements into a team of specialist agents that plan, implement, and validate a project. The PRD is the quality gate: you deliberately review it, then the pipeline generates the team and drives the build - either interactively or fully autonomously ("dark orchestration").

**Latest: v3.11** - workflow-engine heartbeat, OpenCode adapter fix, artifact store on by default, and a clearer engine handoff in the launcher. See [docs/updates.md](docs/updates.md) and [docs/workflow-engine.md](docs/workflow-engine.md).

---

## Quick Start (fastest path)

One command, zero to running - no PRD needed. The launcher creates your repo, bootstraps Agent Forge, captures your idea, and queues the right pipeline stage:

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge
./scripts/forge-launcher.sh          # PowerShell: .\scripts\forge-launcher.ps1
```

Answer the prompts, then open the repo in your agent harness and run the queued command it prints. Full reference: [docs/forge-launcher.md](docs/forge-launcher.md).

---

## Choose Your Path

| You want… | Run this | What happens |
|---|---|---|
| **Guided onboarding, zero setup** | `./scripts/forge-launcher.sh` | Creates repo, bootstraps templates, captures your idea, queues the PRD stage or the build |
| **Idea → PRD → team, auto-drafted** | `./scripts/forge-launcher.sh --draft` | Generates the PRD and/or agent team non-interactively (best answers, review boundaries), then offers the workflow-engine run now/later |
| **Turn an idea into a reviewed PRD** | `@workspace /forge-auto-build-prd I want to build [idea]` | Confirms idea → builds and reviews `docs/PRD.md` → auto-decomposes qualifying PRDs → stops before the team |
| **Build from an existing PRD, hands-free** | `@workspace /forge-auto-build docs/PRD.md` | PRD → agent team → (optional models) → build, with validation + commit after every phase |
| **…using dark orchestration** | add `GO --workflow-engine` at the pre-flight gate | Compiles `EXECUTION-MANIFEST.json` and runs `forge-workflow-engine` unattended (detached process, log: `docs/engine-run.log`) |
| **Manual, phase-by-phase control** | `forge-build-prd` → `forge-build-agent-team` → `@project-orchestrator` | A human reviews each phase before the next starts |
| **Fully autonomous engine agent** | `@workspace @workflow-orchestrator Run the workflow` | One pre-run gate, then the engine dispatches every task unattended |
| **Add a feature to a finished project** | `@workspace /forge-build-feature-prd I want to add [feature]` | Feature PRD → targeted team update → execute feature phases |
| **Per-agent model selection** | `@workspace /forge-assign-models …` | Discover → recommend (`docs/MODEL-PLAN.md`) → apply `model:` frontmatter |
| **Fully terminal-driven (no chat)** | `./scripts/forge-launcher.sh --headless` | Kicks off the queued skill via `opencode run --auto` or `copilot -p --yolo` - never opens an interactive CLI |

> **`forge-auto-build` requires an existing PRD** (`docs/PRD.md`, or the decomposed `docs/product-vision.md` + `docs/features/*.md`). It never generates one - if no PRD exists it stops and directs you to `forge-auto-build-prd` or `forge-build-prd`. PRD creation is a deliberate stage; execution is a separate, deliberate stage.

---

## How It Works

```
 Idea →  PRD  →  [auto-decompose]  →  Agent Team  →  [models]  →  Build
 │      └ forge-build-prd /            └ forge-build-       └ forge-auto-build:
 │        forge-auto-build-prd           agent-team            forge-orchestrate-build
 │                                                             or forge-workflow-engine
```

1. **PRD (quality gate).** `forge-build-prd` interviews you, drafts `docs/PRD.md`, and runs a review checklist before you confirm it. **Decomposition is automatic**: a qualifying PRD (15+ functional requirements or 3+ implementation phases) is split into `docs/product-vision.md` + `docs/features/*.md` with no opt-in question. `forge-auto-build-prd` wraps this whole stage for a one-liner idea.
2. **Agent team.** `forge-build-agent-team` maps every requirement to a specialist agent, using `skill-creator` + `skill-review` so every generated skill meets a quality bar. It auto-detects Full Build, Vision + Features, and Feature Increment modes.
3. **Models (optional).** `forge-assign-models` matches each agent to an appropriately sized model so lightweight agents don't default to the most expensive one.
4. **Build.** `forge-auto-build` executes all phases - via `forge-orchestrate-build` (prompt-driven, per-phase commits) or `forge-workflow-engine` (dark orchestration: one gate, then unattended through a harness adapter).

Two principles govern the pipeline: **automate mechanical gates** (like decomposition), and **preserve human gates** (like the PRD review) - see [ADR-018](docs/adr/018-auto-prd-decomposition-and-build-prerequisite.md).

---

## Getting Started

### Prerequisites

- An agent harness that reads agents/skills from a repo (GitHub Copilot, Claude Code, opencode, or any compatible runtime)
- Git + Bash (Linux/macOS) or PowerShell 5.1+ (Windows)
- Optional: `gh` (GitHub harness), `opencode`/`claude` CLIs (auto-launch), [Ollama](https://ollama.com/) (local models)

### 1. Clone Agent Forge

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge
```

### 2. Bootstrap into your project

Copies agent and skill templates into your project's harness directory (default `.agents/`):

```bash
# Bash
./scripts/bootstrap.sh /path/to/your/project
./scripts/bootstrap.sh /path/to/your/project --harness github   # GitHub Copilot
./scripts/bootstrap.sh /path/to/your/project --harness claude   # Claude Code
./scripts/bootstrap.sh /path/to/your/project --harness opencode # opencode

# PowerShell
.\scripts\bootstrap.ps1 -Target C:\path\to\project
.\scripts\bootstrap.ps1 -Target C:\path\to\project -Harness github
```

### 3. Commit and open the project

```bash
cd /path/to/your/project
git init && git add .agents/ && git commit -m "chore: bootstrap Agent Forge templates"
```

Open the project in your harness, then pick a path.

### Path A - Full auto-build (requires a PRD)

If `docs/PRD.md` doesn't exist yet, build it first:

```
@workspace /forge-auto-build-prd I want to build [your idea]
```

Then run the build against the reviewed PRD:

```
@workspace /forge-auto-build docs/PRD.md
```

Review the pre-flight summary and type `GO`. The pipeline runs autonomously: agent team → (optional models) → all build phases, with validation and a commit after each phase. Add `GO --workflow-engine` to execute the build through the workflow engine instead of the prompt-driven orchestrator.

### Path B - Manual, step-by-step

Run each stage yourself, reviewing as you go:

```
@workspace /forge-build-prd Create a PRD for [your idea]
@workspace /forge-build-agent-team Build an agent team from docs/PRD.md
@workspace /forge-assign-models Recommend a per-agent model and write docs/MODEL-PLAN.md
@workspace @project-orchestrator Execute Phase 1 only
```

### Path C - Dark orchestration

For fully autonomous execution through a real harness (OpenCode CLI, OpenAI API, or a FlowForge kernel), compile the execution manifest and let the engine drive:

```bash
cd .agents/skills/forge-execution-adapter && npm install && npm run forge-execution-adapter -- compile
cd ../forge-workflow-engine && npm install && npm run workflow-engine -- run --harness opencode --yes
```

Or drive it conversationally via the companion agent:

```
@workspace @workflow-orchestrator Run the workflow
```

Dark orchestration means one pre-run gate, then unattended dispatch - no approvals between tasks. Resume with `run` after interruption; replay a failed task with `replay <task-id>`. Dry-run first with `--harness stub` to validate setup without spending tokens.

### Path D - Fully terminal-driven (no chat session)

You never need to open an interactive CLI. Authoring (PRD → team → manifest) happens in a chat session; **execution runs detached**, outside it. The workflow engine is a standalone Node process that shells out to `opencode run` / `copilot -p` per task, and the launcher can drive the whole pipeline headlessly:

```bash
# Fastest: launcher does repo → bootstrap → idea → headless skill run
./scripts/forge-launcher.sh --headless

# Or auto-draft the PRD and/or agent team non-interactively, with review
# boundaries, then run the engine now (detached) or later:
./scripts/forge-launcher.sh --draft

# Or drive the queued skill directly:
opencode run --auto "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine"
copilot -p "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine" --yolo

# Once the manifest exists, run the engine itself as a standalone process
# (from a second terminal, CI, or nohup) - it never needs a chat session:
./scripts/forge-engine-run.sh --harness opencode --yes          # per-task: opencode run
./scripts/forge-engine-run.sh --harness copilot --yes           # per-task: copilot -p --yolo
```

- `opencode run` / `copilot -p` are non-interactive; `--auto` / `--yolo` auto-approve tool permissions.
- `forge-auto-build`'s engine path (`GO --workflow-engine`) starts the engine **detached** (log: `docs/engine-run.log`) and polls `docs/WORKFLOW-STATE.json` to completion - the build survives the chat session and resumes with `run`.
- While a task runs, the engine prints a heartbeat line (`…still working on task <id> …`) so a quiet terminal doesn't look hung. Tune it with `--heartbeat-ms <ms>` or `FORGE_ENGINE_HEARTBEAT_MS` (default 15s; `0` disables).
- With no PRD yet, the launcher queues `forge-auto-build-prd` in headless mode (auto-proceeds with default assumptions recorded in the PRD's Open Questions).
- `--draft` (PowerShell: `-Draft`) pre-answers the Step 8 auto-draft prompts: generate the PRD from `docs/IDEA.md`, then the agent team from the PRD (from the decomposed vision + features when present), committing each stage and pausing for review before offering the engine run. Non-interactive runs use `FORGE_AUTO_DRAFT=1`.
- `--dry-run` prints the exact command instead of running it. Configure the runner with `FORGE_RUN_WITH=opencode|copilot`, the engine path with `FORGE_WORKFLOW_ENGINE=1`, and the per-task engine harness with `FORGE_ENGINE_HARNESS=opencode|copilot|openai|stub`.
- The workflow engine's `--yes` (or `FORGE_ENGINE_YES=1`) skips its interactive pre-run gate for CI/headless runs.

---

## Daily Workflows

- **Add a feature** - `forge-build-feature-prd` produces a Feature PRD, then `forge-build-agent-team` updates only the affected agents (Feature Increment mode), then `@project-orchestrator` executes the feature phases.
- **Decompose manually** - automatic for qualifying PRDs; run `@workspace /forge-decompose-prd` yourself for older or modified PRDs.
- **Assign models** - discover your cloud + local models, get a recommendation, and apply it per agent.
- **Run locally (BYOK)** - point your harness at [Ollama](docs/running-with-local-models.md) for a fully local pipeline.
- **Optimize skills** - audit generated skills against [agentskills.io best practices](https://agentskills.io/skill-creation/best-practices).

Full copy-paste prompts for every workflow: **[docs/prompt-playbook.md](docs/prompt-playbook.md)**.

---

## Project Layout

```
mcfuzzy-agent-forge/
├── templates/
│   ├── agents/                  # project-orchestrator, workflow-orchestrator, forge-team-builder
│   └── skills/                  # forge-auto-build, forge-auto-build-prd, forge-build-prd,
│                                # forge-build-agent-team, forge-decompose-prd, forge-assign-models,
│                                # forge-orchestrate-build, forge-workflow-engine, forge-execution-adapter,
│                                # forge-workforce-compiler, skill-creator, skill-review, …
├── scripts/
│   ├── forge-launcher.sh/.ps1   # interactive onboarding (repo → bootstrap → idea → queue;
│   │                            #   flags: --headless, --draft, --non-interactive, --dry-run)
│   ├── forge-engine-run.sh/.ps1 # standalone dark-orchestration runner (engine, outside the CLI)
│   └── bootstrap.sh/.ps1        # copy templates into any target repo
└── docs/                        # prompt-playbook, forge-launcher, testing-guide, ADRs, updates
```

`bootstrap` copies every `templates/` package into your project's harness directory. Skills follow the [agentskills.io specification](https://agentskills.io/specification): a directory with `SKILL.md` plus optional `references/`, `scripts/`, and `assets/`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bootstrap `permission denied` | `chmod +x scripts/bootstrap.sh` |
| Agents not appearing in the harness | Commit the files; verify paths match your harness (`.github/agents/`, `.claude/agents/`, `.opencode/agents/`, `.agents/agents/`); `name:` must match the filename |
| `forge-auto-build` stops asking for a PRD | That's correct - run `forge-auto-build-prd` (or `forge-build-prd`) to create the reviewed PRD first |
| Wrong harness directory | Re-run bootstrap with the correct `--harness` flag |
| Team too big / overlapping agents | Tighten PRD boundaries and re-run the team builder |

---

## FAQ

**Can I go from idea to built project without doing anything manually?**
Yes - run `forge-auto-build-prd` to produce the reviewed PRD (decomposition runs automatically), then `forge-auto-build`. One pre-flight gate per stage, then fully autonomous.

**Do I need to use all the templates?**
No - use what you need, or treat them as examples.

**Can I use this without a PRD?**
Yes - bootstrap the templates and write agent files manually, or run `forge-auto-build-prd` to build a PRD from your idea.

**Does this work for non-web projects?**
Yes - CLI tools, mobile apps, embedded systems, data pipelines. The team builder adapts to whatever stack your PRD describes.

**Can I resume work across sessions?**
Yes. The orchestrator/engine writes `docs/PROGRESS.md` after each phase; both build paths resume from it.

---

## Resources

- [Prompt Playbook](docs/prompt-playbook.md) - full copy-paste prompt sequence
- [Forge Launcher](docs/forge-launcher.md) - launcher reference and non-interactive mode
- [Workflow Engine](docs/workflow-engine.md) - autonomous execution reference (run, resume, replay, harnesses)
- [Testing Guide](docs/testing-guide.md) - manual verification of every path (skill creation, dark orchestration, launcher E2E, OpenAI, FlowForge kernel, artifacts)
- [Updates](docs/updates.md) - release notes and change history
- [Local Models](docs/running-with-local-models.md) - BYOK / Ollama setup
- [The Story](docs/THE-STORY.md) / [Part 2](docs/THE-STORY-PART-2.md) - design history

## Support

1. Check [Troubleshooting](#troubleshooting) and [FAQ](#faq) above.
2. [Open an issue](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/issues) on GitHub.

---

**Made with ❤️ by [McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
