# ADR-043: Claude Code authoring runner

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

The launcher names a CLI on two independent axes: the execution harness that
runs workflow-engine tasks, and the authoring runner that drives the forge
skills. ADR-042 added Claude Code to the execution axis, but the authoring axis
knew only `copilot`, `opencode`, and `stub`, and OpenCode invokes a skill under
`.claude/skills/` through the model where Claude Code's `-p` invokes it natively.

## Decision

Add `claude` to `AuthoringRunner` alongside `copilot`, `opencode`, and `stub`.
Headless authoring emits
`claude -p "<message>" --permission-mode bypassPermissions [--model <alias>]`,
with `--debug` in launcher debug mode. The permission mode matches ADR-042's
reasoning: no operator is present to approve tool prompts in a headless run.

`headlessRunner` defaults a GitHub-harness repository to `copilot` and
everything else, including a Claude-harness repository, to `opencode`;
`FORGE_RUN_WITH=claude` selects the Claude runner, and
`forge-launcher authoring-models --runner claude` reads the inventory.

The inventory probe is `claude -p "/model" --bare --output-format json`, a
non-generative metadata interface in the sense ADR-041 requires: a built-in
slash command, never a model-selection prompt. It holds exactly the aliases that
command lists (`sonnet`, `opus`, `haiku`, `fable`, `sonnet[1m]`, `opus[1m]`,
`fable[1m]`, `opusplan`), dropping `default` and `best`, which resolve per
account. An `anthropic/`-qualified request is accepted with the prefix stripped;
any other full ID fails closed, and a pinned ID belongs in Claude Code settings
with the stage on `inherit`. There is no `--fallback-model`: see ADR-040.

The console follows the same defaults: a `.claude` repository defaults to the
`opencode` authoring runner while `inferEngineHarness` returns `claude`, and the
model-planning terminal offers Claude Code interactively beside the others.

## Consequences

`docs/research/model-inventory.json` gains a `claude_cli` section reflecting the
logged-in plan, so a refresh on a different account can list different aliases.

The Claude runner is opt-in, so existing Claude-harness repositories keep
authoring through OpenCode and their persisted stage models remain valid.
Selecting `FORGE_RUN_WITH=claude` requires stage models from the `claude_cli`
inventory or `inherit`, and a logged-in `claude` binary.

`--bare` is reserved for the inventory probe and never used for authoring: it
skips hooks, plugin sync, and auto-memory, which a probe does not need, but it
also makes a project skill under `.claude/skills/` an unknown command.

Amended 2026-09-07: this ADR first defaulted Claude-harness repositories to the
`claude` runner. That hid OpenCode's multi-provider inventory from the Console,
which has no runner selector, so the default was restored and the selector is
tracked as a follow-up; inheritance now falls back to the harness's own CLI
when the inherited one is missing, and explicit selections are exempt.

See `docs/research/claude-authoring-runner.md` for the probe evidence.
