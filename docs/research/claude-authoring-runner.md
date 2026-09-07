# Scoping: a Claude Code authoring runner for the forge launcher

**Date:** 2026-09-07
**Status:** Implemented on this branch (ADR-043)
**Amended 2026-09-07:** the runner default for Claude repos was restored to `opencode`
after the Console's per-runner inventory hid OpenCode's models; see ADR-043.
**Branch:** `feat/claude-authoring-runner`, cut from `feat/claude-harness-adapter` at `53ef2b6`
**Companion:** [`claude-code-harness-adapter.md`](./claude-code-harness-adapter.md) covers the
execution side. This document covers the authoring side. Everything below was verified by
reading the repository or running the CLI; file and line references are against `53ef2b6`.

## Problem

The launcher has two independent axes that both name a CLI:

| Axis | Type | Where it lives | Values today | `claude`? |
|---|---|---|---|---|
| Execution harness (per task, driven by the workflow engine) | `string` | `docs/engine-config.json`, `FORGE_ENGINE_HARNESS` | `opencode`, `copilot`, `claude`, `openai`, `stub` | Yes, since ADR-042 |
| Authoring runner (PRD, team and skills stages, headless) | `AuthoringRunner` | `authoring-inventory.ts:6`, `FORGE_RUN_WITH` | `copilot`, `opencode`, `stub` | **No** |

A repository bootstrapped with `--harness claude` therefore authors with OpenCode. The selector
is `headlessRunner()` at `scripts/forge-launcher/scripts/launcher.ts:510-517`:

```ts
if (runner !== "copilot" && runner !== "opencode" && runner !== "stub") throw new Error(...);
return state.harness === "github" ? "copilot" : "opencode";
```

The console repeats the same two-way idiom in four places (`console/authoring.ts:7-8`,
`console/paths.ts:131`, `console/dashboard/views/new.ts:135`,
`console/dashboard/views/documents.ts:229`), so a Claude-harness console project also gets
OpenCode for inventory and authoring. The only place the launcher already builds a `claude`
command is the interactive hand-off (`launcher.ts:1671` and `:2277`, and
`console/server.ts:128-130`), which opens `claude .` for a human to drive. No headless
`claude -p` authoring invocation exists anywhere.

**Why this matters more than symmetry.** The authoring stages run forge skills as slash
commands: `headlessCmdFor` builds a message such as `/forge-auto-build-prd ...`
(`launcher.ts:505-507`) and `runSkillHeadless` first checks the skill exists under the
project's own harness root (`skillPathFor`, `launcher.ts:626-635`). For a `.claude` repo that
root is `.claude/skills/`. The two runners treat that message differently, verified 2026-09-07:

- **Claude Code** resolves `/forge-auto-build-prd ...` as a deterministic skill invocation in
  print mode. A probe skill under `.claude/skills/` whose body said "reply with exactly
  PROBE-OK-7731" returned exactly that in one turn, with and without trailing arguments.
- **OpenCode** discovers `.claude/skills/*/SKILL.md` as Claude-compatible skills, but exposes
  them through its `skill` tool, which the model calls on demand. Slash commands come only
  from `.opencode/commands/` or the OpenCode config. So `/forge-auto-build-prd ...` reaches
  the model as plain text and the model must decide to load the skill. This is how OpenCode
  works on its own `.opencode/skills/` root too, so today's fallback functions, but the
  invocation is model-mediated rather than native.

The runner native to the root the repo was scaffolded for is the one that should drive its
authoring, which is the same argument ADR-042 made for execution, with determinism added.

## What a runner has to provide

Read from `authoring-inventory.ts` and `launcher.ts`; every item is a concrete branch point.

| Concern | Copilot | OpenCode | Claude Code (proposed) |
|---|---|---|---|
| Headless argv (`authoringArgv`, `:173-177`) | `-p <msg> --yolo [--model m]` | `run --auto --dir <repo> [--model m] <msg>` | `-p <msg> --permission-mode bypassPermissions [--model m]` |
| Inventory probe (`refreshAuthoringInventory`, `:110-114`) | `copilot --help`, text-mined | `opencode models` | `claude -p "/model" --bare --output-format json`, see below |
| Inventory parser (`:117`) | `parseCopilotMetadataOutput` | `parseModelInventoryOutput` | new `parseClaudeModelOutput` |
| Provider key (`inventoryForRunner`, `:63`) | `copilot_cli`, `copilot_subscription` | `opencode_cli` | `claude_cli` |
| `effectiveModel` (`:166`) | provider prefix stripped | kept | stripped, as the execution adapter does |
| Requested-model matching (`:150-155`) | bare or `provider/` qualified | exact | bare alias, full ID, or `anthropic/` qualified |
| Debug flag (`launcher.ts:618`) | none | `--print-logs` | `--debug` (`claude --help` lists `-d, --debug [filter]`) |
| Default from harness (`headlessRunner`, `:516`) | `github` | everything else | `claude` |
| Console model-planning terminal (`console/server.ts:553-556`) | `-i <msg> --yolo` | `--prompt <msg>` | `<msg>` as the positional prompt, default permissions |

