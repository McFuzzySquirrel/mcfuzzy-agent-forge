# ADR-070: Windows harness resolution and background terminal sessions

**Date:** 2026-10-26
**Status:** Accepted
**Relates to:** ADR-068 (interactive harness sessions in the Forge Console), ADR-052 (harness invocation activity logging)

## Context

Two defects surfaced in Windows user testing of the Forge Console terminal.

1. **Harness launch failed with a not-found error**, in both the in-Console PTY
   and the external-terminal path, even though `opencode`, `copilot`, and
   `claude` run by bare name in a normal Windows shell. The Console passed the
   bare name straight to `node-pty`. node-pty's conpty backend resolves a bare
   filename against `Path` with a literal file lookup
   (`node-pty/src/win/path_util.cc` `get_shell_path`) and never applies
   `PATHEXT`, so `opencode` never matched the installed `opencode.exe`.
2. **Navigating to another Console view ended the session.** The terminal view
   owned the WebSocket, and `unmountTerminal()` closed it; the server kills the
   PTY when the socket closes.

## Decision

1. **Resolve CLIs to absolute executables before spawning.** A shared
   `cli-resolve.ts` checks explicit env overrides
   (`OPENCODE_BIN`, `CLAUDE_CODE_BIN`/`CLAUDE_BIN`, `COPILOT_BIN`), then `PATH`
   with the platform's executable extensions, then well-known Windows install
   directories. `terminal-session.ts` spawns the resolved path and, when it
   cannot resolve one, sends a clear error instead of starting a dead PTY. The
   external-terminal launcher and the launcher's availability checks use the
   same resolver, replacing two divergent `commandExists` copies.
2. **Keep terminal sessions alive across view navigation.** The Console
   terminal's WebSocket and buffered output move to a module-level controller
   that outlives the view. Navigating away unmounts the terminal surface but
   keeps the socket open and buffers output (capped, with a truncation notice);
   returning replays the buffer and resumes live I/O. The Terminal nav link
   shows a dot while a session is live.

A session still ends on explicit Stop, a project change, a full page reload, or
Console shutdown. Surviving a page reload would require a server-side
detach/re-attach protocol and is deliberately out of scope.

## Consequences

- Official Windows installers work without the user passing a full path; a
  non-standard install can be pointed at with the CLI's `*_BIN` override.
- One resolver replaces three lookups, so the Console, external terminal, and
  launcher cannot drift on which binaries they find.
- Users can watch the build or read other views while an authoring interview
  keeps running, and return to the terminal to continue it.
- Buffered output for a background session is bounded to 256 KiB; older output
  is dropped with a visible notice when the view reattaches.
- A page reload still ends the session, which is documented in the Console guide.

## References

- Resolver: `scripts/forge-launcher/scripts/cli-resolve.ts`.
- PTY session: `scripts/forge-launcher/scripts/console/terminal-session.ts`.
- External terminal: `scripts/forge-launcher/scripts/terminal.ts`.
- Console view: `scripts/forge-launcher/scripts/console/dashboard/views/terminal.ts`
  and `views/terminal-replay.ts`.
- Changelog: [updates.md](../updates.md), v3.106.
