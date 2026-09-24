# ADR-052: Harness CLI invocation and activity logging

Status: Accepted

## Context

When the workflow engine drives a task through a CLI harness (Copilot, Claude,
OpenCode), the engine log shows only the task start, heartbeat, and completion
lines. The actual CLI command is never recorded, and the harness's own output is
captured into a buffer that is only parsed after the process exits. Debugging a
stalled or misconstructed invocation was therefore guesswork: there was no way to
confirm the executable and argv, the working directory, the selected agent/model,
or whether the harness was doing work at all.

The engine already writes its stdout to `docs/engine-run.log` (directly via
`runTee`, or detached via `spawnDetached`), and the Forge Console tails that file
over SSE. `runCommand` in the workflow engine is the single process-execution
choke point shared by all three CLI adapters.

## Decision

Make command visibility unconditional and activity visibility opt-in.

- **Always log the invocation.** `runCommand` logs a single-line record before
  spawning, and again only when the Windows `.cmd` shim rewrite changes the
  executable or argv (the "effective" invocation). The record carries the
  timestamp, harness name, run ID, task ID, attempt, working directory,
  executable, and the complete argument list. Arguments are JSON-escaped
  element-by-element, so quoting, spaces, and multiline prompts remain
  unambiguous; referenced execution files are named, not expanded.
- **Activity logging is opt-in and off by default.** `--log-harness-activity`
  (with `--no-log-harness-activity` to force off) and
  `FORGE_ENGINE_LOG_HARNESS_ACTIVITY=1|0` gate it. Precedence is explicit CLI
  flag > environment variable > persisted `docs/engine-config.json` > default
  off. The persisted setting is written by the interactive launcher and the
  Console, which forward it as an explicit CLI flag so a Console-started run
  applies its saved choice deterministically.
- **Streamed activity, not post-hoc capture.** When enabled, `runCommand`
  mirrors stdout/stderr chunks through a line buffer as they arrive. Each line
  is tagged with the stream name, task, and attempt; a completion record follows
  with the exit status or the timeout/cancellation kind. This is additive: the
  existing captured buffers used for structured-result parsing, output
  verification, timeouts, cancellation, and task outcomes are unchanged.
- **Bounded output.** ANSI/terminal control sequences are stripped; a single
  line is capped at 4000 characters and total activity at 2 MB per attempt, both
  truncated with explicit markers. Activity logging never affects the engine's
  own `maxBufferBytes` limits.
- **Redaction.** Recognized credentials are replaced with an explicit
  `[REDACTED]` marker: secret-bearing flag values (`--token`, `--api-key`,
  `--password`, `--secret`, `--auth`, `--access-key`, …) and inline token shapes
  (`sk-…`, `ghp_…`, `github_pat_…`, `xox[baprs]-…`, `AKIA…`, JWTs, `Bearer …`).
  Environment variables are never dumped.
- **Console surface.** The Overview **Controls** panel gains a default-off
  **Log harness activity** checkbox that persists the setting, restores it on
  reload, warns that activity logs may contain sensitive repository content and
  increase log volume, and notes that changes apply to subsequently started runs.
- **Harness limitation.** The Claude adapter keeps `--output-format json`, whose
  envelope is emitted at completion, so Claude live activity is limited to
  whatever the CLI writes before that. Changing the format would break result
  parsing, so the limitation is documented rather than worked around.

## Consequences

- Every harness attempt, including retries and replay, records its complete
  invocation, subject to redaction, making command construction, agent/model
  selection, and launcher resolution auditable after the fact.
- Operators can opt in to live harness output for troubleshooting without
  changing default log volume or risking sensitive content in every run.
- Activity appears in the existing Console log view because it flows through
  `docs/engine-run.log`; no new Console streaming path is needed.
- The redaction list is heuristic and could miss an unrecognized credential
  format; the UI warning and the default-off posture mitigate this.
- API-only adapters (OpenAI) remain out of scope, as their traffic never passes
  through the CLI execution seam.

## References

- `templates/skills/forge-workflow-engine/scripts/harness/invocation-log.ts`
- `templates/skills/forge-workflow-engine/scripts/harness/run.ts`
- `docs/workflow-engine.md` - *Harness invocation and activity logging*
- `docs/forge-console.md`, `docs/forge-console-user-guide.md`
