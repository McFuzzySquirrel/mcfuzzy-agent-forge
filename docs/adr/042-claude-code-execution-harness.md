# ADR-042: Claude Code execution harness adapter

- **Status:** Accepted
- **Date:** 2026-09-07

Transport amendment: [ADR-046](046-task-execution-files.md) extends this adapter
to shared execution-file prompts for repository tasks. Native agent selection,
JSON envelopes, permissions, model rules and authoring behavior remain intact.
The original inline repository-prompt choice below is historical; text-only
requests still use inline prompts.

## Context

Claude Code was an authoring harness only. The forge generated agent teams into
`.claude/agents/`, but the workflow engine could execute them through opencode,
copilot, the OpenAI API, or the stub, never through Claude Code itself. That
left the forge's canonical Claude root without a native execution transport:
`.claude/agents/` teams had to be run by a harness that could not discover their
agent files and therefore inlined every persona into the prompt.

## Decision

Add `ClaudeAdapter` (`templates/skills/forge-workflow-engine/scripts/harness/claude-adapter.ts`)
and register it as `--harness claude`. It invokes
`claude -p "<task prompt>" --output-format json [--agent <name>] [--model <m>] --permission-mode bypassPermissions`
per task.

Agent selection is native and keyed to `.claude/agents/`: when the owning
agent's file lives there, the adapter passes `--agent <name>` and does not
inline the persona. For `.agents`, `.github`, and `.opencode` roots the CLI
cannot discover the agent files, so the persona is inlined as it is for Copilot.
`FORGE_ENGINE_NATIVE_AGENT=0` forces the inline fallback.

`--permission-mode bypassPermissions` is always passed: the engine runs
non-interactively and no operator is present to approve tool prompts, so a
denial that still appears in the envelope is a configuration fault.

`--output-format json` gives a machine-readable result envelope that drives
failure classification. A not-logged-in result, a 4xx API status, an exhausted
`error_max_turns` or `error_max_budget_usd` limit, and any tool denial are
`configuration` failures the operator must fix; 429s, 5xx statuses, and
unclassified errors are `retryable`. A missing or unparseable envelope on a
non-zero exit is `configuration`; on a zero exit it is an exception. A success
envelope alongside a non-zero exit is `retryable`, since the two signals
disagree and nothing identifies an operator fault to fix.

Provider prefixes are stripped from model IDs before they reach the CLI, as the
Copilot adapter already does. `CLAUDE_BIN` overrides the binary path and
`CLAUDE_EXTRA_FLAGS` supplies extra flags, with any model flag inside it parsed
out as the transport default model.

Non-goals recorded deliberately: no `--fallback-model` (model fallback stays
governed by ADR-040), no attach or keep-alive mode, no `--resume`, `--continue`,
or `--session-id` reuse, no `--bare`, and no `stream-json` output.

## Consequences

The canonical engine under `templates/skills/forge-workflow-engine/` is the
single source of truth. The launcher copy under
`scripts/forge-launcher/resources/templates/` is gitignored and regenerated from
it by `stage-resources.mjs` at pack time, so nothing needs mirroring by hand.

Ambient repository `CLAUDE.md` context is loaded by the CLI on every task. This
is documented rather than suppressed: the engine's projected context and the
repository's own instructions are both in scope for a task, and suppressing the
latter would diverge from how the same agents behave when authored.

See `docs/research/claude-code-harness-adapter.md` for the full transport
analysis behind these choices.
