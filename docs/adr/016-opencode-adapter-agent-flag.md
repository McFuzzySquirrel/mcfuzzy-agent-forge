# ADR-016: OpenCode Adapter `--agent` Flag

**Date:** 2026-08-12
**Status:** Accepted

---

## Context

ADR-015 added `.opencode` as a first-class harness root and confirmed that the OpenCode CLI reads named agents from `.opencode/agents/`. The `OpenCodeAdapter` already passes `--system-prompt <agent.path>` to `opencode run`, but it did not pass `--agent <agent.name>`.

During a live run the engine's OpenCode adapter was observed being patched at runtime to add `opencode run --agent <name> …`. This indicated that the OpenCode CLI requires (or strongly benefits from) the `--agent` flag to resolve the correct named-agent context when multiple agents are installed in `.opencode/agents/`. Without the flag, the CLI may fall back to a default agent or fail to honour the intended agent's configuration.

---

## Decision

Add `--agent <agent.name>` as the first positional flag in the `opencode run` invocation inside `OpenCodeAdapter.invoke()`.

### Change

**`templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`**

```ts
const agentFlag = agent.name ? ["--agent", agent.name] : [];
// …
const args = [
  this.bin,
  "run",
  ...agentFlag,   // ← new
  ...modelFlag,
  ...systemPromptFlag,
  ...this.extraFlags,
  prompt,
];
```

The flag is guarded: if `agent.name` is somehow empty the flag is omitted and behaviour is unchanged.

Updated CLI shape:

```
opencode run [--agent <name>] [--model <model-id>] [--system-prompt <path>] "<prompt>"
```

---

## Consequences

### Positive

- **Correct agent context.** OpenCode resolves the named agent from `.opencode/agents/<name>.md`, so model overrides and other agent-level configuration defined there are applied.
- **Backward-compatible.** The guard means the adapter still works if `agent.name` is empty (e.g. anonymous descriptors in tests).
- **Eliminates runtime patching.** The fix removes the need for the ad-hoc patch observed during the run that motivated this ADR.

### Negative

- None identified. The flag was already being applied at runtime; this change just makes it permanent and consistent.

---

## References

- Adapter: [`templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts`](../../templates/skills/forge-workflow-engine/scripts/harness/opencode-adapter.ts)
- ADR-014: [Dynamic Workflow Orchestration](014-dynamic-workflow-orchestration.md)
- ADR-015: [OpenCode Harness Bootstrap Path](015-opencode-harness-bootstrap-path.md)