### The inventory surface

ADR-041 requires inventory discovery to use runner metadata only, never a generative call.
Claude Code has no `models` subcommand and `--help` lists only example aliases. It does,
however, execute built-in slash commands in print mode, and `/model` with no argument reports
the current model and the accepted names without calling the API:

```
$ claude -p "/model" --output-format json --model haiku
{"is_error":false,"result":"Current model: `Haiku 4.5`\nUsage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID.", ...}
```

Verified on v2.1.263, cost zero, single round trip. That is the same shape as
`copilot --help`: a deterministic list embedded in text, mined with a parser that accepts
unambiguous IDs only. Two consequences:

- `parseModelInventoryOutput` rejects bare aliases: its ID regex requires a digit, dot, slash
  or hyphen (`:79`), so `opus` would be dropped. Claude needs its own parser that takes the
  comma list after `Available:` and drops the meta-entries `default` and `best` (they
  resolve to a different model per account and are not stable choices). `opusplan`,
  the `[1m]` variants, and the plain aliases are all valid `--model` values and stay.
- The probe needs authentication. Not logged in yields `is_error: true` with
  `result: "Not logged in · Please run /login"` and exit 1, which the existing
  `result.code !== 0` check at `:112` already turns into a clear discovery error.

The probe passes `--bare`. Verified: `--bare` still executes the built-in `/model` command
(5 ms against 12 ms without it) while skipping hooks, plugin sync and auto-memory, which a
metadata probe has no use for. `--bare` must **not** be used for authoring: with it, a
project skill under `.claude/skills/` is reported as `Unknown command`.

Full model IDs (`claude-opus-5`, `claude-sonnet-5`) are accepted by `--model` but do not
appear in the `/model` list. `resolveAuthoringModel` fails closed on anything not in the
inventory (`:157-160`), so a user who asks for a pinned full ID is refused. Decided: the
inventory holds exactly what `/model` lists. Accepting an arbitrary `claude-*` string would
mean trusting a model the inventory cannot verify, which is the case ADR-041 exists to
prevent. A user who needs a pinned full ID sets it as the `model` in their Claude Code
settings and selects `inherit` for the stage, so the CLI's own default carries it.

### Output format for authoring

The execution adapter parses the JSON envelope because the engine needs a
`configuration`-versus-`retryable` classification. The authoring path does not: `runSkillHeadless`
streams the runner's output to the human through `runLoggedStep` and judges the outcome by
artefacts (new feature files, skill fingerprints, compiler outputs, `launcher.ts:637-641`),
with the stage state written as `failed` on a non-zero exit. Text output is therefore the right
default here, and it keeps the log readable. `--output-format json` is reserved for the
inventory probe, where the `is_error` flag is the whole point.

### Permissions

Headless authoring runs unattended, so `--permission-mode bypassPermissions` is the `--yolo`
analogue, exactly as in the execution adapter. The console's model-planning terminal is
interactive with a human present, so it should not bypass: `claude "<message>"` with the
default permission mode, matching the spirit of `copilot -i`.

## Approaches

**A. Full third runner (recommended).** Add `"claude"` to `AuthoringRunner` and every branch
point in the table above, plus the console defaults and the docs. Explicit per-stage models
work through the `/model` inventory. Cost: about 60 lines of runner code, 30 of console, and
the tests. This is the only approach that makes `--prd-model opus` work on a Claude repo.

**B. Headless-only first.** Accept `claude` in `headlessRunner` and `authoringArgv`, default
Claude repos to it, and leave inventory unimplemented so only `inherit` (no explicit model)
works. Smaller, but an explicit model silently fails closed with a confusing message, and
the console would still show OpenCode models for a Claude repo. Acceptable as a first commit
inside approach A, not as a stopping point.

**C. Keep OpenCode as the runner and document it.** Rejected: it leaves the native-root
argument unanswered and depends on the unverified assumption in open question 1.

