# McFuzzy Agent Forge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Bash](https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=fff)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?logo=powershell&logoColor=fff)

> Bootstrap custom GitHub Copilot agent teams from Product Requirements Documents

Transform your PRD into a specialized team of GitHub Copilot custom agents and reusable skills. This framework analyzes your project requirements and generates agent definitions that coordinate like a real development team — each with clear ownership, expertise, and collaboration patterns.

---

## Recent Updates

### March 2026
- **Agent/Skill Separation & Progress Reporting** ([ADR-001](docs/adr/001-agent-skill-separation-and-progress-reporting.md)) — Slimmed the forge-team-builder agent to delegate detailed procedures to the skill, and added Process and Workflow guidance to the agent template so generated specialists follow consistent verification, commit, and progress reporting practices
- **Progress Tracking & Incremental Commits** — The project orchestrator now maintains a `docs/PROGRESS.md` file tracking completed tasks, commits work incrementally after each successful build/test, and supports resuming from checkpoints
- **Feature PRD Strategy** — New `forge-build-feature-prd` skill for adding features to existing projects, with automatic agent team extension and incremental development support
- **Agent Freshness** — Built-in verification that agents use current stable APIs, frameworks, and best practices. PRD builder verifies tech stack currency, orchestrator validates before Phase 1
- **Bootstrap Script Improvements** — Fixed PowerShell `.Path` property error for better cross-platform compatibility

---

## Overview

**McFuzzy Agent Forge** is a template repository and bootstrapping toolkit that creates custom GitHub Copilot agent teams tailored to your project. Instead of working with a single general-purpose AI assistant, you get a coordinated team of specialists — each focused on a specific domain, framework, or feature area.

### What's included

- **Project Orchestrator Agent** — Coordinates all specialist agents through PRD implementation phases, executing the full build systematically
- **Team Builder Agent** — Analyzes PRDs and generates complete agent teams with clear ownership boundaries
- **PRD Builder Skill** — Creates comprehensive Product Requirements Documents from ideas or research
- **Feature PRD Builder Skill** — Creates Feature PRDs for adding new features to existing projects
- **Agent Team Builder Skill** — Process templates for designing agent teams from specifications
- **Bootstrap Scripts** — Bash and PowerShell scripts to deploy templates into any repository

### How it works

1. **Bootstrap to your project** using the provided scripts to copy agents/skills to your repository
2. **Create a PRD** using the `forge-build-prd` skill (or bring your own)
3. **Generate your agent team** by running the `forge-team-builder` agent against your PRD
4. **Execute the build** — Use the project-orchestrator agent to systematically implement your project, or work with specialist agents directly for targeted development

---

## Getting Started

### Prerequisites

