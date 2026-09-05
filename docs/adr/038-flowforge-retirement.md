# ADR-038: Retire FlowForge workforce integration

**Date:** 2026-09-05
**Status:** Accepted

## Context

MyForge previously included an optional `flowforge-kernel` workflow-engine
harness and a `forge-workforce-compiler` package that produced `.workforce`
artifacts and `docs/KERNEL-BRIDGE.json`. That integration duplicated runtime
responsibilities, complicated distribution, and made the active documentation
present two competing execution paths.

## Decision

Retire the FlowForge kernel adapter and workforce compiler from active MyForge
distribution and documentation. The supported pipeline is:

1. Author and review the PRD.
2. Generate and review the agent team.
3. Generate and review project skills.
4. Compile `docs/EXECUTION-MANIFEST.json` with `forge-execution-adapter`.
5. Execute the manifest with `forge-workflow-engine` and a native adapter.

The execution adapter owns manifest compilation and validation. The workflow
engine owns dispatch, output verification, retries, timeouts, cancellation,
replay, and durable state. No new FlowForge bridge or workforce package should
be added.

Retirement is non-destructive. Existing downstream `.workforce` directories,
bridge files, or modified template copies remain user-owned and are not deleted
automatically. Persisted or explicit retired harness selections must fail with
migration guidance before spawning a process; they must not silently reroute.

## Consequences

- Native execution is the only active runtime path documented and distributed.
- Historical ADRs, research, story documents, and changelog entries remain
  available for context, with ADR-016 explicitly superseded.
- Migration documentation must distinguish preserved artifacts from supported
  commands.
- The related authoring and native adapter contracts are recorded in ADR-039
  and ADR-040 respectively.

## References

- [ADR-016: Forge Workforce Compiler and Optional FlowForge Kernel Handoff](016-forge-workforce-compiler-and-kernel-handoff.md)
- [Workflow Engine](../workflow-engine.md)
- [Execution adapter](../../templates/skills/forge-execution-adapter/SKILL.md)
