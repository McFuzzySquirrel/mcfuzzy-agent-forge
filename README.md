# McFuzzy Agent Forge

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Bash](https://img.shields.io/badge/Bash-4EAA25?logo=gnubash&logoColor=fff)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?logo=powershell&logoColor=fff)
![Forge Launcher](https://img.shields.io/badge/forge--launcher-interactive%20CLI-blueviolet)

> Turn a reviewed PRD into a coordinated team of specialist agents and an autonomous build - in minutes. Works with any agent harness that reads agents and skills from a repo.

**McFuzzy Agent Forge** turns your requirements into a team of specialist agents that plan, implement, and validate a project. The PRD is the quality gate: you deliberately review it, then the pipeline generates the team and drives the build - either interactively or fully autonomously ("dark orchestration").

**Latest: v3.25** - the launcher adds **"stop here and resume later" checkpoints** after every step (idea, PRD, team, execution plan, build), each printing the `forge-launcher resume --repo "<path>"` command, plus a **post-team plan & validate step** that runs project-orchestrator headlessly to produce the execution plan in `docs/PROGRESS.md` and pauses for review before the build. See [docs/updates.md](docs/updates.md). (v3.24: the Copilot harness selects forge agents natively via `/agent <name>`, mirroring opencode `--agent`; `FORGE_ENGINE_NATIVE_AGENT=0` forces the inline fallback. v3.23: the workflow engine's **output verification gate** stops hollow "complete" runs. v3.22: `forge-launcher` is the single terminal entry point with `resume`, OSC 8 review links, and a conditional in-harness command; `forge-auto-build` is the terminal/headless fast-path.)

---

## Quick Start (fastest path)

One command, zero to running - no PRD needed. The launcher creates your repo, bootstraps Agent Forge, captures your idea, and queues the right pipeline stage:

```bash
# Anywhere (npm package - requires Node.js 18+):
npx forge-launcher@beta          # v1.0.0-beta.2 pre-release (once published)

# Or from a clone (legacy shell wrappers, no install):
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge
./scripts/forge-launcher.sh          # PowerShell: .\scripts\forge-launcher.ps1
```

The npm package is currently a **pre-release** (`1.0.0-beta.2`). Until it is
published, install the packed tarball locally (below).

Answer the prompts, then open the repo in your agent harness and run the queued command it prints. Full reference: [docs/forge-launcher.md](docs/forge-launcher.md).

> The launcher is implemented as the cross-platform **`forge-launcher` npm package** (`scripts/forge-launcher/`). The `.sh` / `.ps1` scripts are thin delegating wrappers kept for compatibility (see [ADR-023](docs/adr/023-forge-launcher-npm-package.md)).

### Try the npm launcher locally (pre-publish)

`npx forge-launcher@beta` needs the package published to npm. Until then, install
it locally from your clone:

```bash
# 1. Install build deps + build the package (compiles dist/ + stages templates)
cd scripts/forge-launcher
npm install
npm pack                                   # → forge-launcher-1.0.0-beta.2.tgz

# 2. Install the tarball exactly like a published package (global `forge-launcher`)
npm install -g ./forge-launcher-1.0.0-beta.2.tgz
```

> **Stale install?** After `git pull`, always re-run `npm install` before
> `npm run build`/`npm pack` — new dependencies are added over time. If `npm run
> build` fails with *"Cannot find module 'cross-spawn' / 'semver' or its
> corresponding type declarations"*, your `node_modules` predates those
> dependencies. Fix it with a clean reinstall:
>
> ```powershell
> cd scripts/forge-launcher
> Remove-Item -Recurse -Force node_modules
> npm install          # or: npm ci   (deterministic install from the lockfile)
> npm run build
> ```

`forge-launcher` (or `npx forge-launcher`) now works from any directory.

**Developing (symlink instead of tarball).** Once `dist/` is built, link the
package globally so edits take effect after each rebuild:

```bash
cd scripts/forge-launcher
npm run build && npm link                 # global symlink → `forge-launcher`
```

**Remove the local install:**

```bash
npm uninstall -g forge-launcher            # removes a tarball install (or link)
cd scripts/forge-launcher && npm unlink    # drops the symlink created by `npm link`
```

> **Update check.** On startup, `forge-launcher` checks the npm registry once a
> day and prints a notice when a newer version is available. Disable it with
> `--no-update-check` or `FORGE_SKIP_UPDATE_CHECK=1` (also skipped in CI).

To also verify the exact end-user experience — a clean, unrelated workspace
where the launcher runs on its **bundled** templates — install into an isolated
prefix and run from a fresh directory:

```bash
# 1. Build the package (compiles dist/ + stages templates as resources)
cd scripts/forge-launcher
npm pack                                   # → forge-launcher-1.0.0-beta.2.tgz

# 2. Install it like `npm install -g forge-launcher@beta` would (isolated prefix)
npm install -g --prefix /tmp/forge-user/install ./forge-launcher-1.0.0-beta.2.tgz

# 3. Be the new user: run the TUI in a fresh, unrelated workspace
mkdir -p /tmp/forge-user/workspace
cd /tmp/forge-user/workspace
/tmp/forge-user/install/bin/forge-launcher  # answer the interactive prompts
```

Accept the defaults with Enter (harness, visibility, parent directory), type a
repo name and your idea, and you land in a bootstrapped repo:

```bash
ls my-todo-app/                      # .agents/, docs/, IDEA.md, README.md
git -C my-todo-app log --oneline     # chore: bootstrap agent forge
```

The whole suite can be checked without the TUI too:

```bash
cd scripts/forge-launcher
npm test          # node --test suite (launcher, resume, engine-run, bootstrap, prompts, format, …)
npm run typecheck
```

---

## Choose Your Path

**Start with `forge-launcher`.** It creates the repo, bootstraps Agent Forge,
captures your idea, and drafts the PRD + agent team (with a review boundary
between each). Once the team exists, make exactly one choice: **how to run the
build**.

| Build it… | Run this | What happens |
|---|---|---|
| **Interactively** (in your harness) | `@workspace @project-orchestrator Execute the full build` | Drives every phase with your approval between them |
| **Autonomously** (dark orchestration) | `forge-launcher engine-run --harness opencode --yes`, or `@workspace @workflow-orchestrator Run the workflow` | One pre-run gate, then the engine runs every task unattended (log: `docs/engine-run.log`) and resumes after interruption |

**Launcher variants** — same entry point, different levels of automation:

| You want… | Run this |
|---|---|
| Guided onboarding, zero setup | `forge-launcher` |
| Draft the PRD + team for you, keeping review boundaries | `forge-launcher --draft` |
| No chat session at all — full terminal/headless pipeline | `forge-launcher --headless` |
| Pick up where you left off (reviews take a while) | `forge-launcher resume` |

**Deliberate, manual steps** — the building blocks `forge-launcher` automates:

| You want… | Run this |
|---|---|
| Turn an idea into a reviewed `docs/PRD.md` | `@workspace /forge-auto-build-prd I want to build [idea]` |
| Generate or update the agent team | `@workspace /forge-build-agent-team …` |
| Add a feature to a finished project | `@workspace /forge-build-feature-prd I want to add [feature]` |
| Choose per-agent models | `@workspace /forge-assign-models …` |
| Watch a running build live (Forge Board) | `workflow-engine run --viz` |

> **`forge-auto-build` is the terminal/headless fast-path** the launcher drives
> (via `opencode run --auto`); it is not an in-harness slash command. It
> requires an existing PRD (`docs/PRD.md`, or the decomposed
> `docs/product-vision.md` + `docs/features/*.md`) and never generates one.

---

## How It Works

```
 forge-launcher (single entry)
      │
 Idea →  PRD  →  [auto-decompose]  →  Agent Team  →  [models]  →  Build
 │      └ forge-build-prd /            └ forge-build-       ├ @project-orchestrator
 │        forge-auto-build-prd           agent-team          │   (interactive, in-harness)
 │                                                            └ forge-workflow-engine
 │                                                               (@workflow-orchestrator /
 │                                                                forge-launcher engine-run)
```

1. **PRD (quality gate).** `forge-build-prd` interviews you, drafts `docs/PRD.md`, and runs a review checklist before you confirm it. **Decomposition is automatic**: a qualifying PRD (15+ functional requirements or 3+ implementation phases) is split into `docs/product-vision.md` + `docs/features/*.md` with no opt-in question. `forge-auto-build-prd` wraps this whole stage for a one-liner idea.
2. **Agent team.** `forge-build-agent-team` maps every requirement to a specialist agent, using `skill-creator` + `skill-review` so every generated skill meets a quality bar. It auto-detects Full Build, Vision + Features, and Feature Increment modes.
3. **Models (optional).** `forge-assign-models` matches each agent to an appropriately sized model so lightweight agents don't default to the most expensive one.
4. **Build.** Two execution modes over the same team: `@project-orchestrator` (interactive, per-phase approval, in the harness) or `forge-workflow-engine` (dark orchestration: one gate, then unattended through a harness adapter), started from the terminal with `forge-launcher engine-run`. `forge-auto-build` chains team generation → build as the terminal/headless fast-path the launcher drives.

Two principles govern the pipeline: **automate mechanical gates** (like decomposition), and **preserve human gates** (like the PRD review) - see [ADR-018](docs/adr/018-auto-prd-decomposition-and-build-prerequisite.md).

---

## Getting Started

### Prerequisites

- Node.js 18+ (for the `forge-launcher` npm package)
- An agent harness that reads agents/skills from a repo (GitHub Copilot, Claude Code, opencode, or any compatible runtime)
- `git`
- Optional: `gh` (GitHub harness), `opencode`/`claude` CLIs (auto-launch), [Ollama](https://ollama.com/) (local models)

### 1. Install the launcher

```bash
npx forge-launcher@beta        # npm package (requires Node.js 18+)
```

The npm package is a **pre-release** (`1.0.0-beta.2`). Until it's published,
install the packed tarball from a clone:

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge/scripts/forge-launcher
npm install && npm pack && npm install -g ./forge-launcher-1.0.0-beta.2.tgz
forge-launcher                 # the global command now works from anywhere
```

The legacy `./scripts/forge-launcher.sh` / `.\scripts\forge-launcher.ps1`
wrappers still work from a clone with no install, but the npm package is the
canonical cross-platform path.

For a **new project**, run `forge-launcher` and follow the prompts — it creates
the repo, bootstraps the Agent Forge templates into your harness directory
(default `.agents/`), captures your idea, and queues the next stage. Nothing
else to set up.

### 2. Add Agent Forge to an existing project

```bash
forge-launcher bootstrap /path/to/your/project --harness agents   # default
forge-launcher bootstrap /path/to/your/project --harness github   # GitHub Copilot
forge-launcher bootstrap /path/to/your/project --harness claude   # Claude Code
forge-launcher bootstrap /path/to/your/project --harness opencode # opencode
```

`bootstrap` copies the agent and skill templates into the project's harness
directory. Commit the templates, then open the project in your harness:

```bash
cd /path/to/your/project
git init && git add .agents/ && git commit -m "chore: bootstrap Agent Forge templates"
```

Then pick a path below.

### Path A - Full auto-build (requires a PRD)

The launcher is the recommended entry point - it creates the repo, bootstraps the
templates, captures the idea, and queues the right stage:

```bash
forge-launcher            # interactive; or --draft to auto-draft PRD + team
```

If you're already in a repo with a reviewed PRD, pick an execution mode:

```
@workspace @project-orchestrator Execute the full build     # interactive, per-phase
forge-launcher engine-run --harness opencode --yes           # autonomous (dark orchestration)
```

`forge-auto-build` remains available as the **terminal/headless fast-path**
(`forge-launcher --headless` or `opencode run --auto "/forge-auto-build … GO"`)
that chains team generation → build in one go, with a single pre-flight gate.

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
# Parallel dispatch (opt-in, harness-gated): run up to N ready tasks concurrently
npm run workflow-engine -- run --harness opencode --concurrency 3 --yes
# Keep-alive: attach tasks to one warm opencode server instead of cold-starting per task
npm run workflow-engine -- run --harness opencode --keep-alive --yes
# Live dashboard: watch the build as a kanban of agent name tags
npm run workflow-engine -- run --harness opencode --viz --yes
```

Or drive it conversationally via the companion agent:

```
@workspace @workflow-orchestrator Run the workflow
```

Dark orchestration means one pre-run gate, then unattended dispatch - no approvals between tasks. Resume with `run` after interruption; replay a failed task with `replay <task-id>`. Dry-run first with `--harness stub` to validate setup without spending tokens.

**Cut per-task startup overhead.** Every `opencode run` task normally cold-starts its own project instance (config, AGENTS.md, skills, and every MCP server) - on multi-task runs that adds up. Pass `--keep-alive` to boot one headless `opencode serve` for the run and attach every task to it (`--keep-alive-port <n>` pins the port); each task still gets a fresh, isolated session. If you already keep an `opencode serve` running, point tasks at it with `--attach <url>` (or the `FORGE_ENGINE_ATTACH` / `FORGE_ENGINE_ATTACH_URL` env vars) and skip the lifecycle management.

**Watch the build live (The Forge Board).** Add `--viz` to a run (or `forge-launcher engine-run --viz`) and a PixiJS dashboard opens in your browser at `http://127.0.0.1:4299`: the build renders as a **kanban board** - one band per phase stacked top-to-bottom, with tasks as **name-tag cards** flowing left-to-right through **To Do · In Progress · Done · Failed**. Each card carries a procedurally-drawn **agent face** (tinted per agent, reacting to status), the agent's name, and the task title; dependency and artifact edges connect the cards and brighten on hover, and artifact hand-offs animate as dots. Hover a card for a tooltip, click it for task detail (outputs, artifact, errors), drag to pan, scroll to zoom. The board auto-sizes its bands so cards never overlap. To watch a **detached** run instead, run `npm run workflow-engine -- viz --repo <repo-dir>` from any terminal - it tails the audit log and serves the same dashboard. Pass `--no-open` to skip auto-opening the browser.

### Path D - Fully terminal-driven (no chat session)

You never need to open an interactive CLI. Authoring (PRD → team → manifest) happens in a chat session; **execution runs detached**, outside it. The workflow engine is a standalone Node process that shells out to `opencode run` / `copilot -p` per task, and the launcher can drive the whole pipeline headlessly:

```bash
# Fastest: launcher does repo → bootstrap → idea → headless skill run
forge-launcher --headless

# Or auto-draft the PRD and/or agent team non-interactively, with review
# boundaries, then run the engine now (detached) or later:
forge-launcher --draft

# Or drive the queued skill directly:
opencode run --auto "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine"
copilot -p "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine" --yolo

# Once the manifest exists, run the engine itself as a standalone process
# (from a second terminal, CI, or nohup) - it never needs a chat session:
forge-launcher engine-run --harness opencode --yes          # per-task: opencode run
forge-launcher engine-run --harness copilot --yes           # per-task: copilot -p --yolo
forge-launcher engine-run --harness opencode --concurrency 3 --yes  # parallel dispatch
forge-launcher engine-run --harness opencode --keep-alive --yes      # one warm server, no per-task cold boot
forge-launcher engine-run --harness opencode --task-timeout-ms 900000 --yes  # 15-min task budget
forge-launcher engine-run --harness opencode --viz --yes    # live Forge Board dashboard
```

- `opencode run` / `copilot -p` are non-interactive; `--auto` / `--yolo` auto-approve tool permissions.
- The launcher's headless / auto-draft path drives `forge-auto-build` (the terminal fast-path) or `forge-auto-build-prd`, and `forge-launcher engine-run` starts the engine **detached** (log: `docs/engine-run.log`) - the build survives the session and resumes with `run` or `forge-launcher resume`.
- While a task runs, the engine prints a heartbeat line (`…still working on task <id> …`) so a quiet terminal doesn't look hung. Tune it with `--heartbeat-ms <ms>` or `FORGE_ENGINE_HEARTBEAT_MS` (default 15s; `0` disables).
- Each task runs under a per-task timeout (default 10 min). Raise it with `--task-timeout-ms <ms>` / `FORGE_ENGINE_TASK_TIMEOUT_MS`, or give a single heavy task its own budget via `timeoutMs` in `docs/EXECUTION-MANIFEST.json`. Compile with `--granularity fine` (default) to split tasks into smaller units.
- With no PRD yet, the launcher queues `forge-auto-build-prd` in headless mode (auto-proceeds with default assumptions recorded in the PRD's Open Questions, and runs the same PRD gap check the manual flow does - acceptance criteria, tech stack, NFRs, phases - filling gaps before approving).
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
│   ├── forge-launcher/           # npm package (Node/TS) - canonical implementation:
│   │   │                         #   forge-launcher | bootstrap | engine-run subcommands
│   ├── forge-launcher.sh/.ps1    # legacy delegating wrappers (repo → bootstrap → idea → queue;
│   │   │                         #   flags: --headless, --draft, --non-interactive, --dry-run)
│   ├── forge-engine-run.sh/.ps1  # legacy wrapper → `forge-launcher engine-run`
│   └── bootstrap.sh/.ps1         # legacy wrapper → `forge-launcher bootstrap`
└── docs/                        # prompt-playbook, forge-launcher, testing-guide, ADRs, updates
```

`bootstrap` copies every `templates/` package into your project's harness directory. Skills follow the [agentskills.io specification](https://agentskills.io/specification): a directory with `SKILL.md` plus optional `references/`, `scripts/`, and `assets/`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Bootstrap `permission denied` | Use `forge-launcher bootstrap` (Node, no execute bit needed); the legacy `scripts/bootstrap.sh` needs `chmod +x` |
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
