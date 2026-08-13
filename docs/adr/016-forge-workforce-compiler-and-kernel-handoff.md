# ADR-016: Forge Workforce Compiler and Optional FlowForge Kernel Handoff

**Date:** 2026-08-13
**Status:** Accepted

---

## Context

ADR-011 (`forge-execution-adapter`) and ADR-014 (`forge-workflow-engine`) provide a contract-driven manifest and autonomous runtime orchestration, but they stop short of producing a `.workforce` package artifact. Teams integrating with FlowForge-style kernel runtimes still need a packaging and schema-validation boundary.

The missing capabilities were:

1. No first-class `.workforce` compiler from Forge outputs.
2. No explicit schema validation gate before kernel handoff.
3. No bridge artifact mapping Forge task IDs to workflow node IDs.
4. No optional workflow-engine harness mode for kernel handoff.

---

## Decision

Introduce a new `forge-workforce-compiler` skill package and add an optional `flowforge-kernel` harness adapter in `forge-workflow-engine`.

### 1. Interop contract v1

`forge-workforce-compiler` consumes:

- `docs/EXECUTION-MANIFEST.json`
- generated `.agent.md` files under the active harness root
- generated `SKILL.md` files under the active harness root

It emits:

- `dist/<package-id>.workforce/`
- `dist/<package-id>.workforce/workforce.json`
- `dist/<package-id>.workforce/workflows/<workflow-id>.json`
- `docs/KERNEL-BRIDGE.json`

v1 scope includes agents, skills, workflow, and bridge metadata. Persona/rubric/identity synthesis is explicitly deferred.

### 2. Validation gate

The compiler validates emitted artifacts against FlowForge-compatible schema constraints (manifest shape, agent shape, skill frontmatter shape, workflow node structure). Compile fails fast on validation errors.

### 3. Kernel adapter path

`forge-workflow-engine` adds `--harness flowforge-kernel` as an optional adapter. Existing adapters (`opencode`, `openai`, `stub`) remain unchanged.

The kernel adapter supports command templating and environment-driven configuration for runtime handoff while preserving workflow-engine state, retries, and audit flow.

### 4. State and audit boundary

`docs/KERNEL-BRIDGE.json` defines interop metadata:

- execution mode
- source manifest path
- workflow state path
- execution audit path
- compiled workforce path
- workflow ID
- task-to-node map

Execution mode must have a single source of truth at a time:

- prompt/harness execution: workflow-engine state + execution audit
- kernel execution: workforce runtime, with bridge metadata for correlation

---

## Consequences

### Positive

- Adds a concrete packaging boundary from Forge to FlowForge-style runtimes.
- Adds a deterministic validation gate before kernel execution.
- Keeps Forge generation and kernel execution concerns separated.
- Preserves backward compatibility for all existing runtime adapters.

### Negative

- v1 workflow synthesis is linear and manifest-order based.
- Kernel adapter defaults may require environment tuning in some deployments.
- Persona/rubric/identity interoperability remains future work.

### Neutral

- Bootstrap scripts require no changes; the new skill is copied automatically from `templates/skills/`.

---

## References

- Skill: [`forge-workforce-compiler`](../../templates/skills/forge-workforce-compiler/SKILL.md)
- Skill: [`forge-execution-adapter`](../../templates/skills/forge-execution-adapter/SKILL.md)
- Skill: [`forge-workflow-engine`](../../templates/skills/forge-workflow-engine/SKILL.md)
- ADR-011: [`forge-execution-adapter`](011-forge-execution-adapter.md)
- ADR-014: [`dynamic workflow orchestration`](014-dynamic-workflow-orchestration.md)
