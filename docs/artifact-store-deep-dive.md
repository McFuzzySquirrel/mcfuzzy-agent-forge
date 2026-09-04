# Artifact Store Deep-Dive - MyForge

## What this document covers

This guide explains the **Task → Agent → Artifact → Task** pattern that is now built into MyForge's workflow engine. It covers why the pattern exists, how it is implemented, how to use it in a manifest, and how to extend it later.

---

## The Problem: Context Bloat Between Agents

When a multi-agent workflow passes the entire conversation - or the full `WORKFLOW-STATE.json` - from one agent to the next, every agent pays a context-window tax for work it wasn't involved in. This wastes tokens, slows small local models, and produces less focused outputs.

The research behind this feature found that the optimisation is not *sequential execution itself* - it is **how small and deterministic the hand-off between agents is**. Token savings come from making the boundary between agents as narrow as possible.

---

## The Pattern

```
Task
  ↓
Agent executes with scoped context
  ↓
Artifact created  (compact, typed JSON)
  ↓
Next task: receives only the artifact projection it needs
  ↓
Agent executes with scoped context
  ↓
Artifact created
  ↓
...
```

The **artifact** is the token firewall. The next agent does not need to know how the previous agent arrived at its conclusion - only *what* it concluded.

---

## Three Categories of Artifact

| Category | Answers | Examples |
|---|---|---|
| **decision** | What are we building and why? | `solution.requirement`, `solution.architecture`, ADRs |
| **work** | What has been done? | `implementation.result`, `code.review`, `test.result` |
| **evidence** | How do we know? | `build.output`, `lint.result`, `security.scan` |

This three-layer stack maps directly to a typical build pipeline:

```
DECISIONS  →  WORK  →  EVIDENCE  →  REVIEW  →  DECISION
```

---

## Artifact Schema

Every artifact is a JSON file stored in `docs/artifacts/<subdir>/<id>.json`.

```json
{
  "artifactId": "architecture-001",
  "type": "solution.architecture",
  "category": "decision",
  "taskId": "design-solution",
  "producedBy": "architect-agent",
  "createdAt": "2025-01-01T12:00:00Z",
  "status": "complete",

  "summary": "Notification API implemented using .NET Worker + Azure Service Bus.",
  "confidence": 0.91,

  "inputs": ["requirement-001"],
  "filesChanged": ["src/Notifications/NotificationController.cs"],

  "payload": {
    "components": ["Notification API", "Message Queue", "Worker"],
    "decisions": ["Use Service Bus for async delivery", "Idempotency via header key"]
  },

  "nextActions": []
}
```

### Key design choices

**`summary` is the primary field.** Most downstream agents receive only `summary`, `confidence`, `filesChanged`, and `agentOutputExcerpt` - not the full payload. For synthesised completion artifacts, the summary is derived from the task title + description rather than the first stdout line, so downstream context describes the intended work instead of an agent's self-talk.

**`inputs` traces the knowledge graph.** Every artifact records which other artifact IDs it was built from. This allows the audit log to reconstruct the complete knowledge-flow chain:

```
requirement-001
       ↓
architecture-001
       ↓
implementation-001
       ↓
review-001
```

**Storage is files, not a database.** Artifacts live in `docs/artifacts/` as plain JSON files. They can be inspected, diffed, versioned in Git, and replayed without any additional infrastructure. The store also reserves sequential IDs in memory after seeding from disk, so concurrent write attempts cannot accidentally reuse an existing `<type>-NNN` identifier. A future `SqliteArtifactStore` or `BlobArtifactStore` can implement the same interface without changing the engine.

---

## Storage Layout

```
docs/
  artifacts/
    architecture/
      architecture-001.json
    implementation/
      implementation-001.json
      implementation-002.json
    review/
      review-001.json
    testing/
      testing-001.json
```

Subdirectory names are derived from the *last segment* of the artifact type string:

| Type | Subdirectory |
|---|---|
| `solution.architecture` | `architecture/` |
| `implementation.result` | `result/` |
| `code.review` | `review/` |
| `test.result` | `result/` |

> **Tip:** Use consistent, dot-separated type names like `<domain>.<noun>` to keep types readable and groupable.

---

## Declaring Artifact Contracts in the Manifest

Add `inputs` and `produces` fields to tasks in `docs/EXECUTION-MANIFEST.json`:

```json
{
  "id": "1.1",
  "title": "Design solution architecture",
  "ownerAgent": "architect-agent",
  "dependencies": [],
  "produces": "solution.architecture"
},
{
  "id": "1.2",
  "title": "Implement notification API",
  "ownerAgent": "developer-agent",
  "dependencies": ["1.1"],
  "inputs": ["solution.architecture"],
  "produces": "implementation.result"
},
{
  "id": "1.3",
  "title": "Review implementation",
  "ownerAgent": "reviewer-agent",
  "dependencies": ["1.2"],
  "inputs": ["solution.architecture", "implementation.result"]
}
```

