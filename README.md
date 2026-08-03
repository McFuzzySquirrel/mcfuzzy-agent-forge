# McFuzzy Agent Forge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Bash](https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=fff)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?logo=powershell&logoColor=fff)

> Bootstrap a custom agent team from your PRD - in minutes. Works with any agent harness that reads agents and skills from a repo.

**McFuzzy Agent Forge** turns your requirements document into a coordinated team of specialist agents. Each agent owns a specific domain, understands its dependencies, and works in sequence so nothing gets missed.

[Getting Started](#getting-started) • [How It Works](#how-it-works) • [Usage](#usage) • [Prompt Playbook](docs/prompt-playbook.md) • [Local Models](docs/running-with-local-models.md) • [FAQ](#faq) • [Recent Updates](#recent-updates)

---

## Recent Updates

**August 2026 - v3.1** - Full auto build, end-to-end pipeline in one command.

- **`forge-auto-build` meta-skill.** One command takes you from a one-liner idea (or an existing PRD) all the way to a fully built, validated, and committed project. A single pre-flight gate, then fully autonomous: PRD → agent team → optional model assignment → all build phases, with validation checks and a commit after every phase.
- **ADR-009.** Documents the design rationale for `forge-auto-build` and how it complements `forge-bootstrap-project`.

**August 2026 - v3** - Skill-Forge integration, framework-agnostic skill creation.

- **Skill-Forge integration.** Three new skills from [skill-forge](https://github.com/McFuzzySquirrel/skill-forge): `skill-creator` (guided creation workflow), `skill-review` (automated six-axis audit with CI/CD tooling), and `skill-review-updater` (keeps the rubric current with agentskills.io).
- **Robust skill creation phase.** `forge-build-agent-team` now invokes `skill-creator` for each project-specific skill, running a structured interview → scaffold → `skill-review` validation loop to ensure every generated skill scores ≥2.0 before agents use it.
- **CI/CD skill quality gates.** `skill-review` ships portable TypeScript tooling with providers for GitHub Actions, GitLab CI, and Azure DevOps - post audit comments directly on PRs.
- **Removed Microsoft Agent Framework skill.** `forge-build-agent-framework-solution` was too platform-specific. The forge is framework-agnostic; agent framework scaffolding belongs in project-specific skills created by `skill-creator`.

**June 2026 - v2** - Harness-agnostic, leaner skills, built-in best practices.

- **`.agents/` migration.** Forge is no longer GitHub-only. Default bootstrap targets `.agents/` - works with any harness. Use `--harness github` or `--harness claude` for specific runtimes.
- **Progressive disclosure.** All forge skills now use `references/` directories. `SKILL.md` files are 30–68% smaller - reference content loads only when needed.
- **Gotchas + Validation.** Every forge skill and generated skill includes `## Gotchas` (prevent common mistakes) and `## Validation` (self-check before showing work to the user).
- **`forge-optimize-skills`.** Skill that audits generated skills against a 6-axis best-practices rubric and produces actionable improvement suggestions.
- See **[docs/research/forge-optimization-value.md](docs/research/forge-optimization-value.md)** for the full before/after breakdown with measured efficiency gains.

---

## How It Works

Choose the approach that fits your project:

| | Approach | Best for |
|---|---|---|
| **A** | **Monolithic PRD** → agent team → build | Small-to-medium projects |
| **B** | **PRD** → decompose into features → agent team → build feature by feature | Larger projects or incremental delivery |

Both approaches use the same core toolkit:

| What | Role |
|---|---|
| `forge-auto-build` skill | Full end-to-end meta-skill: idea → PRD → agent team → optional model assignment → full build execution, with validation + commit after every phase. One pre-flight gate, then fully autonomous. |
| `forge-bootstrap-project` skill | One-shot meta-skill that chains `forge-build-prd` → review → `forge-build-agent-team` → review → optional `forge-assign-models`, preserving the review pauses |
| `forge-build-prd` skill | Interviews you and creates a comprehensive PRD |
| `forge-decompose-prd` skill | Splits a monolithic PRD into a Product Vision + Feature documents |
| `forge-build-feature-prd` skill | Creates a Feature PRD to add a new feature to an existing project |
| `forge-team-builder` agent | Reads a PRD or feature set and generates the full specialist agent team |
| `skill-creator` skill | Guides creation of a new skill through a structured five-step workflow: interview → template selection → scaffold → pre-flight check → `skill-review` validation |
| `skill-review` skill | Audits skills against [agentskills.io best practices](https://agentskills.io/skill-creation/best-practices) using a six-axis rubric; includes portable TypeScript tooling for CI/CD integration (GitHub, GitLab, Azure DevOps) |
| `skill-review-updater` skill | Checks agentskills.io for best-practice updates and produces a prioritized plan for keeping the `skill-review` rubric current |
| `forge-assign-models` skill | Discovers available models (cloud + local Ollama) and recommends/applies a per-agent model so lightweight agents do not default to the most expensive model |
| `forge-optimize-skills` skill | Audits existing skills against [agentskills.io best practices](https://agentskills.io/skill-creation/best-practices) in a manual agent-driven workflow; delegates to `skill-review` tooling when available |
| `project-orchestrator` agent | Coordinates agents through implementation phases, phase by phase |
| `forge-orchestrate-build` skill | Contains the detailed execution process used by `project-orchestrator` (analysis, phase execution, coordination, output formatting) |
| Bootstrap scripts | Copy all templates into any target repository with one command |

---

## Getting Started

### Prerequisites

- An agent harness — any runtime that detects agents and skills from a repo directory (e.g. GitHub Copilot, Claude Code, or a custom harness)
- Git + Bash (Linux/macOS) or PowerShell 5.1+ (Windows)
- [Ollama](https://ollama.com/) (optional - for [local model support](docs/running-with-local-models.md))

### 1. Clone Agent Forge

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge
```

### 2. Bootstrap into your project

**Bash:**
```bash
./scripts/bootstrap.sh /path/to/your/project
```

For GitHub Copilot or Claude Code:
```bash
./scripts/bootstrap.sh /path/to/your/project --harness github
./scripts/bootstrap.sh /path/to/your/project --harness claude
```

**PowerShell:**
```powershell
.\scripts\bootstrap.ps1 -Target C:\path\to\your\project
.\scripts\bootstrap.ps1 -Target C:\path\to\your\project -Harness github
```

This copies agent and skill templates into your target project under the chosen harness directory (default: `.agents/`). Use `--force` / `-Force` to skip overwrite prompts.

### 3. Commit and open your project

```bash
cd /path/to/your/project
git add .agents/
git commit -m "chore: bootstrap Agent Forge templates"
```

Open the project in your agent harness - agents and skills are auto-detected from `.agents/agents/` and `.agents/skills/`.

### 4. (Optional) Full auto build — idea to committed code in one command

```
@workspace /forge-auto-build I want to build [your idea]
```

Review the pre-flight summary, type `GO`, and the entire pipeline runs autonomously: PRD generation, agent team creation, all build phases, validation, and a commit after each phase. See [Full Auto Build](docs/prompt-playbook.md#full-auto-build---one-command-entire-pipeline-optional) for options.

### 5. Build your PRD (step-by-step alternative)

```
@workspace /forge-build-prd Create a PRD for [your idea]
```

The skill interviews you for requirements and saves a complete PRD to `docs/PRD.md`.

### 6. Generate your agent team

```
@workspace /forge-team-builder Analyze docs/PRD.md and generate the agent team
```

Agent files (`.agent.md`) appear in `.agents/agents/`. Each specialist owns a clear domain with no overlaps.

### 7. Execute the build

```
@workspace @project-orchestrator Analyze docs/PRD.md and produce an execution plan
```

Review the plan, then run one phase at a time:
```
@workspace @project-orchestrator Execute Phase 1 only. Stop and report when done.
```

> [!TIP]
> The orchestrator writes `docs/PROGRESS.md` after each phase. Use `Resume from last checkpoint` to pick up where you left off.

> [!TIP]
> See [docs/prompt-playbook.md](docs/prompt-playbook.md) for the full copy-paste prompt sequence, including feature additions, decomposition, and resume flows.

---

## Usage

### Bootstrap options

```bash
# Interactive - prompts for target path
./scripts/bootstrap.sh

# With target path (default: .agents/)
./scripts/bootstrap.sh ../my-project

# Target a specific harness
./scripts/bootstrap.sh ../my-project --harness github
./scripts/bootstrap.sh ../my-project --harness claude

# Force overwrite without prompting
./scripts/bootstrap.sh ../my-project --force
```

```powershell
.\scripts\bootstrap.ps1 -Target ..\my-project -Force
.\scripts\bootstrap.ps1 -Target ..\my-project -Harness github
```

### Add a feature to an existing project

After the initial build, add features without touching unaffected agents:

**1. Create a Feature PRD:**
```
@workspace /forge-build-feature-prd Add a real-time notification system to the project
```

**2. Extend the agent team (only affected agents change):**
```
@workspace /forge-team-builder Analyze docs/features/notifications.md and update the team
```

**3. Execute the feature phases:**
```
@workspace @project-orchestrator Execute feature docs/features/notifications.md - Phase F1 only
```

> [!TIP]
> Feature PRDs use `FT-` prefixed IDs and `F-` prefixed phases to avoid collision with the original PRD. Tracing is clean.

### Decompose a large PRD into features

```
@workspace /forge-decompose-prd Break docs/PRD.md into a product vision and feature documents
```

Produces `docs/product-vision.md` (architecture, NFRs, cross-cutting concerns) and `docs/features/*.md` (one per feature, self-contained). The team builder and orchestrator both support this layout automatically.

---

## Creating and Optimizing Skills

### Creating New Skills with `skill-creator`

When `forge-build-agent-team` identifies skills to create, use `skill-creator` for each one to ensure quality from the start:

```
@workspace /skill-creator I need a skill that creates a database migration from a schema diff
```

The skill runs a structured five-step workflow: interview → template selection → scaffold → pre-flight check → `skill-review` validation. Skills produced this way score ≥2.0 across all six quality axes before any agent uses them.

### Auditing Skills with `skill-review`

After building a project, audit all skills for quality using the automated tooling:

```bash
cd .agents/skills/skill-review && npm install
npm run skill-review -- --provider stdout --min-score 1.5
```

For CI/CD integration, `skill-review` supports GitHub Actions, GitLab CI, and Azure DevOps:

```bash
npm run skill-review -- --provider github --min-score 2.0 --fail-below
```

Or use the agent-driven audit via `forge-optimize-skills`:

```
@workspace /forge-optimize-skills Audit all skills in .agents/skills/ against best practices.
Score each skill and produce docs/SKILL-AUDIT.md.
```

Both approaches score each skill on six axes: context economy, gotchas coverage, procedural clarity, progressive disclosure, calibration, and validation. They produce specific, actionable suggestions - add a gotcha for an edge case, move a large template to `references/`, add a validation loop, trim verbose generic content.

After reviewing the report, apply approved improvements:

```
@workspace /forge-optimize-skills Apply the approved changes from docs/SKILL-AUDIT.md.
```

### Keeping `skill-review` Current

As agentskills.io evolves, use `skill-review-updater` to keep the rubric up to date:

```
@workspace /skill-review-updater Check for updates in agentskills.io and produce an update plan
```

---

## Running with Local Models (BYOK)

Many agent harnesses support OpenAI-compatible endpoints. Point yours at [Ollama](https://ollama.com/) to run fully local with no cloud dependency.

See the full guide - recommended models, GPU setup, reliability benchmarking, and overheating prevention:
**[docs/running-with-local-models.md](docs/running-with-local-models.md)**

---

## Model Assignment per Agent

By default every agent runs against whatever model the user has globally selected. That means a lightweight docs-writer and a heavy architect both consume the same - usually most-expensive - model.

The optional `forge-assign-models` skill fixes that. It:

1. **Discovers** which models you actually have access to - local Ollama (via the
   `/api/tags` endpoint) plus the models exposed by your agent harness subscription or BYOK
   provider.
2. **Classifies** each generated agent's workload (reasoning depth, context size,
   tool-use, latency sensitivity, safety) on a small explicit rubric.
3. **Recommends** a primary + fallback model per agent and writes a reviewable
   `docs/MODEL-PLAN.md`.
4. **Applies** the recommendation (only on explicit confirmation) by adding `model:` and
   `modelFallback:` to each agent's YAML frontmatter.
5. **Re-tunes** after team changes - only re-evaluates agents whose role changed.

```
@workspace /forge-assign-models Discover what models are available.
@workspace /forge-assign-models Recommend a per-agent model and write docs/MODEL-PLAN.md.
@workspace /forge-assign-models Apply the recommended models to the agent files.
```

> [!NOTE]
> The `model:` frontmatter field is honored by harnesses that support per-agent model selection (e.g. VS Code custom agents). In other harnesses, per-agent model assignment is advisory — the active model is process-wide. Check your harness documentation for details.

---

## Persistent Memory with EJS

The [Engineering Journey System (EJS)](https://github.com/McFuzzySquirrel/Engineering-Journey-System) adds session memory to your agent team. Without it, agents start fresh every conversation with no awareness of past decisions. With it, they query a local SQLite database of past ADRs, learnings, and architectural choices.

EJS is optional but recommended. Bootstrap it before Agent Forge for a new project, then add the EJS recording contract to your harness instructions file (e.g. `.github/copilot-instructions.md`, `.agents/instructions.md`, or `.claude/CLAUDE.md` depending on your harness):

```markdown
## EJS Recording Contract
- Record decisions and sub-agent work to the session journey file
- Query `.ejs.db` before reading raw markdown for past context
- Attribute every entry by agent name
```

> [!TIP]
> With EJS + Agent Forge + BYOK, you get a fully local, context-aware agent team that remembers past decisions - no cloud dependency required.

---

## Template Structure

```
mcfuzzy-agent-forge/
├── .agents/
│   └── skills/
│       └── create-readme/SKILL.md      # Forge's own README generation skill
├── templates/
│   ├── agents/
│   │   ├── project-orchestrator.md     # Coordinates agents through PRD phases or features
│   │   └── forge-team-builder.md       # PRD → agent team generator
│   └── skills/
│       ├── forge-auto-build/SKILL.md         # Meta-skill: idea → PRD → team → full build (autonomous, one gate)
│       ├── forge-build-agent-team/SKILL.md   # Process for building agent teams
│       │   └── references/                   # Vision+Features and Feature Increment mode docs
│       ├── forge-build-feature-prd/SKILL.md  # Process for building Feature PRDs
│       │   └── references/                   # Feature PRD template
│       ├── forge-build-prd/SKILL.md          # Process for building PRDs
│       │   └── references/                   # PRD output format template
│       ├── forge-bootstrap-project/SKILL.md  # Meta-skill: idea → PRD → review → team → review → optional model assignment
│       ├── forge-decompose-prd/SKILL.md      # Process for decomposing PRDs into features
│       │   └── references/                   # Product Vision and Feature Document templates
│       ├── forge-assign-models/SKILL.md      # Process for per-agent model selection (cloud + local Ollama)
│       │   └── references/                   # Model inventory schema and tier catalog
│       ├── forge-orchestrate-build/SKILL.md  # Execution process used by project-orchestrator
│       │   └── references/                   # Output format templates
│       ├── forge-optimize-skills/SKILL.md    # Audit existing skills (agent-driven; delegates to skill-review when available)
│       ├── skill-creator/SKILL.md            # Guided skill creation: interview → scaffold → skill-review validation
│       │   └── references/                   # Flat/modular templates, interview questions, quality axes, pre-flight checklist
│       ├── skill-review/SKILL.md             # Six-axis skill audit with CI/CD tooling (GitHub, GitLab, Azure DevOps)
│       │   └── scripts/                      # TypeScript audit engine (rubric.ts, detect.ts, providers/)
│       └── skill-review-updater/SKILL.md     # Keep skill-review rubric aligned with latest agentskills.io guidance
│           └── references/                   # Quality baseline, rubric mapping, validation checks
├── scripts/
│   ├── bootstrap.sh                    # Bash bootstrap script
│   └── bootstrap.ps1                   # PowerShell bootstrap script
└── docs/
    ├── prompt-playbook.md              # Full copy-paste prompt sequence
    └── running-with-local-models.md    # BYOK / Ollama setup guide
```

Agents use YAML frontmatter followed by a plain Markdown body. Skills follow the [agentskills.io specification](https://agentskills.io/specification): a directory containing `SKILL.md` with optional `references/`, `scripts/`, and `assets/` subdirectories for progressive disclosure.

---

## Troubleshooting

**Bootstrap script: permission denied**
```bash
chmod +x scripts/bootstrap.sh
```

**Agents not appearing in the harness**
- Files must be committed (not just saved)
- Verify paths match your harness: `.agents/agents/*.agent.md` (default), `.github/agents/*.agent.md` (GitHub Copilot), or `.claude/agents/*.agent.md` (Claude Code)
- Agent files end with `.agent.md` and use valid YAML frontmatter; `name:` must match the filename (without extension)
- Skill directory name must match the skill `name` field

**Team builder creates too many or too few agents**
Team size is driven by the PRD. More distinct functional domains → more agents. Tighten or broaden the PRD scope and re-run.

**Agents have overlapping responsibilities**
Overlaps mean PRD boundaries are unclear. Clarify which files/components belong to which domain, then re-run the team builder.

**Bootstrapped to the wrong harness**
Re-run bootstrap with the correct `--harness` flag. The old directory won't be cleaned up automatically - remove it manually if switching harnesses.

---

## FAQ

**Can I go from idea to built project without doing anything manually?**
Yes — use `forge-auto-build`. One pre-flight gate, then fully autonomous: PRD → agent team → all build phases, with validation and a commit after every phase. See [Full Auto Build](docs/prompt-playbook.md#full-auto-build---one-command-entire-pipeline-optional).

**Do I need to use all the templates?**
No - use only what you need, or treat them as examples.

**Can I use this without a PRD?**
Yes. Bootstrap the templates and write agent files manually following the format.

**My project already has custom agents. Will bootstrap overwrite them?**
It prompts before overwriting. Use `--force` only if you want to replace everything.

**Does this work for non-web projects?**
Yes - CLI tools, mobile apps, embedded systems, data pipelines. The team builder adapts to whatever stack your PRD describes.

**Which harness should I choose?**
Use `--harness agents` (default, `.agents/`) for maximum portability. Use `--harness github` or `--harness claude` if your primary harness requires a specific detection directory.

**Does this work in terminal-based harnesses?**
Yes. Use the default `.agents/` layout for maximum portability. For harness-specific detection directories, bootstrap with `--harness github` (GitHub Copilot) or `--harness claude` (Claude Code). See [Running with Local Models](docs/running-with-local-models.md) for BYOK setup.

**When should I decompose my PRD into features?**
When your PRD has 15+ functional requirements or 3+ phases, or when you want to prioritize and ship features independently.

**Can I resume work across sessions or machines?**
Yes. The orchestrator writes `docs/PROGRESS.md` after each phase. Use `@project-orchestrator Resume from last checkpoint` on any machine with the repo cloned.

**How do I update agents when my PRD changes?**
Re-run `@workspace /forge-team-builder` for minor changes. For new features on a completed project, use `forge-build-feature-prd` first, then run the team builder in Feature Increment Mode.

**How do I improve my generated skills?**
Use `skill-creator` during team building to produce quality skills from the start, then run `skill-review` for automated scoring with CI/CD integration. For a manual agent-driven audit, use `forge-optimize-skills`.

---

## Resources

- [Prompt Playbook](docs/prompt-playbook.md) - Full copy-paste prompt sequence for every workflow
- [Running with Local Models](docs/running-with-local-models.md) - BYOK / Ollama setup and model recommendations
- [Optimization Value](docs/research/forge-optimization-value.md) - Before/after breakdown of the v2 efficiency gains
- [agentskills.io Specification](https://agentskills.io/specification) - Agent Skills format specification
- [agentskills.io Best Practices](https://agentskills.io/skill-creation/best-practices) - Skill design patterns and guidelines
- [Skill-Forge](https://github.com/McFuzzySquirrel/skill-forge) - Source repository for `skill-creator`, `skill-review`, and `skill-review-updater`

---

## Support

1. Check [Troubleshooting](#troubleshooting) and [FAQ](#faq)
2. [Open an issue](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/issues) on GitHub

---

**Made with ❤️ by [McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
