# Research: Dapr Workflow and Agents for MyForge

**Date:** 2026-10-12
**Status:** Proposed roadmap item

## Question

Investigating how Dapr Workflow or Dapr Agents could improve MyForge by allowing workflow and
agent state to be resumed from another host, and other benefits it would bring

## Current state

MyForge already has a durable local workflow engine:

- `docs/EXECUTION-MANIFEST.json` is the execution contract.
- `docs/WORKFLOW-STATE.json` persists task state and retry history.
- The engine supports resume, replay, retries, cancellation, approvals,
  verification gates, audit events, and bounded parallel execution.
- Harness adapters isolate orchestration from Copilot, Claude, OpenCode, and
  OpenAI execution.
- The artifact store persists typed task handoffs and projects compact context
  into later tasks.
- Concurrent repository tasks use isolated Git worktrees, while the engine
  remains the single writer of authoritative state and integrated changes.

This makes a run resumable when its repository and generated runtime files are
available. It does not provide shared remote state, distributed ownership,
automatic failover, or horizontal worker scaling. Moving execution to another
host also requires reconstructing the repository, credentials, dependencies,
generated files, and any uncommitted runtime state.

## Options

### Keep the existing engine only

This preserves MyForge's lightweight, Git-native, offline-friendly operation.
It remains the best default for local development, but does not solve hosted
multi-user orchestration or automatic failover.

### Add Dapr Workflow as an optional backend

Dapr Workflow could provide durable distributed execution, shared workflow
state, timers, external events, recovery after worker failure, and horizontally
scaled activity workers. The current engine should remain available, with both
backends consuming the same manifest and task contracts.

### Adopt Dapr Agents

Dapr Agents may become useful for long-lived conversational agents, durable
agent-to-agent messaging, and cross-run memory. It overlaps more substantially
with MyForge's personas, harness adapters, artifact handoffs, and task
orchestration. Its value and supported runtime maturity should be reassessed
after a workflow proof of concept.

### Replace the engine with Dapr

A complete rewrite would add infrastructure requirements to all users and risk
losing offline operation, Git-native inspectability, and established execution
semantics. This option is not recommended.

## Recommendation

Build a time-boxed proof of concept for an **optional Dapr Workflow backend**.
Do not replace the local engine, and do not adopt Dapr Agents in the first
iteration.

The proof of concept should preserve:

- the execution manifest as the orchestration contract;
- harness adapters as the model and CLI execution boundary;
- existing task verification and structured handoffs;
- artifact projection as the authoritative task-to-task context mechanism;
- worktree sandboxing and serialized Git integration;
- local execution as the zero-infrastructure default.

## Expected benefits

- Resume a durable run on a different worker against shared state.
- Recover automatically from process or node failure.
- Express retry delays, timeouts, human-review waits, and approvals durably.
- Enforce distributed run ownership through leases.
- Scale task activity workers independently from orchestration.
- Publish run events for Console updates and external integrations.
- Gain standard tracing, metrics, health checks, secret references, service
  invocation, and pub/sub integration.

Dapr cannot resume a model or CLI process in the middle of an invocation.
Harness calls must be retryable activities whose outcomes and side effects are
idempotent.

## Target architecture

Introduce an orchestration boundary with two implementations:

1. **Local backend** - the existing file-based DAG engine.
2. **Dapr backend** - a durable workflow that schedules MyForge activities.

One workflow instance represents one `runId`. Activities perform all
nondeterministic work, including harness invocation, filesystem operations,
validation, artifact persistence, sandbox integration, and Git commits.
Workflow code only evaluates durable state and schedules activities.

Use three distinct persistence concerns:

- **Workflow state:** task status, attempts, dependencies, approvals, and leases.
- **Execution artifacts:** outputs, validation evidence, logs, and commit
  references.
- **Agent memory:** reusable summaries or facts across tasks or runs.

Store compact metadata in the Dapr state store and large or sensitive artifacts
in an appropriate object store. Persist references and integrity metadata in
workflow state. A searchable or vector store remains necessary if semantic
memory is later required; Dapr state storage alone does not provide semantic
retrieval.

## Implementation plan

### Phase 1 - Validate prerequisites and contracts

- Confirm the current Dapr Workflow and Dapr Agents SDK maturity for MyForge's
  TypeScript/Node runtime.
- Define portability and recovery scenarios, operational constraints, and
  measurable success criteria.
- Inventory local state, artifact, control, approval, workspace, credential,
  and Git assumptions that must be reconstructed remotely.
