# ADR-040: Native adapter request and lifecycle contracts

**Date:** 2026-09-05
**Status:** Accepted

## Context

The workflow engine previously passed positional arguments and mutable workflow
state directly into harness adapters. That coupled transport code to scheduling
internals, obscured capability mismatches until dispatch, and made run-scoped
resource cleanup inconsistent.

## Decision

Define a native adapter boundary with immutable, explicit contracts:

- `TaskAttemptRequest` is the read-only per-attempt request. It contains
  `agent`, `task`, `effectiveModel`, `repoRoot`, `contextBlock`,
  `requiredCapabilities`, `attempt` (`number`, `maxRetries`, `runId`), `budget`
  (`timeoutMs`), `instructions`, and an optional `signal`.
- `HarnessRunContext` is the read-only run-scoped context for lifecycle hooks.
- `HarnessAdapter` exposes `invoke(request)`, explicit capabilities and an
  optional `defaultModel`, plus optional `prepare(context)` and
  `cleanup(context)` hooks.
- `DeepReadonly` prevents adapters from mutating request descriptors or arrays.
- `TaskCapability` is `text` or `repository-tools`.
- `TaskFailureKind` is `retryable`, `configuration`, `exception`, `timeout`, or
  `cancelled`.

Task capability requirements are conservative: omitted or empty
`requiredCapabilities` means `repository-tools`. Only genuinely text-only
tasks may declare `["text"]`. The engine rejects unsupported requirements
before `prepare` or `invoke`. OpenAI is text-only; Copilot and OpenCode are
repository-capable; Stub supports both synthetically.

Model precedence is `task.model`, then `agent.model`, then the transport
default. `modelFallback` is metadata and does not trigger an execution
fallback. The engine owns scheduling, owner/capability preflight, request
construction, verification, retries, and durability. Transports own wire
formatting, native persona and model-ID translation, process execution, and
run-resource cleanup.

`prepare` and `cleanup` are run-scoped and cleanup executes in `finally` around
both normal runs and replay, including preparation failure. Cleanup must be safe
when preparation was incomplete or cleanup already occurred. External attach
resources remain operator-owned.

The engine remains serialized regardless of `supportsConcurrency`; that field
describes transport capability and does not enable parallel repository edits.

## Consequences

- Adapter implementations no longer receive `WorkflowState` or positional
  invocation arguments.
- Capability errors are deterministic and make no transport call.
- Request semantics and verification behavior are shared across native
  transports while wire layouts remain transport-specific.
- Cancellation, timeout, and configuration failures can be classified and
  persisted consistently.
- Future concurrency work can reuse the adapter capability declaration without
  changing the request contract.

## References

- [Workflow Engine](../workflow-engine.md)
- [Workflow Engine deep dive](../workflow-engine-deep-dive.md)
- [ADR-038: Retire FlowForge workforce integration](038-flowforge-retirement.md)
