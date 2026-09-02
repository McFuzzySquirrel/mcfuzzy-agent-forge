
# MyForge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Bash](https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=fff)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?logo=powershell&logoColor=fff)

> MyForge turns an idea into a reviewed PRD, a specialist agent team, and an autonomous build.

**Latest: v3.40** — see [docs/updates.md](docs/updates.md) for release notes.

MyForge is a PRD-first workflow for turning product requirements into working software. It combines structured planning, agent-based implementation, and execution orchestration in one path so a project can move from concept to build without losing the review checkpoints that matter.

## Highlights

- Keeps the PRD as the quality gate before implementation begins.
- Generates a specialist agent team from the PRD instead of relying on a single generic assistant.
- Supports both guided, interactive execution and unattended "dark orchestration" runs.
- Includes a local web console for monitoring and controlling builds.



https://github.com/user-attachments/assets/f03d855f-4f97-4544-95f2-f14625f42e94



## Quick start

### Prerequisites

- Node.js 18+
- Git
- A compatible agent harness such as GitHub Copilot, Claude Code, or opencode

### Option 1: Run from a clone

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge
./scripts/forge-launcher.sh
```

This is the simplest manual path if you want to use the repository directly.

### Option 2: Install the npm package from source

The npm package is not published yet, but you can install it locally from this repository:

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge/scripts/forge-launcher
npm install
npm pack
npm install -g ./forge-launcher-1.0.0-beta.3.tgz
```

Once installed, run:

```bash
forge-launcher
```

The launcher walks you through repo bootstrap, idea capture, PRD drafting, team generation, and build execution.

For the manual prompting flow and the CLI’s expected prompts, see [docs/prompt-playbook.md](docs/prompt-playbook.md). For the latest changes and release notes, see [docs/updates.md](docs/updates.md).

> [!NOTE]
> The canonical launcher runtime lives in [scripts/forge-launcher](scripts/forge-launcher). The shell wrappers are compatibility shims for existing workflows.

## How it works

1. Capture your idea and review the PRD.
2. Generate the agent team and any model plan.
3. Run the build interactively or unattended.

## Main components

- `forge-launcher` - the entry point for onboarding, authoring, and launching builds
- `forge-workflow-engine` - the execution engine for orchestration, checkpoints, replay, and state
- `forge-execution-adapter` and `forge-workforce-compiler` - the adapters and packaging layer that compile manifests and hand off work
- Forge Console - a local web UI for authoring, monitoring, and controlling runs

## Documentation

- [docs/forge-launcher.md](docs/forge-launcher.md)
- [docs/forge-console.md](docs/forge-console.md)
- [docs/forge-console-user-guide.md](docs/forge-console-user-guide.md)
- [docs/workflow-engine.md](docs/workflow-engine.md)
- [docs/prompt-playbook.md](docs/prompt-playbook.md)
- [docs/updates.md](docs/updates.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

## Development

```bash
cd scripts/forge-launcher
npm install
npm test
npm run typecheck
```
