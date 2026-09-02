# forge-launcher

One command from zero to auto-build. `forge-launcher` is the cross-platform
Node.js entry point for [MyForge](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge) -
it creates a repo, bootstraps the agent/skill templates, captures your idea, and
drives the pipeline from PRD → agent team → autonomous build.

> Requires **Node.js 18+**.

## Install

```bash
npm install -g forge-launcher
# or, without a global install:
npx forge-launcher
```

## Quick start

```bash
forge-launcher            # interactive: create a repo, bootstrap templates, capture your idea
```

Answer the prompts, then open the generated repo in your agent harness and run
the queued command it prints.

## Commands

| Command | What it does |
|---|---|
| `forge-launcher` | Interactive onboarding: repo → bootstrap → idea → queue the next stage. |
| `forge-launcher --draft` | Same, but auto-draft the PRD and agent team (keeps review boundaries). |
| `forge-launcher --headless` | Drive the queued skill from the terminal via `opencode run --auto` / `copilot -p --yolo`. |
| `forge-launcher bootstrap <dir> [--harness agents\|github\|claude\|opencode]` | Copy agent/skill templates into an existing project. |
| `forge-launcher engine-run [--repo <path>] [--harness <h>] …` | Compile the manifest and run the workflow engine (autonomous build). |
| `forge-launcher resume [--repo <path>]` | Pick up a paused/finished setup where it left off. |
| `forge-launcher console [--repo <path>]` | Local web UI (`http://127.0.0.1:4300`) for authoring, build monitoring, and run controls. |
| `forge-launcher draft-prd \| draft-team [--repo <path>]` | Headless authoring stages (idea → PRD, PRD → agent team). |
| `forge-launcher compile-manifest [--repo <path>]` | Headless build-prep stage: install the adapter if needed and write `docs/EXECUTION-MANIFEST.json` without starting the engine. |

### Autonomous build

```bash
forge-launcher engine-run --harness opencode --yes                 # per-task: opencode run
forge-launcher engine-run --harness copilot --yes                  # per-task: copilot -p --yolo
forge-launcher engine-run --harness opencode --concurrency 3 --yes # parallel dispatch
forge-launcher engine-run --harness opencode --keep-alive --yes    # one warm server, no per-task cold boot
forge-launcher engine-run --harness opencode --task-timeout-ms 900000 --yes  # 15-min task budget
forge-launcher engine-run --harness opencode --viz --yes           # live Forge Board dashboard
forge-launcher engine-run --stop    # stop a detached run after the current task
forge-launcher engine-run --pause   # pause a detached run after the current task
```

Run `forge-launcher engine-run --help` for every option (granularity,
concurrency, timeout, retries, heartbeat, keep-alive/attach, viz).

## Harnesses

MyForge works with any harness that reads agents and skills from a repo:
GitHub Copilot (`.github/agents/`), Claude Code (`.claude/agents/`), opencode
(`.opencode/agents/`), or a generic `.agents/` directory. The build itself runs
through a harness adapter - `opencode`, `copilot`, `openai`, or `stub` (dry-run
without spending tokens).

## Docs

- [Full project README](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge#readme)
- [Launcher reference](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/blob/main/docs/forge-launcher.md)
- [Forge Console](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/blob/main/docs/forge-console.md)
- [Workflow engine](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/blob/main/docs/workflow-engine.md)

## License

[MIT](https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/blob/main/LICENSE)
