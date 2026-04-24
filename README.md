# McFuzzy Agent Forge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Bash](https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=fff)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?logo=powershell&logoColor=fff)

> Bootstrap a custom GitHub Copilot agent team from your PRD — in minutes. Works in VS Code and Copilot CLI.

**McFuzzy Agent Forge** turns your requirements document into a coordinated team of GitHub Copilot specialist agents. Each agent owns a specific domain, understands its dependencies, and works in sequence so nothing gets missed.

[Getting Started](#getting-started) • [How It Works](#how-it-works) • [Usage](#usage) • [Prompt Playbook](docs/prompt-playbook.md) • [Local Models](docs/running-with-local-models.md) • [FAQ](#faq)

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
| `forge-build-prd` skill | Interviews you and creates a comprehensive PRD |
| `forge-decompose-prd` skill | Splits a monolithic PRD into a Product Vision + Feature documents |
| `forge-build-feature-prd` skill | Creates a Feature PRD to add a new feature to an existing project |
| `forge-team-builder` agent | Reads a PRD or feature set and generates the full specialist agent team |
| `forge-assign-models` skill | Discovers available models (cloud + local Ollama) and recommends/applies a per-agent model so lightweight agents do not default to the most expensive model |
| `project-orchestrator` agent | Coordinates agents through implementation phases, phase by phase |
| Bootstrap scripts | Copy all templates into any target repository with one command |

---

## Getting Started

### Prerequisites

- GitHub Copilot active in **VS Code** or [**Copilot CLI**](https://docs.github.com/en/copilot/copilot-cli) (terminal)
- Git + Bash (Linux/macOS) or PowerShell 5.1+ (Windows)
- [Ollama](https://ollama.com/) (optional — for [local model support](docs/running-with-local-models.md))

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

**PowerShell:**
```powershell
.\scripts\bootstrap.ps1 -Target C:\path\to\your\project
```

This copies agent and skill templates into `.github/agents/` and `.github/skills/` in your target project. Use `--force` / `-Force` to skip overwrite prompts.

### 3. Commit and open your project

```bash
cd /path/to/your/project
git add .github/
git commit -m "chore: bootstrap Agent Forge templates"
```

Open the project in VS Code or navigate to it in your terminal with Copilot CLI — Copilot will auto-detect the agents immediately in both environments.

### 4. Build your PRD

In Copilot Chat (VS Code) or Copilot CLI (terminal):
```
@workspace /forge-build-prd Create a PRD for [your idea]
```

> [!NOTE]
> The prompts in this guide use `@workspace` syntax (VS Code). In Copilot CLI, the same agents and skills are available — just use the agent or skill name directly (e.g., `/forge-build-prd Create a PRD for [your idea]`).

The skill interviews you for requirements and saves a complete PRD to `docs/PRD.md`.

### 5. Generate your agent team

```
@workspace /forge-team-builder Analyze docs/PRD.md and generate the agent team
```

Agent files appear in `.github/agents/`. Each specialist owns a clear domain with no overlaps.

### 6. Execute the build

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
# Interactive — prompts for target path
./scripts/bootstrap.sh

# With target path
./scripts/bootstrap.sh ../my-project

# Force overwrite without prompting
./scripts/bootstrap.sh ../my-project --force
```

```powershell
.\scripts\bootstrap.ps1 -Target ..\my-project -Force
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
@workspace @project-orchestrator Execute feature docs/features/notifications.md — Phase F1 only
```

> [!TIP]
> Feature PRDs use `FT-` prefixed IDs and `F-` prefixed phases to avoid collision with the original PRD. Tracing is clean.

### Decompose a large PRD into features

```
@workspace /forge-decompose-prd Break docs/PRD.md into a product vision and feature documents
```

Produces `docs/product-vision.md` (architecture, NFRs, cross-cutting concerns) and `docs/features/*.md` (one per feature, self-contained). The team builder and orchestrator both support this layout automatically.

---

## Running with Local Models (BYOK)

Copilot CLI supports any OpenAI-compatible endpoint. Point it at [Ollama](https://ollama.com/) to run fully local with no cloud dependency.

See the full guide — recommended models, GPU setup, reliability benchmarking, and overheating prevention:
**[docs/running-with-local-models.md](docs/running-with-local-models.md)**

---

## Model Assignment per Agent

By default every agent runs against whatever model the user has globally selected (the
VS Code model picker, or `COPILOT_MODEL` for Copilot CLI). That means a lightweight
docs-writer and a heavy architect both consume the same — usually most-expensive — model.

The optional `forge-assign-models` skill fixes that. It:

1. **Discovers** which models you actually have access to — local Ollama (via the
   `/api/tags` endpoint) plus the models exposed by your Copilot subscription or BYOK
   provider.
2. **Classifies** each generated agent's workload (reasoning depth, context size,
   tool-use, latency sensitivity, safety) on a small explicit rubric.
3. **Recommends** a primary + fallback model per agent and writes a reviewable
   `docs/MODEL-PLAN.md`.
4. **Applies** the recommendation (only on explicit confirmation) by adding `model:` and
   `modelFallback:` to each agent's YAML frontmatter.
5. **Re-tunes** after team changes — only re-evaluates agents whose role changed.

```
@workspace /forge-assign-models Discover what models are available.
@workspace /forge-assign-models Recommend a per-agent model and write docs/MODEL-PLAN.md.
@workspace /forge-assign-models Apply the recommended models to the agent files.
```

> [!NOTE]
> The `model:` frontmatter field is honored by VS Code custom agents. Copilot CLI BYOK
> currently uses a single global model (`COPILOT_MODEL`) per session, so on the CLI the
> assignments are advisory — Apply mode can optionally emit small launch wrappers under
> `.github/agents/_model-launch.{sh,ps1}` that set the right `COPILOT_MODEL` before
> invoking `copilot`.

---

## Persistent Memory with EJS

The [Engineering Journey System (EJS)](https://github.com/McFuzzySquirrel/Engineering-Journey-System) adds session memory to your agent team. Without it, agents start fresh every conversation with no awareness of past decisions. With it, they query a local SQLite database of past ADRs, learnings, and architectural choices.

EJS is optional but recommended. Bootstrap it before Agent Forge for a new project, then add the EJS recording contract to `.github/copilot-instructions.md`:

```markdown
## EJS Recording Contract
- Record decisions and sub-agent work to the session journey file
- Query `.ejs.db` before reading raw markdown for past context
- Attribute every entry by agent name
```

> [!TIP]
> With EJS + Agent Forge + BYOK, you get a fully local, context-aware agent team that remembers past decisions — no cloud dependency required.

---

## Template Structure

```
mcfuzzy-agent-forge/
├── templates/
│   ├── agents/
│   │   ├── project-orchestrator.md     # Coordinates agents through PRD phases or features
│   │   └── forge-team-builder.md       # PRD → agent team generator
│   └── skills/
│       ├── forge-build-agent-team/SKILL.md   # Process for building agent teams
│       ├── forge-build-feature-prd/SKILL.md  # Process for building Feature PRDs
│       ├── forge-build-prd/SKILL.md          # Process for building PRDs
│       ├── forge-decompose-prd/SKILL.md      # Process for decomposing PRDs into features
│       └── forge-assign-models/SKILL.md      # Process for per-agent model selection (cloud + local Ollama)
├── scripts/
│   ├── bootstrap.sh                    # Bash bootstrap script
│   └── bootstrap.ps1                   # PowerShell bootstrap script
└── docs/
    ├── prompt-playbook.md              # Full copy-paste prompt sequence
    └── running-with-local-models.md    # BYOK / Ollama setup guide
```

Agents use YAML frontmatter followed by a plain Markdown body. Skills follow the same format with a `SKILL.md` filename convention. Copilot auto-detects both.

---

## Troubleshooting

**Bootstrap script: permission denied**
```bash
chmod +x scripts/bootstrap.sh
```

**Agents not appearing in Copilot**
- Files must be committed (not just saved)
- Paths: `.github/agents/*.md` and `.github/skills/*/SKILL.md`
- YAML frontmatter must be valid
- Agent `name:` must match the filename (e.g., `my-agent.md` → `name: my-agent`)

**Team builder creates too many or too few agents**
Team size is driven by the PRD. More distinct functional domains → more agents. Tighten or broaden the PRD scope and re-run.

**Agents have overlapping responsibilities**
Overlaps mean PRD boundaries are unclear. Clarify which files/components belong to which domain, then re-run the team builder.

---

## FAQ

**Do I need to use all the templates?**
No — use only what you need, or treat them as examples.

**Can I use this without a PRD?**
Yes. Bootstrap the templates and write agent files manually following the format.

**My project already has custom agents. Will bootstrap overwrite them?**
It prompts before overwriting. Use `--force` only if you want to replace everything.

**Does this work for non-web projects?**
Yes — CLI tools, mobile apps, embedded systems, data pipelines. The team builder adapts to whatever stack your PRD describes.

**Does this work in Copilot CLI (terminal)?**
Yes — and it works very well. Copilot CLI picks up `.github/agents/` and `.github/skills/` from your repo automatically. The full Agent Forge workflow (PRD building, team generation, orchestrated execution) runs in both VS Code and Copilot CLI. See [Running with Local Models](docs/running-with-local-models.md) for BYOK setup in the CLI.

**When should I decompose my PRD into features?**
When your PRD has 15+ functional requirements or 3+ phases, or when you want to prioritize and ship features independently.

**Can I resume work across sessions or machines?**
Yes. The orchestrator writes `docs/PROGRESS.md` after each phase. Use `@project-orchestrator Resume from last checkpoint` on any machine with the repo cloned.

**How do I update agents when my PRD changes?**
Re-run `@workspace /forge-team-builder` for minor changes. For new features on a completed project, use `forge-build-feature-prd` first, then run the team builder in Feature Increment Mode.

---

## Resources

- [Prompt Playbook](docs/prompt-playbook.md) — Full copy-paste prompt sequence for every workflow
- [Running with Local Models](docs/running-with-local-models.md) — BYOK / Ollama setup and model recommendations
- [GitHub Copilot Custom Agents Documentation](https://docs.github.com/en/copilot/customizing-copilot/creating-custom-agents)
- [GitHub Copilot Skills Documentation](https://docs.github.com/en/copilot/customizing-copilot/creating-copilot-skills)

---

## Support

1. Check [Troubleshooting](#troubleshooting) and [FAQ](#faq)
2. [Open an issue](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/issues) on GitHub

---

**Made with ❤️ by [McFuzzySquirrel](https://github.com/McFuzzySquirrel)**

