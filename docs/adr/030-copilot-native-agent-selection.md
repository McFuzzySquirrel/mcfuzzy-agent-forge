# ADR-030: Copilot Harness Native Agent Selection via `/agent`

**Date:** 2026-08-28
**Status:** Accepted
**Relates to:** ADR-014 (workflow engine), ADR-006 (harness directory migration), ADR-028 (opencode `--agent` native selection)

---

## Context

The Copilot harness adapter (`copilot-adapter.ts`) inlined every owning agent's
file body into the `copilot -p` prompt because `copilot -p` has no
`--system-prompt` flag. Meanwhile the opencode harness (ADR-028 / v3.21) gained
native agent selection via `opencode run --agent <name>`, which lets the harness
load the persona itself.

Testing revealed the Copilot CLI supports the same idea inline: a prompt such as
`copilot -p "/agent agent-name and the rest of the message"` loads the named
agent natively. Since Agent Forge bootstraps GitHub Copilot harness agents into
`.github/agents/*.md` — the directory GitHub Copilot auto-detects (ADR-006) —
`/agent <name>` resolves the forge-generated agents without any configuration.

## Decision

Give the Copilot adapter the same native agent selection the opencode adapter
has, using the `/agent <name>` prompt directive:

- **Native selection.** When the owning agent has a name and its file lives under
  the project's `.github/agents/` directory, the adapter builds the prompt
  starting with `/agent <name>` and does **not** inline the persona. The context
  projection block, `Task:` block, expected-outputs / validation hints, and the
  execute-now directive are preserved after the directive.
- **Inline fallback.** For other harness roots (`.agents`, `.claude`,
  `.opencode`) Copilot cannot discover the agent files, so the previous
  inline-persona behavior is kept.
- **Shared escape hatch.** `FORGE_ENGINE_NATIVE_AGENT=0` forces the inline
  fallback on the copilot harness too (already supported by opencode), matching
  the default-on-with-escape posture of ADR-028.

## Consequences

Positive:

- Copilot sessions run under the real forge persona instead of a prose-inlined
  approximation, mirroring the opencode harness.
- Consistent behavior across the two native harnesses (opencode `--agent`,
  copilot `/agent`) with one shared escape hatch.

Negative:

- Native selection produces a thinner prompt (no inlined persona), the same
  trade-off flagged for opencode in ADR-028. The output-verification gate
  (ADR-029) and the execute-now directive guard against acknowledgment-only
  responses; `FORGE_ENGINE_NATIVE_AGENT=0` restores the old behavior.
- `/agent <name>` requires a Copilot CLI version that resolves repo agents from
  `.github/agents/`; older CLI versions fall back only if the inline path is
  chosen (`FORGE_ENGINE_NATIVE_AGENT=0`).

Trade-offs considered:

- **Opt-in flag** (default to inline until proven): rejected — the opencode
  precedent is default-on with an escape hatch, and the output gate makes the
  change safe.
- **Inline the persona *and* pass `/agent`** (belt-and-suspenders): rejected —
  duplicates the persona and defeats the native-selection purpose.

## References

- ADR-014: workflow engine; ADR-006: `.github/` harness convention; ADR-028:
  opencode native agent selection; ADR-029: output-verification gate.
- Implementation: `templates/skills/forge-workflow-engine/scripts/harness/copilot-adapter.ts`
  and `harness/copilot-adapter.test.ts`.