## Adapter shape, by file

`scripts/forge-launcher/scripts/authoring-inventory.ts`:

- `:6` union gains `"claude"`.
- `:63` `inventoryForRunner`: `claude` maps to `["claude_cli"]`.
- `:110-117` `refreshAuthoringInventory`: probe args for `claude` are
  `["-p", "/model", "--bare", "--output-format", "json"]`; parse with `parseClaudeModelOutput(stdout)`,
  which JSON-parses the envelope, refuses `is_error`, and mines `result` for the `Available:`
  list. Keep the `${runner}_cli` provider write at `:126` unchanged.
- `:150-155` matching: add a `claudeQualified` test for `anthropic/<id>` and strip the prefix
  before comparing, mirroring `copilotQualified`.
- `:166` `effectiveModel`: strip the provider prefix for `claude` as well as `copilot`.
- `:173-177` `authoringArgv` becomes a three-way switch:
  `["-p", message, "--permission-mode", "bypassPermissions", ...model, ...extra]`.

`scripts/forge-launcher/scripts/launcher.ts`:

- `:513` validation and message accept `claude`.
- `:516` default: `state.harness === "github" ? "copilot" : state.harness === "claude" ? "claude" : "opencode"`.
- `:618` debug extras: `runner === "claude" ? ["--debug"] : ...`.
- `:2266-2277` `openCliFor`: no change needed for the authoring path (the model flag is
  already runner-agnostic), and the interactive fallback already knows `claude`.

`scripts/forge-launcher/scripts/cli.ts:94,103`: the local `--runner` union and validator gain
`claude`. Note this local type omits `stub`; leave that as is.

Console:

- `console/authoring.ts:7-13`: default `.claude` root to `claude`; validator accepts it.
- `console/paths.ts:131` `inferEngineHarness`: `.claude` root infers `claude`. This is the
  engine axis, not the runner, but it is the same two-way idiom and the same bug for Claude
  repos. Decided: fix it here, so one change owns every console default for Claude repos and
  the adapter PR stays frozen under review.
- `console/dashboard/views/new.ts:135` and `documents.ts:229`: same default rule.
- `console/dashboard/views/documents.ts:367,375` and `console/dashboard/api.ts:114`: third
  option `Claude Code` with value `claude`.
- `console/server.ts:553-556`: accept `claude`; args `[message]`.

Docs: `docs/forge-launcher.md` lines 121 (`--runner`), 264-324 (headless command shapes and
`FORGE_RUN_WITH`), 517-518 (auto-draft), 867 (`FORGE_RUN_WITH` table row), and the console
docs where the model-planning terminal is described. New ADR at 043.

## Known behavioral wrinkles

- **Nested sessions.** When the launcher itself runs inside a Claude Code session, the
  spawned `claude -p` inherits `CLAUDECODE`. Verified: `CLAUDECODE=1 claude -p "/model"
  --output-format json` completes with `is_error: false` on v2.1.263, so the runner needs no
  environment scrubbing beyond the `FORGE_HEADLESS` and `FORGE_HARNESS` it already sets
  (`launcher.ts:654`).
- **Ambient CLAUDE.md and hooks** load in the child exactly as they do for the execution
  adapter. Same decision: document, do not pass `--bare`, since the authoring skills live in
  `.claude/skills/` and `--bare` is documented to skip plugin sync and hooks.
- **`--fallback-model`.** The console's model plan carries a primary and a fallback per agent
  (`setModelOverride`, `console/dashboard/api.ts:111`). ADR-040's "metadata only" rule was
  stated for execution. Decided: the runner does not pass `--fallback-model`. Neither
  existing runner passes a fallback, the per-agent fallback in the model plan describes
  execution agents rather than authoring stages, and a silent fallback would make the
  `invocation.effectiveModel` recorded in `docs/authoring-state.json` (ADR-039) untrue.
- **Account-dependent inventory.** The `/model` list reflects the logged-in plan, so
  `docs/research/model-inventory.json` is per developer. That is already true for Copilot
  and OpenCode and is why the file carries `last_verified` and diagnostics.

## Test plan

All runner tests use injected probes and spawners rather than real binaries
(`authoring.test.ts:15,79-102`, `console-authoring.test.ts:56`, `console.test.ts:149,861-880`),
so no `claude` binary is needed in CI.

1. `parseClaudeModelOutput`: the verified envelope above yields
   `["sonnet","opus","haiku","fable","sonnet[1m]","opus[1m]","fable[1m]","opusplan"]`,
   with `default` and `best` dropped; `is_error: true` throws with the `result` text;
   non-JSON stdout throws.
