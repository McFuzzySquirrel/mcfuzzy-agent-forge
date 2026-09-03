# Testing guide

This guide captures the current testing workflow for MyForge. It is intentionally focused on the commands and entry points that exist in the repository today.

## 1. Fastest validation path

For day-to-day verification, run the launcher package tests and type checks from the package directory:

```bash
cd scripts/forge-launcher
npm install
npm test
npm run typecheck
```

These commands cover the current launcher implementation, including bootstrap, draft flow, resume flow, engine-run forwarding, and the console path.

## 2. What the automated suite covers

The current package-level test suite exercises the main launcher behaviors:

- bootstrap behavior and path rewriting,
- launcher flow generation and dry-run behavior,
- engine-run argument handling and persistence,
- resume flow behavior,
- console entry-point behavior.

The package also has a dedicated smoke-test script for terminal-launch support under [scripts/smoke-test-launcher-terminal-support.sh](../scripts/smoke-test-launcher-terminal-support.sh).

## 3. Manual smoke test for a full local run

Use this flow when you want to verify the whole experience end to end.

### Prerequisites

- Node.js 18+
- Git
- A compatible harness such as GitHub Copilot, Claude Code, or opencode

### Step 1: Install the launcher from source

```bash
git clone https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge.git
cd mcfuzzy-agent-forge/scripts/forge-launcher
npm install
npm pack
npm install -g ./forge-launcher-1.0.0-beta.4.tgz
```

### Step 2: Create a fresh project

```bash
mkdir -p /tmp/myforge-smoke
cd /tmp/myforge-smoke
forge-launcher --non-interactive
```

Use environment variables if you want to drive the flow without interactive input:

```bash
export FORGE_HARNESS_CHOICE="2"
export FORGE_REPO_NAME="my-smoke-app"
export FORGE_REPO_PARENT_DIR="/tmp/myforge-smoke"
export FORGE_IDEA="A simple todo app"
export FORGE_YN_DEFAULT="y"
forge-launcher --non-interactive
```

### Step 3: Verify the bootstrapped repository

Confirm that the new project contains the expected structure:

```bash
ls my-smoke-app
```

You should see the harness bootstrap files, docs directory, and initial project files.

### Step 4: Try the console locally

From the generated repo or from anywhere with the installed launcher:

```bash
forge-launcher console --repo /tmp/myforge-smoke/my-smoke-app --no-open
```

This checks that the console can start and serve the local web UI.

## 4. Engine-run smoke test

For a lightweight engine check, run the launcher in dry-run or stub mode where possible:

```bash
forge-launcher engine-run --repo /tmp/myforge-smoke/my-smoke-app --harness stub --yes --dry-run
```

This verifies that the engine-run path resolves the repo, selects the workflow engine package, and builds the command correctly without launching the full workflow.

## 5. Helpful checks when debugging

If a flow fails, confirm the following before digging deeper:

- the repo contains the expected harness folder such as `.agents/`, `.github/`, `.claude/`, or `.opencode/`,
- the launcher package is installed or built locally,
- the workflow-engine package exists under the chosen harness root,
- the repo has the expected docs files such as `docs/IDEA.md`, `docs/PRD.md`, or `docs/engine-run.log` depending on the stage reached.

## 6. Recommended validation checklist

Before shipping a change, verify:

- [ ] launcher tests pass,
- [ ] type checks pass,
- [ ] a fresh non-interactive bootstrap works,
- [ ] the console launches locally,
- [ ] any changed docs still match the actual CLI behavior.
