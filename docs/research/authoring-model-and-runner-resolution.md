# How the authoring runner and its model actually resolve

**Date:** 2026-09-08
**Status:** Findings, with one decision (availability-aware inherit) implemented on this branch
**Companions:** [`claude-authoring-runner.md`](./claude-authoring-runner.md) for the runner itself,
[`console-authoring-runner-selector.md`](./console-authoring-runner-selector.md) for the explicit
selector. This document records two field reports and what probing the code and the CLI showed.

## The two reports

1. Bootstrapping an existing repository with the Claude harness, then running the Team stage:
   `Failed to run 'opencode': spawn opencode ENOENT`. The machine has Claude Code but not OpenCode.
2. The PRD draft stage failed with `You've reached your Fable limit`, on an account whose work
   was expected to run on Opus.

Neither is a bug in model discovery or in the runner code. Both come from the same place: what
the launcher does when nothing explicitly selects a runner or a model.

## Finding 1: the model is only pinned when you pin it

`authoringArgv` in `authoring-inventory.ts` appends `--model` only when the resolved invocation
has an `effectiveModel`:

```ts
const model = invocation.effectiveModel ? ["--model", invocation.effectiveModel] : [];
```

`selectAuthoringModel` returns no model when the stage is on `inherit`, which is the default.
So a stage on inherit spawns `claude -p ...` with no `--model` flag, and Claude Code applies its
own default. That default is not a forge concept and the forge never writes one: bootstrap
copies no `settings.json` into the target repository (verified: no `.claude` template directory,
no `settings*.json` anywhere under `templates/`).

Report 2 follows directly. The account's Claude Code default was Fable at the time, so every
inherit-stage authoring run consumed the Fable allowance, regardless of what the forge was
configured with.

### Verified precedence for the Claude Code default

Probed against `claude` v2.1.263 with `claude -p "/model" --bare --output-format json`, which
reports the model in force without an API call:

| Setup | Reported model |
|---|---|
| No project settings, global `"model": "opus[1m]"` | `Opus 5 (1M context)` |
| Project `.claude/settings.json` with `{"model": "opus"}` | `Opus 5` |
| Same, plus `--model sonnet` on the command line | `Sonnet 5` |
| Project `.claude/settings.local.json` with `{"model": "opus"}` | `Opus 5` |

So: the `--model` flag beats project settings, which beat global settings. A forge stage model
therefore overrides a repository's `settings.json`, and a stage left on inherit hands the
decision to that file.

### Two ways to pin a model for one project

- **Per stage, through the forge.** `forge-launcher authoring-config --repo <path> --prd-model
  opus --team-model opus --skills-model opus`, or the three dropdowns in the Console's authoring
  settings panel. The choice is persisted in `docs/authoring-config.json` and recorded in the
  invocation provenance in `docs/authoring-state.json`. Verified that `opus`, `opus[1m]` and
  `claude-opus-5` all pass `validateAuthoringConfig`, and that `parseClaudeModelOutput` keeps the
  bracketed aliases, so the 1M variants are selectable:
  `sonnet, opus, haiku, fable, sonnet[1m], opus[1m], fable[1m], opusplan`.
- **Per repository, through Claude Code.** A `.claude/settings.json` (checked in) or
  `.claude/settings.local.json` (local only) in the target repository with `{"model": "opus"}`.
  This governs every `claude` invocation in that repository, including forge stages on inherit
  and interactive sessions.

The stage route only works when the runner is `claude`. Under the `opencode` runner the
inventory holds provider-qualified IDs, so a bare `opus` fails closed as unverified, which is
the intended behaviour from ADR-041.

## Finding 2: inherit could name a runner that is not installed

After the ADR-043 amendment, `authoringRunnerForHarness` maps a `.claude` harness root to
`opencode`, so that the Console's per-runner inventory keeps showing OpenCode's multi-provider
model list. That amendment fixed one report and caused report 1: on a machine with only Claude
Code installed, a `.claude` repository inherits a runner whose binary does not exist, and the
stage dies at spawn with ENOENT.

The two reports pull in opposite directions. One machine has OpenCode and wants its inventory;
the other has only Claude Code and wants the stage to run at all. A fixed table cannot satisfy
both, because the right answer depends on what is installed.

### Decision: availability-aware inherit

Only the `inherit` level consults the environment. When the inherited runner's CLI is missing
and the harness's own native CLI is present, inherit resolves to the native CLI instead:

| Harness root | Inherited today | Native CLI | Inherit resolves to |
|---|---|---|---|
| `.claude` | `opencode` | `claude` | `opencode` when installed, else `claude` when installed |
| `.github` | `copilot` | `copilot` | unchanged |
| `.opencode`, `.agents` | `opencode` | `opencode` | unchanged |

Only the `.claude` row can change, which is exactly the reported case. When neither binary is
present the result is unchanged, so the operator still gets the existing ENOENT message naming
a missing CLI rather than a silent substitution.

Explicit selections are untouched: a `--runner` flag, `FORGE_RUN_WITH`, and a saved project
runner all still win and still fail loudly when their CLI is missing. An explicit choice that
silently became a different runner would be worse than an error.

## Consequences

A Claude-harness repository on a machine without OpenCode now authors through Claude Code
without configuration, and the same repository on a machine with OpenCode is unchanged. The
inventory shown in the Console follows whichever runner inherit resolved to, so the maintainer
who reported the missing OpenCode models keeps them.

Because inherit now depends on the machine, two developers on the same repository can resolve
to different runners. That is why the explicit selector exists: saving a runner in
`docs/authoring-config.json` makes the choice portable and is the recommended setup for a
shared repository.
