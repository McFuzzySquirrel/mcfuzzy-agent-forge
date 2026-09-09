# Scoping: an explicit authoring runner selector for the Console and launcher

**Date:** 2026-09-07
**Status:** Implemented on this branch (ADR-048)
**Trigger:** a maintainer reported that model discovery "only looks for Claude" after the
`claude` authoring runner landed (ADR-043). Root cause: the runner is derived from the harness
root, the Console's inventory is per runner, and the Console has no way to choose a runner. The
hotfix (`fix/claude-authoring-runner-default`) restored OpenCode as the default for Claude
repos. This document scopes the proper fix: the runner becomes an explicit, persisted choice.
**Companion:** [`claude-authoring-runner.md`](./claude-authoring-runner.md) for the runner itself.
File and line references are against `main` at `70e0b38` plus the hotfix.

## Problem

Three facts, verified by reading the code:

1. The authoring runner has exactly two sources: `FORGE_RUN_WITH` in the environment, else a
   rule on the harness root (`headlessRunner`, `launcher.ts:515-524`; `selectedAuthoringRunner`,
   `console/authoring.ts:6-13`; `runnerForHarness` in `views/new.ts:136` and
   `views/documents.ts:230`). Nothing persists a choice per project.
2. The Console's inventory endpoint returns only the chosen runner's models
   (`consoleAuthoringInventory`, `console/authoring.ts:19-38`), so whichever runner the rule
   picks decides which models a user can see and select for every stage.
3. When the Console creates a project it spawns a detached `forge-launcher --non-interactive`
   with `--prd-model`, `--team-model`, `--skills-model` flags and `FORGE_HARNESS_CHOICE`
   (`console/control.ts:305-352`), but passes **no runner at all**. The child inherits whatever
   `FORGE_RUN_WITH` the Console server process happened to start with, almost always unset.

So a user who wants the Claude runner on a Claude repo, or OpenCode's inventory on a GitHub
repo, has to set an environment variable before starting the Console, and the wizard's model
dropdowns cannot follow that choice.

## Design

Treat the runner exactly the way per-stage models are already treated (ADR-039): an optional
project setting in `docs/authoring-config.json`, with the same precedence ladder and the same
`inherit` escape.

### Persistence

`AuthoringConfig` gains one optional field:

```ts
export interface AuthoringConfig { version: 1; models: AuthoringModels; runner?: AuthoringRunnerChoice }
export type AuthoringRunnerChoice = "copilot" | "opencode" | "claude";
```

`version` stays `1`: the field is optional and older readers ignore it. `validateAuthoringConfig`
(`authoring-config.ts:17-31`) must accept it, reject anything but the three values, treat the
literal `"inherit"` as "omit", and **include it in the object it returns** at line 30, which
today rebuilds `{ version, models }` and would silently drop the key. `stub` is not a valid
persisted choice: it is a test-only offline runner, selected by `FORGE_RUN_WITH=stub` as now.

### Precedence

Mirror `selectAuthoringModel` (`authoring-config.ts:56-72`) with a new
`selectAuthoringRunner(repo, env, requested?)` returning `{ runner, source }` where source is
`invocation | environment | project | inherit`:

