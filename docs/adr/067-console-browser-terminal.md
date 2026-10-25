# ADR-067: Interactive harness sessions in the Forge Console

**Date:** 2026-10-25
**Status:** Accepted
**Relates to:** ADR-034 (Forge Console), ADR-051 (interactive authoring), ADR-059 (PWD-aligned spawn environment), ADR-060 (interactive requirements authoring)

## Context

The Forge Console already starts interactive OpenCode, Copilot, and Claude
sessions, but sends them to a separate desktop terminal. That handoff is
unavailable to users accessing the Console through a browser without a local
terminal emulator. Requirements authoring must remain conversational (ADR-060),
so showing only captured output or replacing these steps with headless jobs is
not an adequate solution.

## Decision

Add a **Terminal** view to the local Console. It runs only the selected,
supported harness CLI in the currently selected project, inside a server-side
pseudo-terminal. The browser uses xterm.js to render terminal output and capture
input; a WebSocket bridges input, output, and resize events. The existing
external-terminal handoff remains available as a fallback.

The Console exposes fixed start requests for a harness session or one of the
existing interactive authoring targets. It does not accept arbitrary commands,
arguments, or working directories from the browser. The server resolves the
runner, prompt, and configured model using the same logic as its existing
external-terminal authoring endpoint.

The WebSocket requires both the per-server Console token and the exact local
origin. A Console process permits one active PTY session. Changing projects,
closing the browser connection, stopping the session, or shutting down the
Console terminates the PTY. Terminal dimensions and input messages are bounded.
The server continues to bind to loopback.

## Consequences

- Users can complete interactive harness and requirements-authoring sessions
  inside the Console without opening another terminal window.
- Full-screen terminal interfaces are supported through a real PTY and terminal
  emulator rather than output-only streaming.
- The launcher now depends on `node-pty`, `ws`, and xterm.js packages, increasing
  native install and browser-asset packaging requirements.
- Only one browser terminal may be active per Console process. Concurrent
  terminals and arbitrary shell access are intentionally unsupported.
- The external terminal remains the fallback for environments where the PTY or
  browser session is unavailable.

## References

- Implementation: `scripts/forge-launcher/scripts/console/terminal-session.ts`
  and `scripts/forge-launcher/scripts/console/dashboard/views/terminal.ts`.
- User guide: [Forge Console user guide](../forge-console-user-guide.md).
- Changelog: [updates.md](../updates.md), v3.100.