2. `refreshAuthoringInventory(repo, "claude", probe)` calls the probe with
   `["-p","/model","--bare","--output-format","json"]` and writes a `claude_cli` section.
3. `resolveAuthoringModel` for `claude`: `opus` resolves to `opus`; `anthropic/claude-opus-5`
   resolves only if `claude-opus-5` is in the inventory, with the prefix stripped; an unknown
   model fails closed with the existing message.
4. `authoringArgv` for `claude` is
   `["-p", msg, "--permission-mode", "bypassPermissions", "--model", m, ...extra]`, and the
   conflicting `--model` guard still throws.
5. `headlessRunner`: harness `claude` defaults to `claude`; `FORGE_RUN_WITH=claude` is
   accepted; `FORGE_RUN_WITH=other` still throws and the message lists claude.
6. `cli.ts authoring-models --runner claude` is accepted.
7. Console: `selectedAuthoringRunner` defaults a `.claude` root to `claude`;
   `/api/model-plan/terminal` with `provider: "claude"` launches `claude` with `[message]`.
8. `launcher.test.ts`: the debug extras for `claude` are `["--debug"]`.

## Wiring checklist

- [ ] `authoring-inventory.ts` (union, providers, probe, parser, matching, `effectiveModel`, argv)
- [ ] `launcher.ts` (`headlessRunner`, debug extras)
- [ ] `cli.ts` (`--runner`)
- [ ] `console/authoring.ts`, `console/paths.ts`, `views/new.ts`, `views/documents.ts`, `dashboard/api.ts`, `server.ts`
- [ ] Tests listed above
- [ ] `docs/forge-launcher.md` and console docs
- [ ] ADR-043
- [ ] The launcher's `resources/templates/` copy needs nothing; it is regenerated at prepack

## Open questions, resolved 2026-09-07

1. **Does OpenCode resolve `/forge-*` skills from `.claude/skills/`?** Partly. OpenCode's
   documentation lists `.claude/skills/<name>/SKILL.md` as a Claude-compatible discovery
   path, loaded through its `skill` tool when the model chooses to; slash commands are only
   read from `.opencode/commands/`. Claude Code invokes the same skill deterministically from
   `-p`, verified with a probe skill. So today's fallback works by the model's discretion, and
   the change is about native, deterministic invocation plus model selection. Not a bug fix,
   but more than parity.
2. **Fallback models.** No `--fallback-model`. See the wrinkles section for the three reasons.
3. **Full model IDs.** Inventory holds only what `/model` lists. A pinned full ID goes in the
   user's Claude Code settings with the stage set to `inherit`. See the inventory section.
4. **Nested invocation.** Works; a print-mode call inside a Claude Code session succeeds.
   Nothing to clear.
5. **Console `inferEngineHarness`.** Fixed on this branch, so one change owns every console
   default for Claude repos.
6. **Probe hygiene.** The inventory probe passes `--bare`; authoring never does. Verified both
   ways: `--bare` keeps `/model` working and makes project skills unknown.

### Probe evidence

Run on v2.1.263 with model `haiku`, from a scratch repo containing
`.claude/skills/probe-skill/SKILL.md` whose body instructs an exact reply.

| Probe | Result |
|---|---|
| `claude -p "/model" --output-format json` | `is_error: false`, `duration_ms: 12`, `result` lists the accepted names |
| `claude -p "/model" --bare --output-format json` | same list, `duration_ms: 5` |
| `CLAUDECODE=1 claude -p "/model" --output-format json` | `is_error: false`, nested call accepted |
| `claude -p "/probe-skill" --output-format json` | `num_turns: 1`, `result: "PROBE-OK-7731"` |
| `FORGE_HEADLESS=1 claude -p "/probe-skill with trailing arguments" --output-format json` | `num_turns: 1`, `result: "PROBE-OK-7731"` |
| `claude -p "/probe-skill" --bare --output-format json` | `num_turns: 0`, `result: "Unknown command: /probe-skill"` |

OpenCode itself is not installed on this machine; its behaviour is taken from the current
documentation pages for skills and commands at opencode.ai.

## Estimate

Roughly 60 lines in `authoring-inventory.ts` including the parser, 10 in `launcher.ts`, 5 in
`cli.ts`, 30 across the console, about 150 lines of tests, plus docs and the ADR. One focused
change, smaller than the execution adapter because there is no failure classification.
