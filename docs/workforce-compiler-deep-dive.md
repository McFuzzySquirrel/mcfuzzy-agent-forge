# Workforce compiler retirement

> **Historical note:** this page documents a retired integration and is not an
> active command reference.

MyForge no longer ships or invokes the `forge-workforce-compiler` package or a
FlowForge kernel adapter. The supported path is:

1. Author and review the PRD, agent team, and project skills as separate stages.
2. Run `forge-execution-adapter` to compile `docs/EXECUTION-MANIFEST.json`.
3. Run `forge-workflow-engine` with a native adapter such as `opencode`,
   `copilot`, `openai`, or `stub`.

Do not use the former `.workforce`, `KERNEL-BRIDGE.json`, `flowforge-kernel`, or
`FLOWFORGE_*` commands in new projects. Existing downstream `.workforce`
directories and bridge files are user-owned artifacts; retirement does not
delete them automatically. If a persisted project selects the retired harness,
refresh the bootstrapped skills and choose a supported native harness instead.

The original packaging design remains available in
[ADR-016](adr/016-forge-workforce-compiler-and-kernel-handoff.md) for historical
context. It is superseded by
[ADR-038](adr/038-flowforge-retirement.md).
