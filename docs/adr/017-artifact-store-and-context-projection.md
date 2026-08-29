# ADR-017: Artifact Store and Context Projection Pattern

**Date:** 2026-08-18
**Status:** Accepted

---

## Context

ADR-016 (`forge-workforce-compiler`) and ADR-014 (`forge-workflow-engine`) provide autonomous, DAG-driven execution. However, each agent task was previously handed the full `WORKFLOW-STATE.json` as its input context. In multi-task workflows this creates three compounding problems:

1. **Context bloat** - every agent pays a token tax for the full run history, even for work it has no relationship to.
2. **Reduced focus** - large, undifferentiated context produces less precise agent outputs.
3. **Cost at scale** - small local models (Ollama) and API-tier models both degrade as context grows.

Research conducted during this feature's design confirmed that token savings come primarily from narrowing the hand-off boundary between agents, not from changing execution order.

---

## Decision

Introduce a file-based **artifact store** in `forge-workflow-engine` and a companion **context projection** layer that is applied before each task invocation.

### 1. Artifact Store

`templates/skills/forge-workflow-engine/scripts/artifacts.ts` implements a `FileArtifactStore` that:

- Persists every meaningful agent output as a compact, typed JSON artifact at `docs/artifacts/<type-prefix>/<artifact-id>.json`.
- Supports three top-level artifact categories (mapped from `Artifact.type`):
  - **decision** - `solution.requirement`, `solution.architecture`, ADRs; answers *what we are building and why*.
  - **work** - `implementation.result`, `code.review`, `test.result`; answers *what has been done*.
  - **evidence** - `build.output`, `lint.result`, `security.scan`; answers *how we know it is correct*.
- Exposes `create`, `get`, `list`, and `project` operations through a typed `ArtifactStore` interface, enabling a future `SqliteArtifactStore` or `BlobArtifactStore` without changing engine code.
- Is deliberately file-based so artifacts can be inspected, diffed, versioned in Git, and replayed without a database.

### 2. Context Projection

Before each task is dispatched to a harness adapter, the engine resolves the `inputs` list declared on the `ManifestTask`, calls `store.project(inputArtifactIds)`, and builds a markdown `contextBlock`. The adapter prepends this block to the user prompt instead of forwarding the full workflow state.

Each projected artifact is reduced to a minimal summary: `id`, `type`, `createdAt`, and a `summary` string. The engine emits a `context.projected` audit event recording `sourceTokenEstimate`, `projectedTokenEstimate`, and `reductionPercent`.

### 3. Manifest extension

`ManifestTask` gains two optional fields (in `forge-execution-adapter/scripts/types.ts`):

- `inputs?: string[]` - artifact types the task consumes as input context.
- `produces?: string` - artifact type the task must emit on success.

These fields are purely advisory at the manifest level; the engine reads them to wire up the store and projection.

### 4. Adapter interface extension

`HarnessAdapter.invoke` gains an optional `contextBlock?: string` parameter. Existing adapters that do not use it receive `undefined` and remain unchanged. `OpenCodeAdapter` and `OpenAIAdapter` prepend the block when present.

### 5. Audit integration

Two new audit event actions are added to `AuditEvent.action`:

- `artifact.created` - records `artifactId`, `artifactType`, and `inputArtifacts`.
- `context.projected` - records token reduction telemetry.

---

## Consequences

### Positive

- Eliminates full-state context bleed between unrelated agents.
- Produces a structured, inspectable artifact trail in `docs/artifacts/` that can be diffed and replayed.
- Maps naturally to the existing three-layer pipeline (decisions → work → evidence).
- Backward compatible: tasks that declare neither `inputs` nor `produces` behave exactly as before.
- Adapter interface change is non-breaking (optional parameter with `undefined` default).

### Negative

- Agents must produce well-formed artifact JSON; malformed output is not automatically coerced.
- The `docs/artifacts/` directory grows with every run; periodic cleanup is the operator's responsibility.
- v1 projection is a flat summary; semantic ranking or vector-similarity ranking is deferred.

### Neutral

- Bootstrap scripts require no changes; the new `artifacts.ts` module is part of `forge-workflow-engine` and is already copied by bootstrap.
- `docs/artifact-store-deep-dive.md` provides a full walkthrough of the pattern, schema, and extension points.

---

## References

- Deep-dive: [`docs/artifact-store-deep-dive.md`](../artifact-store-deep-dive.md)
- Skill: [`forge-workflow-engine`](../../templates/skills/forge-workflow-engine/SKILL.md)
- Implementation: [`templates/skills/forge-workflow-engine/scripts/artifacts.ts`](../../templates/skills/forge-workflow-engine/scripts/artifacts.ts)
- Types: [`templates/skills/forge-execution-adapter/scripts/types.ts`](../../templates/skills/forge-execution-adapter/scripts/types.ts)
- ADR-014: [`dynamic workflow orchestration`](014-dynamic-workflow-orchestration.md)
- ADR-016: [`forge-workforce-compiler and kernel handoff`](016-forge-workforce-compiler-and-kernel-handoff.md)