- Git
- Bash (Linux/macOS) or PowerShell 5.1+ (Windows)
- A target repository where you want to deploy the agents
- GitHub Copilot (to use the generated agents)
- [Ollama](https://ollama.com/) (optional — for local model BYOK support)

### Quick Start

Clone this repository:

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge
```

Bootstrap the templates into your target project:

**Bash:**
```bash
./scripts/bootstrap.sh /path/to/your/project
```

**PowerShell:**
```powershell
.\scripts\bootstrap.ps1 -Target C:\path\to\your\project
```

The bootstrap script will:
- Create `.github/agents/` and `.github/skills/` directories in your target project
- Copy the agent and skill templates
- Prompt before overwriting any existing files (use `--force` / `-Force` to skip prompts)

> [!TIP]
> After bootstrapping, commit the `.github/agents/` and `.github/skills/` directories to activate the agents in GitHub Copilot.

---

## Usage

### Bootstrap Options

**Bash:**
```bash
# Interactive (prompts for target path)
./scripts/bootstrap.sh

# Specify target path
./scripts/bootstrap.sh ../my-project

# Force overwrite without prompting
./scripts/bootstrap.sh ../my-project --force
```

**PowerShell:**
```powershell
# Interactive (prompts for target path)
.\scripts\bootstrap.ps1

# Specify target path
.\scripts\bootstrap.ps1 -Target ..\my-project

# Force overwrite without prompting
.\scripts\bootstrap.ps1 -Target ..\my-project -Force
```

### Working with the Agents

Once bootstrapped to your project, you can interact with the agents through GitHub Copilot:

#### 1. Create a PRD

In GitHub Copilot Chat:
```
@workspace /forge-build-prd Create a PRD for a task management web application
```

The agent will interview you about requirements, then generate a comprehensive PRD in your project.

#### 2. Generate your Agent Team

Once you have a PRD (in `docs/PRD.md` or similar):
```
@workspace /forge-team-builder Analyze docs/PRD.md and create the agent team
```

The team builder will:
- Analyze your tech stack and requirements
- Design specialist roles (architects, framework specialists, feature engineers, QA, etc.)
- Generate agent files in `.github/agents/`
- Generate skill files in `.github/skills/`
- Ensure no gaps or overlaps in ownership

#### 3. Work with Specialist Agents

After generation, you can call specific agents for their areas:

#### 3. Execute the Build (Automated)

The generated team includes a **project-orchestrator** agent that acts as your project manager, coordinating all specialists through the PRD's implementation phases:

```
@workspace @project-orchestrator Execute the full build
```

The orchestrator will:
- Read the PRD and understand all implementation phases
- Identify the correct sequence for calling specialist agents
- Execute tasks phase by phase, respecting all dependencies
- Verify deliverables before proceeding to dependent work
- Maintain a progress tracking file (`docs/PROGRESS.md`) with task status
- Commit work incrementally after each successful build/test
- Provide progress updates after each phase
- Handle coordination between agents automatically

**Phase-by-phase execution:**
```
@workspace @project-orchestrator Execute Phase 1
@workspace @project-orchestrator Continue from Phase 2
@workspace @project-orchestrator Resume from last checkpoint
```

> [!TIP]
> The orchestrator creates `docs/PROGRESS.md` to track completed work. Use "Resume from last checkpoint" to continue where you left off, even on a different machine or in a new session.

**Example orchestration flow:**
```
🚀 Phase 1: Foundation
  ✅ @project-architect → Project structure created
  ✅ @nextjs-specialist → Framework initialized
  ✅ @database-specialist → Database schema defined

🚀 Phase 2: Core Features
  ✅ @auth-engineer → Authentication system built
  ✅ @api-engineer → API endpoints created
  ✅ @frontend-engineer → UI components implemented

🚀 Phase 3: Testing & Polish
  ✅ @qa-tester → Test suite complete, all tests passing
```

> [!TIP]
> Use the orchestrator for full builds or to execute entire implementation phases. It ensures nothing is missed and work happens in the right order.

#### 4. Work with Specialist Agents (Manual)

For targeted tasks or iterative development, you can also call specific agents directly:
```
@workspace @react-specialist Implement the login form component
@workspace @api-engineer Create the authentication endpoints
@workspace @qa-tester Write integration tests for the auth flow
```

This manual approach is useful when:
- You're working on a specific feature increment
- You want fine-grained control over what gets built
- You're iterating on existing code rather than building from scratch

#### 5. Add Features to an Existing Project

After the initial build is complete, you can add new features without regenerating your entire agent team. This three-step workflow creates a Feature PRD, updates only the agents that need to change, and executes the feature phases:

**Step 1: Create a Feature PRD**
```
@workspace /forge-build-feature-prd Add a real-time notification system to the project
```

The skill will analyze your existing PRD, agent team, and codebase, then interview you about the feature's scope, integration points, and impact. It produces a Feature PRD (recommended location: `docs/features/`) that includes an Agent Impact Assessment.

**Step 2: Update the Agent Team**
```
@workspace /forge-team-builder Analyze docs/features/notifications.md and update the team
```

The team builder automatically detects that this is a Feature PRD (not a full project PRD) and switches to **Feature Increment Mode**:
- Extends existing agents with new responsibilities (additive changes only)
- Creates new specialist agents only if needed
- Leaves unaffected agents completely untouched

**Step 3: Execute the Feature Build**
```
@workspace @project-orchestrator Execute feature docs/features/notifications.md
```

The orchestrator executes the Feature PRD's F-prefixed phases (Phase F1, F2, etc.) in the context of the existing project, calling both existing and new agents as needed.

> [!TIP]
> Feature PRDs use `FT-` prefixed IDs (FT-FR-01, FT-US-01) and `F-` prefixed phases (Phase F1, F2) to avoid collision with the original PRD's IDs. This makes it easy to trace which requirements came from which document.

---

## Running with Local Models (BYOK)

GitHub Copilot CLI supports [Bring Your Own Key (BYOK)](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models), letting you point it at a local Ollama instance. Since Copilot CLI picks up `.github/agents/` and `.github/skills/` from your repo, your entire Agent Forge team can run against a local model — fully offline if needed.

### Setup

1. Install and start [Ollama](https://ollama.com/) with a model that supports **tool calling** and **streaming** (required by Copilot CLI):

```bash
ollama pull gemma4:e4b    # 9.6GB, 128K context — works well on 32GB RAM
```

2. Set the BYOK environment variables:

```bash
export COPILOT_PROVIDER_BASE_URL=http://localhost:11434
export COPILOT_MODEL=gemma4:e4b
```

3. Start Copilot CLI:

```bash
copilot
```

Your bootstrapped agents (`@project-orchestrator`, `@forge-team-builder`, and all generated specialists) will now use the local model.

> [!TIP]
> For fully air-gapped environments, also set `export COPILOT_OFFLINE=true` to prevent any calls to GitHub's servers.

### Recommended Local Models

| Model | Size | Context | Best for |
|-------|------|---------|----------|
| `gemma4:e4b` | 9.6GB | 128K | General-purpose — good balance of quality and resource usage |
| `gemma4:26b` | 18GB | 256K | Higher quality reasoning (MoE, 3.8B active params) — needs 32GB+ RAM |
| `qwen3:7b` | ~5GB | 128K | Lightweight alternative for constrained hardware |

> [!NOTE]
> Models must support tool calling (function calling) and streaming. Verify with your model's documentation before use.

---

## Persistent Project Memory with EJS

The [Engineering Journey System (EJS)](https://github.com/McFuzzySquirrel/Engineering-Journey-System) adds persistent project memory across sessions. Without it, agents start fresh every conversation — no awareness of past decisions, rejected approaches, or architectural context.

When bootstrapped alongside Agent Forge, EJS gives your agents:

- **Decision history** — Past ADRs and rationale are queryable from a local SQLite database (`.ejs.db`)
- **Session continuity** — Journey files record what happened each session, so agents can pick up where you left off
- **Accumulated context** — Learnings, patterns, and failures build up over time and get injected into agent prompts

### Bootstrap Order

For a new project, bootstrap in this order:

1. **EJS** — Sets up `ejs-docs/`, `.ejs.db`, journey templates, and the EJS recording contract in `copilot-instructions.md`
2. **Agent Forge** — Bootstrap scripts add `.github/agents/` and `.github/skills/`
3. **BYOK config** (optional) — Environment variables pointing Copilot CLI at your local Ollama instance

The forge-team-builder then generates specialist agents that automatically inherit EJS context from the repo-level Copilot instructions. Each session builds on the last.

### How It Works

Add the EJS recording contract to your project's `.github/copilot-instructions.md` so all agents — including generated specialists — record their work:

```markdown
## EJS Recording Contract

- Record interactions, decisions, and sub-agent work to the session journey file
- Query `.ejs.db` before reading raw markdown files for past context
- Attribute every entry by agent name
- Capture incrementally — do not wait until session end
```

> [!TIP]
> With EJS + Agent Forge + BYOK, you get a fully local, context-aware agent team that remembers past decisions — no cloud dependency required.

---

## Template Structure

```
mcfuzzy-agent-forge/
├── templates/
│   ├── agents/
│   │   ├── project-orchestrator.md     # Coordinates agents through PRD phases
│   │   └── forge-team-builder.md       # PRD → agent team generator
│   └── skills/
│       ├── forge-build-agent-team/
│       │   └── SKILL.md                # Process for building agent teams
│       ├── forge-build-feature-prd/
│       │   └── SKILL.md                # Process for building Feature PRDs
│       └── forge-build-prd/
│           └── SKILL.md                # Process for building PRDs
├── scripts/
│   ├── bootstrap.sh                    # Bash bootstrap script
│   └── bootstrap.ps1                   # PowerShell bootstrap script
├── README.md
└── LICENSE
```

### Agent Format

Agents are defined in `.md` files with YAML frontmatter:

```markdown
---
name: agent-name
description: >
  Brief description of when to use this agent
---

You are a **Role Title** responsible for [scope].

## Expertise
- Specialization 1
- Specialization 2

## Responsibilities
...
```

### Skill Format

Skills are reusable process templates in `SKILL.md` files:

```markdown
---
name: skill-name
description: >
  What this skill does and when to use it
---

# Skill: Human-Readable Title

## Process

### Step 1: ...
### Step 2: ...
```

---

## Examples

### Example: Web Application Team

For a Next.js + FastAPI web application, the team builder might generate:

| Agent | Role | Owns |
|-------|------|------|
| `project-orchestrator` | Project Manager | Coordinates all agents through PRD phases |
| `project-architect` | Scaffolding & Config | Project structure, build tools, dependencies |
| `nextjs-specialist` | Frontend Framework | Next.js setup, routing, SSR/SSG, App Router |
| `react-specialist` | UI Components | React components, hooks, state management |
| `api-engineer` | Backend | FastAPI endpoints, data models, middleware |
| `database-specialist` | Data Layer | Schema, migrations, queries, ORM |
| `auth-engineer` | Authentication | Login flows, JWT, sessions, RBAC |
| `qa-tester` | Testing | Test framework, unit/integration tests |

### Example: CLI Tool Team

For a Node.js CLI tool, the team might be smaller:

| Agent | Role | Owns |
|-------|------|------|
| `project-orchestrator` | Project Manager | Coordinates all agents through PRD phases |
| `project-architect` | Scaffolding | Package.json, TypeScript config, build |
| `cli-engineer` | CLI Framework | Argument parsing, command structure, help |
| `core-logic-engineer` | Business Logic | Core algorithms, data processing |
| `qa-tester` | Testing | Unit tests, integration tests, fixtures |

---

## Best Practices

### For PRD Creation

- Be specific about your tech stack and architecture decisions
- **Specify current versions** — The PRD builder verifies tech stack currency and flags outdated choices
- Include non-functional requirements (performance, security, accessibility)
- Define clear implementation phases
- Document cross-cutting concerns (logging, monitoring, deployment)

### For Agent Teams

- **Keep agents specialized** — Each agent should be the undisputed expert in their area
- **Define clear boundaries** — No file should be owned by multiple agents
- **Map all requirements** — Every PRD requirement should map to exactly one agent
- **Scale appropriately** — Small projects need 3-4 agents; large projects may need 8-12
- **Don't over-skill** — Only create skills for processes that repeat multiple times
- **Use current APIs** — Generated agents include constraints to verify they use current stable APIs and best practices

### For Collaboration

Agents should reference each other in their collaboration sections:
- **Dependencies** — Which agents they need input from
- **Handoffs** — Where their work ends and another's begins
- **Coordination** — What needs to be synchronized

---

## Customization

You can modify the templates before or after bootstrapping:

1. **Edit template agents/skills** in `templates/` before running bootstrap
2. **Modify generated agents** in your project's `.github/agents/` after bootstrap
3. **Add your own agents** by creating new `.md` files following the format
4. **Create project-specific skills** for repeated patterns in your codebase

> [!NOTE]
> GitHub Copilot automatically detects changes to agent and skill files — no restart required.

---

## Troubleshooting

### Bootstrap script permission denied (Bash)

Make the script executable:
```bash
chmod +x scripts/bootstrap.sh
```

### Agents not appearing in Copilot

Ensure:
1. Files are committed to your repository
2. Files are in `.github/agents/*.md` and `.github/skills/*/SKILL.md`
3. YAML frontmatter is valid (check for syntax errors)
4. Agent names match filenames (e.g., `my-agent.md` → `name: my-agent`)

### Team builder creates too many/few agents

The team size is driven by your PRD:
- More detailed PRDs with distinct functional domains → more agents
- Simpler PRDs with fewer subsystems → fewer agents
- Adjust PRD scope and re-run the team builder

### Agents have overlapping responsibilities

This indicates unclear boundaries in the PRD. Clarify:
- Which files/components belong to which feature area
- Whether a concern is cross-cutting (needs its own agent) or belongs to an existing domain
- Re-run the team builder with the updated PRD

---

## FAQ

**Q: Do I need to use all the templates?**  
A: No. You can bootstrap only what you need, or use this as inspiration to create your own agents.

**Q: Can I use this without creating a PRD first?**  
A: Yes. You can manually create agents for your project, or bootstrap the templates and use them as examples.

**Q: What if my project already has custom agents?**  
A: The bootstrap script prompts before overwriting. You can merge manually or use `--force` to overwrite.

**Q: Can I modify the generated agents?**  
A: Absolutely. The generated agents are starting points — customize them for your project's specifics.

**Q: Does this work for non-web projects?**  
A: Yes. The framework is project-agnostic. The team builder adapts to your PRD whether it's web, mobile, CLI, embedded, etc.

**Q: How do I update agents when my PRD changes?**  
A: For minor PRD updates, re-run the team builder — it will regenerate agents based on the new PRD. Review diffs before committing. For adding entirely new features to a completed project, use the `forge-build-feature-prd` skill to create a Feature PRD, then run the team builder in Feature Increment Mode. See [Add Features to an Existing Project](#5-add-features-to-an-existing-project).

**Q: Can I resume work on a different machine?**  
A: Yes. The orchestrator maintains `docs/PROGRESS.md` tracking all completed tasks. Commit and push your changes, then use `@project-orchestrator Resume from last checkpoint` on any machine with the repository cloned.

**Q: Can I run this with a local model instead of GitHub-hosted models?**  
A: Yes. Copilot CLI supports [BYOK (Bring Your Own Key)](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models) with any OpenAI-compatible endpoint, including Ollama. See [Running with Local Models](#running-with-local-models-byok).

**Q: What is EJS and do I need it?**  
A: The [Engineering Journey System](https://github.com/McFuzzySquirrel/Engineering-Journey-System) adds persistent memory across sessions. It's optional but recommended — without it, agents have no awareness of past decisions. See [Persistent Project Memory with EJS](#persistent-project-memory-with-ejs).

**Q: How does the framework ensure agents use current information?**  
A: The PRD builder verifies tech stack currency during PRD creation. The orchestrator validates stack versions before Phase 1. All generated agents include constraints to verify they use current stable APIs and best practices for their tech stack.

---

## Resources

- [GitHub Copilot Custom Agents Documentation](https://docs.github.com/en/copilot/customizing-copilot/creating-custom-agents)
- [GitHub Copilot Skills Documentation](https://docs.github.com/en/copilot/customizing-copilot/creating-copilot-skills)
- [YAML Frontmatter Specification](https://jekyllrb.com/docs/front-matter/)

---

## Support

If you encounter issues or have questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review the [FAQ](#faq)
3. [Open an issue](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/issues) on GitHub

For general discussion about custom agents, join the GitHub Copilot community discussions.

---

**Made with ❤️ by [McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
