# ADR-028: Native Agent Selection in the OpenCode Harness

**Date:** 2026-08-27
**Status:** Accepted
**Relates to:** ADR-014 (workflow engine), ADR-015 (opencode harness bootstrap path), ADR-027 (keep-alive attach mode)

---

## Context

The workflow engine dispatches every manifest task through a harness adapter.
For the opencode harness, `OpenCodeAdapter.invoke` shells out to
`opencode run --dir <repo> --auto "<agent body + task prompt>"`: the owning
forge agent's persona (`agent.rawBody`) was inlined as the first block of the
user prompt, because `opencode run` has no `--system-prompt` flag.

That works functionally, but the **session attribution is wrong**. `opencode run`
supports a `--agent <name>` flag that selects a project or global agent for the
session. Because the adapter never passed it, every task ran under opencode's
**default agent** - inspecting opencode's session list showed a wall of default
"build" sessions instead of the forge agents (`discovery-engineer`, `qa-engineer`,
…). The persona was present only as prompt text, so the session metadata never
reflected which forge agent executed the task.

## Decision

When the task's owning agent file lives under the project's
`.opencode/agents/` directory - the harness root opencode natively scans for
agent definitions - the adapter:

- passes `--agent <name>` (using the agent's frontmatter `name`, which matches
  the file name opencode expects), and
- **does not inline** the persona into the prompt; opencode loads the full agent
  file itself as the session's system prompt.

The adapter decides via a `canSelectAgent` guard: `agent.name` must be non-empty
and the agent's repo-relative path must contain a `.opencode/` segment.

For other harness roots (`.agents`, `.claude`, `.github`), opencode cannot
discover the agent files, so `--agent <name>` would fail. The adapter keeps the
previous behavior there: inline the persona (`agent.rawBody`) into the prompt
and pass no `--agent` flag.

## Consequences

Positive:

- Sessions in opencode now run under the actual forge agent, so session lists,
  attribution, and per-agent review match the manifest's ownership.
- Persona duplication is removed for `.opencode`-rooted repos: opencode supplies
  the system prompt, and the user prompt is just the task + context + validation
  hints - fewer tokens per task.
- Applies in all engine modes (`--attach`, `--keep-alive`, cold start) because
  it is purely an argv change on `opencode run`.
- Default behavior is unchanged for non-`.opencode` harness roots.

Negative:

- `.agents`/`.claude`-rooted repos still run under the default agent in opencode
  (persona inlined, no session attribution). Fully fixing those would require
  generating opencode agent files from the forge agent definitions or an
  `--agent-config`/config wiring, left as a follow-up.
- The guard depends on the harness-root convention embedded in `agent.path`;
  moving agent files between harness roots changes selection behavior (by
  design).

Trade-offs considered:

- **Always pass `--agent` + keep the inline persona** - simplest change, works
  even when opencode cannot find the agent, but doubles the persona in context
  and still runs under the default agent for non-`.opencode` roots.
- **Synthesize opencode agent files for all harness roots** - full attribution
  everywhere, but requires a sync step that mirrors `.agents/`/`.claude/` into
  `.opencode/agents/`; rejected as heavier than the guard for the current
  `.opencode`-centric usage.

## References

- ADR-014: workflow engine; ADR-015: opencode harness bootstrap path;
  ADR-027: keep-alive attach mode.
- `opencode run --agent <name>` selects a project/global agent for the session
  (documented via `opencode run --help`).
- Implementation: `templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`
  plus `scripts/harness/opencode-adapter.test.ts`.