- Define the boundary between orchestration decisions and nondeterministic
  activities.

**Exit criteria:** an accepted technical spike design identifies supported SDKs,
deployment topology, state and artifact stores, and explicit non-goals.

### Phase 2 - Extract an orchestration backend boundary

- Introduce a backend contract without changing manifest compilation or task
  semantics.
- Adapt the existing engine behind the local backend and prove behavior remains
  unchanged.
- Define backend-neutral run, task, attempt, approval, replay, cancellation,
  and lifecycle event models.

**Exit criteria:** all existing workflow-engine tests pass through the local
backend and no Dapr runtime is required for normal MyForge use.

### Phase 3 - Build the Dapr proof of concept

- Map a MyForge run to a durable workflow instance keyed by `runId`.
- Implement activities for harness execution, verification, artifact writes,
  sandbox integration, and Git commit.
- Use stable idempotency keys such as `runId/taskId/attempt/gate`.
- Add a distributed lease for each repository and run.
- Deliver human-review approvals and control requests as external workflow
  events.
- Publish normalized lifecycle events for the Console and integrations.

**Exit criteria:** the proof of concept completes a representative manifest and
produces equivalent task results, artifacts, audit evidence, and commits.

### Phase 4 - Prove recovery and correctness

- Terminate the orchestration host during idle, activity, retry-delay, and
  human-review states, then resume on another worker.
- Exercise duplicate activity delivery and verify idempotent artifact and Git
  behavior.
- Test timeout, cancellation, replay, exhausted retries, stale leases, and
  conflicting repository writes.
- Verify workspace reconstruction, dependency preparation, secrets, and
  credentials on a clean worker.
- Compare local and Dapr execution for correctness, latency, operating effort,
  resource use, and recovery time.

**Exit criteria:** no completed task is lost or silently duplicated, and moving
the workflow to another worker requires no manual state editing.

### Phase 5 - Productize only if the decision gate passes

- Add explicit launcher and Console backend selection; retain local execution as
  the default.
- Add deployment templates, state-store configuration, secret references,
  health checks, tracing, metrics, retention, and backup guidance.
- Document migration, rollback, compatibility, and operational ownership.
- Add integration and failure-injection tests while retaining backend-neutral
  conformance tests.

**Exit criteria:** operators can opt in without changing existing manifests or
losing the ability to return to the local backend.

### Phase 6 - Reassess Dapr Agents

- Evaluate Dapr Agents only for requirements not met by workflows and artifacts,
  such as durable conversational identity, cross-run messaging, or semantic
  memory.
- Compare it with a smaller dedicated memory interface and searchable store.
- Adopt it only if it preserves harness portability and avoids duplicating
  MyForge's task, persona, and artifact contracts.

## Decision gate

Proceed to production implementation only if MyForge requires one or more of:

- hosted multi-user execution;
- automatic failover across workers;
- distributed activity workers;
- shared remote workflow state;
- durable external events or long-running waits;
- centralized operational telemetry.

Remain with the local engine if usage is primarily local CLI execution and the
infrastructure and operational cost would exceed the recovery or scaling value.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Infrastructure complexity becomes mandatory | Keep Dapr optional and local execution as the default |
| Duplicate activity delivery repeats side effects | Require idempotency keys and record side-effect completion |
| Remote state diverges from Git workspace state | Persist commit and artifact integrity references and reconstruct from explicit checkpoints |
| Large or sensitive outputs overload workflow state | Store payloads externally and retain bounded references |
| SDK behavior constrains Node implementation | Validate SDK maturity before changing production architecture |
| Dapr Agents duplicates existing abstractions | Defer adoption and require a separate value case |

## Documentation impact if implemented

Implementation would require a new ADR plus updates to `ARCHITECTURE.md`,
`docs/workflow-engine.md`, `docs/workflow-engine-deep-dive.md`,
`docs/artifact-store-deep-dive.md`, the workflow-engine `SKILL.md`, launcher and
Console guidance, deployment documentation, and release notes.

## References

- [Architecture](../../ARCHITECTURE.md)
- [Workflow engine](../workflow-engine.md)
- [Workflow engine deep dive](../workflow-engine-deep-dive.md)
- [Artifact store deep dive](../artifact-store-deep-dive.md)
- [ADR-014: Dynamic workflow orchestration](../adr/014-dynamic-workflow-orchestration.md)
- [ADR-017: Artifact store and context projection](../adr/017-artifact-store-and-context-projection.md)
- [ADR-056: Parallel task execution](../adr/056-parallel-execution-task-sandboxes.md)
