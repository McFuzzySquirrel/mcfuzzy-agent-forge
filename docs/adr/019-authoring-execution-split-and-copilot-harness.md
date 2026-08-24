# ADR-019: Authoring/Execution Split, Detached Engine, and GitHub Copilot Harness

**Date:** 2026-08-24
**Status:** Accepted

---

## Context

ADR-014 introduced the `forge-workflow-engine` as a harness-driven alternative to
the prompt-driven `forge-orchestrate-build`. Two gaps surfaced in practice:

1. **The engine ran *inside* the CLI session.** The engine path was exercised by
   typing `GO --workflow-engine` in an interactive chat (`opencode .`, `claude .`,
   or the GitHub Copilot CLI), after which `forge-auto-build` Stage 3 Path B ran
   `npm run workflow-engine -- run` as a *blocking child of that session*. Even the
   headless launcher (`opencode run --auto "/forge-auto-build … GO --workflow-engine"`)
   nested the engine inside a one-shot skill run. The result was
   `CLI → skill → engine → opencode run per task`: the engine's lifetime was tied
   to the session, the session blocked for the whole build, and the build died with
   the chat.

2. **`npm install` ("node module bootstrap") happened in-session, implicitly.** The
   engine and execution adapter are Node packages. `bootstrap.sh` only *copies* the
   skill directories (package.json + lockfile); the actual `npm install` ran at build
   time inside `forge-auto-build` Path B. Nothing gitignored the resulting
   `node_modules/`, so the skill's final `git add .` could commit it.

The engine itself was already fully headless-capable: its pre-run gate auto-skips on
non-TTY and honors `--yes`/`FORGE_ENGINE_YES=1`, and its adapters shell out to
`opencode run --auto` (or an API/stub/kernel backend) per task. It is a standalone,
file-backed, resumable process. The invocation model, not the engine, was the problem.

---

## Decision

### 1. Authoring and execution are split

- **Authoring stays in the chat:** PRD → agent team → optional models → compile the
  execution manifest (`forge-execution-adapter compile`).
- **Execution runs detached, outside the CLI:** the engine is started as its own
  process (second terminal, CI, or `nohup`), never as a blocking child of a chat.

### 2. `forge-auto-build` engine path starts the engine detached and polls

`forge-auto-build` Stage 3 Path B becomes **prep + handoff**:

- Step 3a (unchanged): `npm install` for the adapter, then compile the manifest.
- Step 3b: install the engine, then start it **detached**:
  `nohup npm run workflow-engine -- run --harness "$FORGE_ENGINE_HARNESS" --yes >> docs/engine-run.log 2>&1 &`
- Step 3c: poll `docs/WORKFLOW-STATE.json` until `status` is `complete` or `failed`
  (check every ~30s), surfacing log tails and `replay <task-id>` guidance on failure.

Because the engine is detached, it survives the session and resumes with `run`.

### 3. New standalone runner: `scripts/forge-engine-run.sh` / `.ps1`

A first-class "outside the CLI" entry point: resolves the repo, `npm install`s the
adapter and engine, compiles the manifest if missing, then runs
`npm run workflow-engine -- run --harness <h> --yes` as the foreground process - for
a second terminal, CI, or a `nohup` wrapper of your own. Supports `--dry-run`.

### 4. GitHub Copilot is a first-class per-task harness

New `CopilotAdapter` (`--harness copilot`): shells out to
`copilot -p "<agent context + task prompt>" --yolo` per task, mirroring the
OpenCode adapter. `copilot -p` has no `--system-prompt` flag, so the agent file
contents are inlined into the prompt. Env vars: `COPILOT_BIN`, `COPILOT_EXTRA_FLAGS`.
The per-task harness is selected by `FORGE_ENGINE_HARNESS` (default `opencode`).

### 5. Engine dependencies are bootstrapped explicitly and never committed

- `bootstrap.sh` / `bootstrap.ps1` now ensure the target repo's `.gitignore` excludes
  `node_modules/` and `docs/engine-run.log`.
- `forge-auto-build`'s final commit skips `**/node_modules/**` and
  `docs/engine-run.log` as a belt-and-braces guard.
- Documentation states the engine requires `node >= 18` + npm at *build time*; the
  install happens at engine-prep time, not at bootstrap-copy time.

---

## Rationale

- **One orchestrator, one process.** The engine already drives every task through a
  harness adapter; running it inside a chat created redundant nesting
  (`CLI → skill → engine → CLI`) and coupled build lifetime to session lifetime.
  Detaching it makes dark orchestration genuinely dark: a resumable process that
  outlives the terminal.
- **Chats are for planning, not for babysitting long-running DAGs.** Keeping
  execution outside the session lets the same `opencode run --auto` /
  `copilot -p --yolo` headless primitives drive both the skill pipeline and the
  engine's per-task dispatch.
- **Explicit > implicit for side effects.** Committing a build's dependency install
  into the user's repo from inside a skill run was an unintended side effect; the
  decision makes the Node dependency an explicit, gitignored, documented concern.

---

## Consequences

### Positive

- The build no longer dies with the chat session and no longer blocks it.
- The same engine can be run interactively, headlessly, in CI, or detached -one code
  path, four launch modes.
- Copilot-harness projects can drive per-task execution with `copilot -p --yolo`,
  matching the opencode adapter's `--auto`.
- `node_modules/` and engine logs are never committed to target repos.

### Negative

- The `forge-auto-build` engine path now runs the engine in the background; users
  must read `docs/engine-run.log` / `docs/PROGRESS.md` (or the poll summary) instead
  of watching live terminal output from the skill.
- Two ways to launch the engine (skill handoff vs. `forge-engine-run.sh`) add a small
  conceptual surface; the runner is intentionally thin to keep them equivalent.

### Neutral

- Existing prompt-driven and OpenAI/Stub/FlowForge-kernel paths are unchanged.
- `bootstrap.sh` behavior is unchanged except for the added `.gitignore` hygiene.

---

## References

- ADR-014: Dynamic Workflow Orchestration via `forge-workflow-engine` - the engine this ADR makes detached.
- ADR-011: Forge Execution Adapter - produces the manifest the engine consumes.
- Skill: [`forge-auto-build`](../../templates/skills/forge-auto-build/SKILL.md)
- Skill: [`forge-workflow-engine`](../../templates/skills/forge-workflow-engine/SKILL.md)
- Implementation: [`copilot-adapter.ts`](../../templates/skills/forge-workflow-engine/scripts/harness/copilot-adapter.ts)
- Scripts: [forge-engine-run.sh](../../scripts/forge-engine-run.sh), [forge-engine-run.ps1](../../scripts/forge-engine-run.ps1)