- **`inputs`** - list of artifact *types* (not IDs) the engine loads before running this task. The engine resolves the most recently completed artifact of each listed type.
- **`produces`** - the artifact *type* this task must create. If the agent does not produce one explicitly, the engine auto-synthesises a minimal `work` artifact from the task's output files, a task-derived summary, a default `confidence: 0.9`, and an agent-output excerpt for diagnostics.

Tasks without `inputs` or `produces` behave exactly as before - the artifact layer is strictly additive.

---

## How the Engine Wires It Together

### Before the task runs: context projection

```
1. Read task.inputs from the manifest
2. For each input type:
     load the most recent complete artifact of that type
3. Select only: summary + confidence + filesChanged + agentOutputExcerpt + any task-declared fields
4. Render a compact markdown block:

   ## Context from previous tasks

   ### solution.architecture (architecture-001)
   **Summary:** Notification API using .NET + Azure Service Bus.
   **Confidence:** 91%

   *Context projection: ~480 tokens (96.2% reduction from ~12480 source tokens)*

5. Prepend the block to the agent's prompt
6. Emit audit event: context.projected
```

### After the task succeeds: artifact creation

```
1. If task.produces is set:
     synthesise an artifact from outputFiles + stdout
2. Enrich `outputFiles` with repo worktree diffs so in-place edits are attributed too
3. Write docs/artifacts/<subdir>/<id>.json
4. Update WORKFLOW-STATE.json: tasks[id].artifactId = "..." and `inputArtifactIds`
5. Emit audit event: artifact.created
```

---

## Audit Events

The `docs/EXECUTION-AUDIT.jsonl` file now emits two new event types.

### `context.projected`

Emitted before each task that declares `inputs`. The `reductionPercent` field is the quantitative proof-of-value for the pattern.

```jsonc
{
  "timestamp": "2025-01-01T12:01:00Z",
  "action": "context.projected",
  "taskId": "1.2",
  "sourceTokenEstimate": 12480,
  "projectedTokenEstimate": 480,
  "reductionPercent": 96.2,
  "note": "2 artifact(s) projected for task 1.2"
}
```

### `artifact.created`

Emitted after each task that declares `produces` and completes successfully.

```jsonc
{
  "timestamp": "2025-01-01T12:05:00Z",
  "action": "artifact.created",
  "taskId": "1.2",
  "artifactId": "implementation-001",
  "artifactType": "implementation.result",
  "inputArtifacts": ["architecture-001"]
}
```

---

## The `ArtifactStore` API

The store is exposed as a TypeScript class in `scripts/artifacts.ts`. You can use it directly in custom harness adapters or tooling scripts.

```typescript
import { ArtifactStore } from ".agents/skills/forge-workflow-engine/scripts/artifacts.ts";

const store = new ArtifactStore({ artifactsPath: "/path/to/repo/docs/artifacts" });

// Write an artifact
const artifact = store.write({
  type: "solution.architecture",
  category: "decision",
  taskId: "1.1",
  producedBy: "architect-agent",
  status: "complete",
  summary: "Three-tier architecture with Service Bus messaging.",
  confidence: 0.91,
  inputs: [],
  filesChanged: [],
  payload: { components: ["API", "Worker", "Queue"] },
  nextActions: [],
});

// Read by ID
const loaded = store.read("architecture-001");

// Read by type (all complete artifacts)
const all = store.readByType("solution.architecture");

// Build a projection for the next task
const projection = store.project({
  taskId: "1.2",
  inputTypes: ["solution.architecture"],
  fields: ["summary", "confidence", "components"],
});

// Render as a markdown block for prompt prepending
const block = store.renderProjection(projection);
```

---

## Token Efficiency in Practice

The research document describes a concrete example. Consider a typical review task:

| Approach | Tokens sent to agent |
|---|---|
| Dump full workflow state + previous agent stdout | ~12 000–15 000 |
| Dump full architecture + implementation artifacts | ~8 000–10 000 |
| **Projected context (summary + confidence + filesChanged + agentOutputExcerpt)** | **~500–900** |

At 75–95% reduction, a 4K-context local model can now handle review tasks that previously required a 16K+ cloud model. The pattern makes local-model workflows viable for multi-step builds.

---

## Evolving the Pattern

### Right now: file-based

The current implementation writes artifacts as JSON files and reads them from disk. This is the correct starting point: files are inspectable, diffable, versionable, and require zero infrastructure.

### Next: SQLite index

When a workflow grows to hundreds of tasks, add a SQLite metadata index:

```
ArtifactStore
  ├── FileArtifactStore   ← current
  ├── SqliteArtifactStore ← add when you need querying at scale
  └── BlobArtifactStore   ← add for distributed/cloud builds
```

The SQLite store would index `artifact_id`, `type`, `task_id`, `status`, `created_at`, and `file_path` - without duplicating the payload. The orchestrator queries the index and loads only the relevant file.

### Later: context-aware retrieval

For very large builds, consider a two-layer artifact model:

