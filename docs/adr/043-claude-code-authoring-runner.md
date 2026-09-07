# ADR-043: Claude Code authoring runner

- **Status:** Accepted
- **Date:** 2026-09-07

## Context

The launcher names a CLI on two independent axes: the execution harness that
runs workflow-engine tasks, and the authoring runner that drives the forge
skills drafting the PRD, the agent team, and the project skills. ADR-042 added
Claude Code to the execution axis, but the authoring axis still knew only
`copilot`, `opencode`, and `stub`, so a repository rooted at `.claude/` was
authored through OpenCode. OpenCode reads the forge skills from
`.opencode/commands/`, so its invocation of a skill under `.claude/skills/` is
model-mediated: the model decides to read the file. Claude Code invokes that
same skill natively and deterministically from `-p`.

## Decision

Add `claude` to `AuthoringRunner` alongside `copilot`, `opencode`, and `stub`.
Headless authoring emits
`claude -p "<message>" --permission-mode bypassPermissions [--model <alias>]`,
with `--debug` appended in launcher debug mode. The permission mode matches
ADR-042's reasoning: no operator is present to approve tool prompts in a
headless run.

`headlessRunner` defaults a Claude-harness repository to `claude`, a
GitHub-harness repository to `copilot`, and everything else to `opencode`.
`FORGE_RUN_WITH=claude` overrides it, and `forge-launcher authoring-models
--runner claude` reads or refreshes the inventory.

The inventory probe is `claude -p "/model" --bare --output-format json`, a
non-generative metadata interface in the sense ADR-041 requires: it runs a
built-in slash command and never submits a model-selection prompt. The
inventory holds exactly the aliases that command lists (`sonnet`, `opus`,
`haiku`, `fable`, `sonnet[1m]`, `opus[1m]`, `fable[1m]`, `opusplan`) and drops
`default` and `best`, which resolve per account and are not stable choices. An
`anthropic/`-qualified request is accepted with the prefix stripped; a full
model ID outside the list fails closed, as the inventory cannot verify it. A
user who needs a pinned full ID sets it in their Claude Code settings and leaves
the stage on `inherit`. There is no `--fallback-model`: model fallback stays
governed by ADR-040, as it does for the execution adapter.

The console follows the same defaults. A `.claude` repository defaults to the
`claude` authoring runner, `inferEngineHarness` returns `claude` for the engine
axis, and the model-planning terminal offers Claude Code beside OpenCode and
Copilot, launching `claude "<message>"` interactively with default permissions.

## Consequences

`docs/research/model-inventory.json` gains a `claude_cli` section reflecting the
logged-in plan, so a refresh on a different account can list different aliases.

`--bare` is reserved for the inventory probe and never used for authoring: it
skips hooks, plugin sync, and auto-memory, which a probe does not need, but it
also makes a project skill under `.claude/skills/` an unknown command.

See `docs/research/claude-authoring-runner.md` for the probe evidence and the
option-by-option analysis behind these choices.
