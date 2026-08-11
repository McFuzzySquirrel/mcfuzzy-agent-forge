# ADR-015: OpenCode Harness Bootstrap Path (`.opencode/agents`)

**Date:** 2026-08-11
**Status:** Accepted

---

## Context

ADR-014 introduced the `forge-workflow-engine` skill and the `OpenCodeAdapter` harness. The adapter invokes the OpenCode CLI with `--system-prompt <agent.md>`, where the agent file path is resolved by `forge-execution-adapter`'s discovery module.

The discovery module (`discovery.ts`) and the bootstrap scripts (`bootstrap.sh` / `bootstrap.ps1`) previously recognised three harness roots:

| Harness flag | Root directory | Used by |
|---|---|---|
| `agents` | `.agents` | Default / generic harness |
| `github` | `.github` | GitHub Copilot |
| `claude` | `.claude` | Claude |

OpenCode reads agents from `.opencode/agents/` — its own conventional directory. Without explicit support for this root, two problems arise:

1. **Bootstrap gap.** Running `bootstrap.sh --harness opencode` fails with an "Unknown harness" error, leaving the user with no automated way to install agent files into the location OpenCode expects.

2. **Discovery gap.** `discoverForgeRepo()` does not scan `.opencode/agents/`, so agent files bootstrapped there are invisible to the execution adapter and the workflow engine. Tasks whose `ownerAgent` field matches an agent living in `.opencode/agents/` are silently skipped rather than executed.

---

## Decision

Add `.opencode` as a first-class harness root alongside `.agents`, `.github`, and `.claude`.

### Changes

**`forge-execution-adapter/scripts/types.ts`**

Add `".opencode"` to the `HarnessRoot` union type:

```ts
export type HarnessRoot = ".agents" | ".github" | ".claude" | ".opencode";
```

**`forge-execution-adapter/scripts/discovery.ts`**

Add `".opencode"` to the `HARNESS_ROOTS` scan list so `discoverForgeRepo()` finds agents installed there:

```ts
const HARNESS_ROOTS: HarnessRoot[] = [".agents", ".github", ".claude", ".opencode"];
```

**`scripts/bootstrap.sh`**

Add `opencode` to the harness-to-root mapping and the validation error message:

```bash
opencode) ROOT=".opencode" ;;
```

**`scripts/bootstrap.ps1`**

Add `"opencode"` to the `ValidateSet` attribute and the `switch` statement:

```powershell
[ValidateSet("agents", "github", "claude", "opencode")]
...
"opencode" { ".opencode" }
```

**`templates/skills/forge-workflow-engine/SKILL.md`**

Update the prerequisites section to list `.opencode/agents/` as the expected agent directory when using the OpenCode harness.

---

## Consequences

### Positive

- **Zero-friction bootstrap for OpenCode.** `bootstrap.sh --harness opencode` (or `bootstrap.ps1 -Harness opencode`) now correctly installs agent files to `.opencode/agents/`, which is where the OpenCode CLI looks for them.
- **Full discovery coverage.** The execution adapter and workflow engine can find and invoke agents installed under `.opencode/agents/`, so `ownerAgent` assignments in the manifest are resolved correctly when the OpenCode harness is active.
- **Consistent pattern.** The change mirrors how `.github` and `.claude` were added — no special-casing elsewhere; harness selection is a single flag at bootstrap time.

### Negative

- **Detection ambiguity if multiple roots coexist.** `detectHarnessRoot()` picks the first match from the ordered list and emits a warning when more than one root is present. Teams that have both `.opencode/agents/` and `.agents/agents/` in the same repo should be aware that `.agents` takes priority (it is first in the list). This is consistent with the existing behaviour for other multi-root scenarios.

### Neutral

- The OpenCode adapter (`opencode-adapter.ts`) itself is unchanged; it already accepts an agent path from discovery and passes it to `--system-prompt`.
- No new runtime dependency is introduced.

---

## References

- Bootstrap scripts: [`scripts/bootstrap.sh`](../../scripts/bootstrap.sh), [`scripts/bootstrap.ps1`](../../scripts/bootstrap.ps1)
- Discovery: [`forge-execution-adapter/scripts/discovery.ts`](../../templates/skills/forge-execution-adapter/scripts/discovery.ts)
- Types: [`forge-execution-adapter/scripts/types.ts`](../../templates/skills/forge-execution-adapter/scripts/types.ts)
- Skill: [`forge-workflow-engine/SKILL.md`](../../templates/skills/forge-workflow-engine/SKILL.md)
- ADR: [ADR-014 Dynamic Workflow Orchestration](014-dynamic-workflow-orchestration.md)