```json
{
  "summary": "...",           ← always sent
  "confidence": 0.91,        ← always sent
  "payload": { ... }         ← fetched only when task declares specific fields
}
```

The projection system already supports this via the `fields` parameter: only fields explicitly requested by the task are included in the projection block.

---

## Integration Points

| Component | What changed |
|---|---|
| `forge-execution-adapter/scripts/types.ts` | `ManifestTask` gains `inputs?: string[]` and `produces?: string`; new `Artifact`, `ArtifactCategory`, and `ArtifactProjection` types added |
| `forge-workflow-engine/scripts/types.ts` | `TaskRecord` gains `artifactId?` and `inputArtifactIds?`; `AuditEvent.action` union extended with `artifact.created`, `context.projected`, and follow-on run bookkeeping; `EngineOptions` gains `artifactsPath` |
| `forge-workflow-engine/scripts/artifacts.ts` | New file - `ArtifactStore` class with `write`, `read`, `readByType`, `readByTask`, `project`, `renderProjection`, `synthesise` |
| `forge-workflow-engine/scripts/engine.ts` | `executeTask` now resolves input artifacts, builds projection, prepends context block to harness call, synthesises output artifact, emits new audit events |
| `forge-workflow-engine/scripts/state.ts` | `markTaskComplete` accepts optional `artifactId` and `inputArtifactIds` parameters |
| `forge-workflow-engine/scripts/harness/*.ts` | All harness `invoke` signatures accept optional `contextBlock?: string` parameter |
| `forge-workflow-engine/scripts/cli.ts` | `buildOptions` populates `artifactsPath` |

---

## Worked Example: "Build a Notification Service"

### Manifest tasks

```json
[
  {
    "id": "1.1",
    "title": "Define requirements",
    "ownerAgent": "architect-agent",
    "produces": "solution.requirement"
  },
  {
    "id": "1.2",
    "title": "Design architecture",
    "ownerAgent": "architect-agent",
    "dependencies": ["1.1"],
    "inputs": ["solution.requirement"],
    "produces": "solution.architecture"
  },
  {
    "id": "2.1",
    "title": "Implement notification API",
    "ownerAgent": "developer-agent",
    "dependencies": ["1.2"],
    "inputs": ["solution.architecture"],
    "produces": "implementation.result"
  },
  {
    "id": "2.2",
    "title": "Write integration tests",
    "ownerAgent": "test-agent",
    "dependencies": ["1.2"],
    "inputs": ["solution.architecture"],
    "produces": "test.result"
  },
  {
    "id": "3.1",
    "title": "Code review",
    "ownerAgent": "reviewer-agent",
    "dependencies": ["2.1", "2.2"],
    "inputs": ["solution.requirement", "solution.architecture", "implementation.result", "test.result"]
  }
]
```

### Artifacts created after a successful run

```
docs/artifacts/
  requirement/
    requirement-001.json    ← produced by 1.1
  architecture/
    architecture-001.json   ← produced by 1.2, inputs: [requirement-001]
  result/
    result-001.json         ← produced by 2.1, inputs: [architecture-001]
    result-002.json         ← produced by 2.2, inputs: [architecture-001]
  review/
    review-001.json         ← produced by 3.1 (if it declares produces), inputs: [requirement-001, architecture-001, result-001, result-002]
```

### Audit trail

```jsonl
{"action":"context.projected","taskId":"1.2","sourceTokenEstimate":0,"projectedTokenEstimate":0}
{"action":"artifact.created","taskId":"1.2","artifactId":"architecture-001","artifactType":"solution.architecture"}
{"action":"context.projected","taskId":"2.1","sourceTokenEstimate":3200,"projectedTokenEstimate":180,"reductionPercent":94.4}
{"action":"artifact.created","taskId":"2.1","artifactId":"result-001","artifactType":"implementation.result"}
{"action":"context.projected","taskId":"2.2","sourceTokenEstimate":3200,"projectedTokenEstimate":180,"reductionPercent":94.4}
{"action":"artifact.created","taskId":"2.2","artifactId":"result-002","artifactType":"test.result"}
{"action":"context.projected","taskId":"3.1","sourceTokenEstimate":12800,"projectedTokenEstimate":720,"reductionPercent":94.4}
```

The review agent at task 3.1 receives four projected summaries totalling ~720 tokens instead of ~12 800 tokens of raw artifact data - a 94% reduction before the task's own description is even added.

---

## Summary

The artifact pattern is the answer to this question from the research:

> *The optimisation isn't "use sequential agents." It's: make every agent consume the minimum artifact projection necessary to perform its task.*

The implementation in MyForge is intentionally minimal: a file-based store, a projection function, a rendered markdown block, and two new audit event types. Everything else - the harness adapters, the state machine, the audit log - continues to work as before. The pattern is additive, not a rewrite.

The `reductionPercent` field in `context.projected` audit events turns the hypothesis into a measurable claim. Track it across builds to understand the real-world impact on token efficiency and model quality for your specific workflows.