1. `requested`: an explicit per-call value (the Console's `?runner=` query and refresh body, the
   CLI's `--runner` flag).
2. `env.FORGE_RUN_WITH`: unchanged meaning, and the only place `stub` can come from.
3. `loadAuthoringConfig(repo).runner`: the persisted project choice.
4. `inherit`: the harness rule, `authoringRunnerForHarness(harness)`.

`headlessRunner()` and `selectedAuthoringRunner()` both become thin callers of it. Recording
`source` lets `docs/authoring-state.json`'s invocation provenance say where the runner came
from, alongside the model's source it already records.

### Reaching the spawned launcher

`LauncherOptions` gains `runner?: AuthoringRunnerChoice`, set by a new `--runner` flag on the
main `forge-launcher` invocation (today only the `authoring-models` subcommand has one,
`cli.ts:94-100`). In non-interactive create the launcher already merges `state.options.models`
into the saved config (`launcher.ts:2501-2505`); it merges `runner` the same way, so the choice
made in the wizard is persisted in the new repo and honoured by every later stage.
`RunController.createProject` (`control.ts:329-332`) appends `--runner <choice>` beside the
model flags when the request carries one.

`authoring-config --runner <copilot|opencode|claude|inherit>` is added to the settings CLI for
parity with `--prd-model`.

### Console

Both authoring surfaces get one `<select>` labelled "Authoring runner" with options
`Inherit from harness`, `OpenCode`, `Copilot`, `Claude Code`, placed above the three stage
selects. The `modelTerminalPanel` select (`documents.ts:368`) is the existing pattern.

- **New Project wizard** (`views/new.ts`, `buildAuthoringControls` at `:123-187`): the select
  feeds `load()` instead of `runnerForHarness(harness.value)`; `inherit` resolves to the harness
  rule client-side so the dropdowns show the right inventory before the project exists. A
  `change` listener on the runner select calls `load(false)`, as the harness select already
  does. `getConfig()` (`:182-185`) includes `runner` when not inherit, and the value joins the
  draft cache keys at `:84-88` so it survives navigation. The client `AuthoringConfig` type
  (`dashboard/types.ts:228-231`) gains the field.
- **Project authoring settings** (`views/documents.ts`, `buildAuthoringSettings` at `:163-287`):
  the select is initialised from the loaded config's `runner` (or inherit), Save posts it inside
  the same body, Refresh uses the select's effective value instead of
  `inventory.runner ?? runnerForHarness(...)` at `:230`, and changing the select reloads the
  inventory so the stage dropdowns follow. Stage retry buttons need no change: they go through
  `headlessRunner`, which now reads the persisted value.
- The server needs no new endpoint: `POST /api/authoring-config` already takes the raw config
  (`server.ts:399-408`) and `validateAuthoringConfig` gates it; `GET /api/authoring-inventory`
  with no `runner` query resolves through `selectedAuthoringRunner`, which now consults the
  persisted value.

### What does not change

- The engine harness axis (`engineHarnessForHarness`, `inferEngineHarness`,
  `defaultEngineHarness`) and the interactive CLI mapping. The runner selector is authoring only.
- Stage fingerprints (`stageInputFingerprint`, `authoring-state.ts:103-108`) do not include
  the runner, just as they do not include the per-stage models. Changing the runner after a
  stage completed does not mark it stale; the invocation provenance records what ran. Same
  contract as models, stated in the ADR so nobody expects otherwise.
- `FORGE_RUN_WITH` keeps its meaning and its priority over the project setting.

## Approaches considered

**A. Persist in `docs/authoring-config.json` (recommended).** One file, one validator, one
precedence ladder, symmetric with models, reaches headless runs and the CLI. Cost: about 40
lines in `authoring-config.ts`, 20 in `launcher.ts` and `cli.ts`, 10 in `control.ts`, 60 across
the two views, tests, docs, and ADR-048.

**B. Console-only, unpersisted.** A select that only steers the inventory calls and the
refresh. Cheap, but stage retries and headless runs would still use the harness rule, so the
dropdowns could show models the runner will never use. Rejected.

**C. Store the runner in `docs/engine-config.json`.** Wrong axis; that file is the execution
harness's. Rejected.

## Wiring checklist

- [ ] `authoring-config.ts`: type, validator (accept, reject, `inherit`, return), `selectAuthoringRunner`
- [ ] `launcher.ts`: `headlessRunner` via `selectAuthoringRunner`; `LauncherOptions.runner`; merge on create; provenance `source`
- [ ] `cli.ts`: `--runner` on the main invocation and on `authoring-config`
- [ ] `console/authoring.ts`: `selectedAuthoringRunner` via `selectAuthoringRunner`
- [ ] `console/control.ts`: pass `--runner` on create
- [ ] `console/dashboard/types.ts`, `views/new.ts`, `views/documents.ts`
- [ ] Tests: validator accept/reject/inherit round-trip; runner precedence (invocation, env, project, inherit) mirroring `authoring.test.ts:70-78`; headless draft honours the persisted runner; create-project passes `--runner` (mirror `console-authoring.test.ts:191-207`); wizard and settings-panel behaviour through the API seams
- [ ] Docs: `docs/forge-launcher.md` schema example at `:183-190`, precedence at `:196-198`, CLI flags at `:118-121` and `:212-224`, `FORGE_RUN_WITH` prose at `:318-329` and table at `:884`; `docs/forge-console-user-guide.md:166-178`; `docs/forge-console.md:135` (stale, still omits `claude`); `docs/updates.md`
- [ ] ADR-048, superseding the "default from harness" sentence of ADR-043

## Open questions

1. **Wizard default when the harness is Claude.** After the hotfix, inherit means OpenCode. Should
   the wizard preselect Claude Code when the Claude harness is chosen, or leave inherit and let
   the user opt in? Recommendation: leave inherit, so the wizard and headless behaviour agree.
2. **Should `FORGE_RUN_WITH` outrank the project setting?** It does for models (environment beats
   project). Keeping that symmetry means a persisted `claude` can be overridden per shell,
   which is what an environment variable is for. Recommendation: keep symmetry.
3. **Provenance.** Record `runnerSource` in `docs/authoring-state.json` invocation entries, or
   only the runner name as today? Recommendation: add it; it is one field and it answers "why
   did this run use OpenCode" without reading three files.
