# Scoping: a Claude Code harness adapter for the workflow engine

**Date:** 2026-09-07
**Status:** Implemented on this branch (ADR-042)
**Baseline:** `templates/skills/forge-workflow-engine/scripts/harness/copilot-adapter.ts`

## Problem

Claude Code is a first-class **authoring** harness. `forge-launcher bootstrap --harness claude`
scaffolds into `.claude/`, spawns `claude .`, and the user drives the pipeline from the chat
(ADR-010, `docs/forge-launcher.md`). It is not an **execution** harness. `resolveHarness` in
`scripts/cli.ts` offers exactly four transports:

```ts
case "opencode": return new OpenCodeAdapter({ attachUrl });
case "copilot":  return new CopilotAdapter();
case "openai":   return new OpenAIAdapter();
case "stub":     return new StubAdapter();
```

So a repository bootstrapped for Claude Code cannot execute its own manifest with the tool it
was scaffolded for. It must fall back to `opencode` or `copilot`, and both then degrade: native
agent selection is keyed to their own harness root, so for a `.claude` root they inline the
persona into the prompt instead (`copilot-adapter.ts:106-116`, `SKILL.md:284-295`).

That is the gap. Claude Code is the only CLI that reads `.claude/agents/` natively, and it is
the one transport the engine cannot use.

## The decisive capability

`claude --help` (v2.1.263) exposes `--agent <agent>`: "Agent for the current session. Overrides
the 'agent' setting." Claude Code discovers agents from `.claude/agents/`. A Claude adapter
therefore gets **native agent selection on the forge's canonical Claude harness root**, which
neither existing repository-capable transport can offer. This is not parity work, it closes a
real capability hole.

## Flag mapping against the Copilot baseline

| Concern | Copilot | Claude Code |
|---|---|---|
| Non-interactive invoke | `copilot -p "<prompt>"` | `claude -p "<prompt>" --output-format json` |
| Auto-approve tools | `--yolo` | `--permission-mode bypassPermissions` |
| Native agent selection | `/agent <name>` prepended to the prompt text | `--agent <name>` as a real flag |
| Native root | `.github/agents/` | `.claude/agents/` |
| Model | `--model <id>`, provider prefix stripped | `--model <id>`, alias or full name, prefix stripped |
| Binary override | `COPILOT_BIN` | `CLAUDE_BIN` |
| Extra flags | `COPILOT_EXTRA_FLAGS` | `CLAUDE_EXTRA_FLAGS` |

Two differences carry design weight.

**Agent selection moves out of the prompt.** Copilot smuggles `/agent <name>` in as the first
line of prompt text. Claude takes a flag, so the prompt carries only `request.instructions` in
native mode. `request.test.ts` asserts on prompt shape per transport and will need a Claude case
that reads the flag rather than the prompt head.

**Permission bypass has two spellings.** `--permission-mode bypassPermissions` is the direct
`--yolo` analogue. `--dangerously-skip-permissions` also exists. Prefer the former: it is the
documented enum value and composes with `--permission-mode` handling elsewhere. Note that
bypass mode is refused in some environments (running as root, for example), which surfaces as a
non-zero exit and should classify as `configuration`, not `retryable`.

## Adapter shape

Implements `HarnessAdapter` from ADR-040 exactly as Copilot does:

```ts
export class ClaudeAdapter implements HarnessAdapter {
  readonly name = "claude";
  readonly supportsConcurrency = true;
  readonly capabilities = ["text", "repository-tools"] as const;
  readonly defaultModel?: string;
}
```

`invoke(request)` follows the Copilot body for the front half: build args, `runCommand` with
`cwd: repoRoot`, `timeoutMs: request.budget.timeoutMs`, `signal: request.signal`,
`maxBufferBytes: 10 * 1024 * 1024`. The transport-error branch (`result.error`) is identical.
The back half diverges: instead of mapping the exit status, the adapter parses the JSON result
envelope on stdout and classifies from its fields. See "Result envelope and failure
classification" below.

Argument construction:

```ts
const native = this.canSelectAgent(request);
const prompt = native
  ? request.instructions
  : [inlinePersona(request), request.instructions].join("\n\n");
const agentFlag = native ? ["--agent", agent.name] : [];
const modelFlag = request.effectiveModel
  ? ["--model", stripProviderPrefix(request.effectiveModel)]
  : [];
const args = ["-p", prompt, "--output-format", "json", ...agentFlag, ...modelFlag, ...this.extraFlags];
```

`this.extraFlags` is `["--permission-mode", "bypassPermissions", ...parsed.flags]`, the
counterpart of Copilot's `["--yolo", ...parsed.flags]`.

`canSelectAgent` mirrors Copilot's, with the root swapped:

```ts
private canSelectAgent({ agent, repoRoot }: TaskAttemptRequest): boolean {
  if (process.env["FORGE_ENGINE_NATIVE_AGENT"] === "0") return false;
  if (!agent.name) return false;
  const parts = relative(repoRoot, agent.path).split(/[\\/]/);
  return parts[0] === ".claude" && parts[1] === "agents" && parts.length > 2;
}
```

`FORGE_ENGINE_NATIVE_AGENT=0` keeps its existing meaning: force the inline-persona fallback.

The constructor reuses `extractModelFlags` so `CLAUDE_EXTRA_FLAGS="--model opus"` becomes the
transport `defaultModel` rather than a duplicated flag, matching Copilot and OpenCode.

## Result envelope and failure classification

Decided 2026-09-07 after probing `claude` v2.1.263 directly. The probes and their raw results
are in the handoff document, section 5.

**Why JSON from the start.** Every failure probed exits with status 1: not logged in, unknown
`--agent`, invalid `--session-id`, invalid `--permission-mode`, max turns exhausted. An exit
code cannot separate a configuration fault from a transient one, so text-mode parity would give
the engine a classifier worse than Copilot's. In text mode the "Not logged in" message is even
printed to stdout, where the verifier would read it as trivial output. `--output-format json`
costs one flag and a small parse function, and the verifier's view of stdout does not change,
because the adapter unwraps the envelope and returns only the `result` text as
`TaskResult.stdout`. That is the same content text mode prints: the final assistant message.

**The envelope.** One JSON object on stdout. Fields the adapter reads:

| Field | Observed values | Used for |
|---|---|---|
| `type` | `"result"` | sanity check |
| `is_error` | boolean | the primary success signal |
| `subtype` | `success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries` | classification |
| `terminal_reason` | `completed`, `max_turns`, `api_error` | classification |
| `api_error_status` | HTTP status or `null` | configuration vs retryable |
| `result` | final assistant text, or the error message | `TaskResult.stdout` on success, `errorMessage` on failure |
| `permission_denials` | array of `{tool_name, tool_use_id, tool_input}` | detecting a refused bypass |
| `session_id` | UUID | logged for traceability |

A trap: `subtype` is `"success"` even when `is_error` is `true` (observed for the not-logged-in
case). Classify on `is_error` first and only then consult `subtype` and `terminal_reason`.

**Classification table.** Covers every condition observed, plus the two documented ones that
could not be reproduced locally.

| Condition | Signal | `failureKind` |
|---|---|---|
| Binary missing or not executable | `runCommand` spawn error | `configuration` (already, `run.ts:153`) |
| Timeout or cancellation | `runCommand` | `timeout` / `cancelled` (already) |
| CLI rejects an argument: unknown `--agent`, invalid `--session-id`, invalid `--permission-mode`, unknown flag | exit 1, **empty stdout**, message on stderr | `configuration` |
| Bypass refused (running as root, or `disableBypassPermissionsMode` policy) | exit non-zero before any JSON is emitted | `configuration`, via the same empty-stdout rule |
| Not logged in, expired credentials | `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: null`, `result` matches `/not logged in/i` | `configuration` |
| API 4xx other than 429 (bad model name, forbidden) | `is_error: true`, `api_error_status` 400 to 499 | `configuration` |
| API 429, 5xx, or `api_error` with no other signal | `is_error: true`, `terminal_reason: "api_error"` | `retryable` |
| Model errored mid-run | `subtype: "error_during_execution"` | `retryable` |
| `--max-turns` or `--max-budget-usd` exhausted | `subtype: "error_max_turns"` / `"error_max_budget_usd"` | `configuration`: both caps can only come from `CLAUDE_EXTRA_FLAGS`, so the operator set them; the engine's own timeout budget is the intended limiter |
| Completed, but tools were denied | `is_error: false`, `permission_denials` non-empty | `configuration`: under `bypassPermissions` the list must be empty, so a non-empty list means a policy blocked the bypass and every retry would fail the same way |
| Completed, but the process exited non-zero | `is_error: false`, no denials, exit status non-zero | `retryable`: the envelope and the exit code disagree, so the run is treated as an unexplained transport fault rather than an operator fault |
| Stdout is not parseable JSON, exit 0 | malformed envelope | `exception`, with the raw stdout preserved in `errorMessage` |
| Stdout is not parseable JSON, exit non-zero | crash or rejection before the envelope | `configuration`, with stderr as the message |
| `is_error: false`, no denials | normal completion | success; `stdout` = `result`, `outputFiles` filtered as Copilot does |

The "not parseable JSON, exit non-zero" row is the one judgement call. A mid-run crash that
leaves no envelope is classified as `configuration` and not retried. That is deliberate: every non-envelope exit
observed was an operator fault, and the stderr text reaches the operator through
`errorMessage`. If a transient no-envelope exit is ever observed, revisit.

**Session traceability.** The envelope returns `session_id`, and Claude Code persists the
session under `~/.claude/projects/`, so `claude --resume <id>` reaches the transcript. The
adapter logs the session ID on one line per invocation. `--session-id` is not passed: it must
be a valid UUID (verified, the CLI rejects anything else), a fixed ID would collide across
retries of the same task, and the returned ID gives the same traceability for free.

## Deliberate non-goals for v1

- **No `--fallback-model`.** ADR-040 states `modelFallback` is metadata and does not trigger an
  execution fallback. Wiring it would breach the contract the engine owns.
- **No attach or keep-alive mode.** `cli.ts:307` gates `--keep-alive` to opencode, backed by
  `opencode-server.ts`. Claude Code has `--bg` plus `claude attach` and could support an
  equivalent later, but that is a second body of work with its own state handling.
- **No `--resume`, `--continue`, or `--session-id`.** Each task stays an isolated invocation, as
  with Copilot. Traceability comes from the `session_id` the envelope returns, see above.
- **No `--bare`.** See the CLAUDE.md wrinkle below.
- **No `stream-json`.** The single `json` envelope is enough for classification. Streaming
  would only matter for progress reporting, which the engine does not consume.

## Known behavioral wrinkles

- **CLAUDE.md auto-discovery.** `claude -p` at `repoRoot` loads the project CLAUDE.md on top of
  the injected persona, so the persona is not the only instruction source. Decided: document,
  do not suppress. Three reasons. First, Copilot and OpenCode load their own repo-level
  instruction files under the same conditions, so this is ambient context every transport
  already has. Second, a repo bootstrapped with `--harness claude` has its
  CLAUDE.md authored as part of the forge scaffold, so it is intended context, not noise.
  Third, `--bare` skips hooks, LSP, plugin sync, attribution and auto-memory, and the forge's
  own skills and plugins live in `.claude/`, which is exactly what the adapter exists to use.
  An operator who wants isolation can pass `CLAUDE_EXTRA_FLAGS="--bare"`; the adapter does not
  need to know.
- **Trust dialog.** The `-p` help text states the workspace trust dialog is skipped in
  non-interactive mode, so no first-run stall.
- **Cancellation.** `runCommand` already spawns into a dedicated POSIX process group and
  terminates descendants, which covers Claude Code's own subprocesses.

## Wiring checklist

Engine, under `templates/skills/forge-workflow-engine/`:

- [ ] `scripts/harness/claude-adapter.ts` (new)
- [ ] `scripts/harness/claude-adapter.test.ts` (new)
- [ ] `scripts/cli.ts`: import; `resolveHarness` case; usage strings at lines 28 and 36; env var
      help at lines 66-67; the invalid-harness message at line 142; the unknown-harness message
      at line 156
- [ ] `scripts/request.test.ts`: add `"claude"` to the transport matrix at line 26, construct it
      at line 47, and handle flag-based rather than prompt-based agent selection at lines 75-78
- [ ] `SKILL.md`: prerequisites list, harness table, env var table, and the native-agent
      selection prose at lines 278-300

No type change is needed: engine state types `harness` as `string` (`types.ts:51`).

Templates and docs:

- [ ] `templates/agents/workflow-orchestrator.md`: quick-action table (lines 34-36) and the
      harness confirmation step (line 56), both of which currently enumerate opencode, openai,
      and stub
- [ ] `docs/workflow-engine.md` and `docs/workflow-engine-deep-dive.md`
- [ ] New ADR, next free number is 042, recording the decision and the non-goals above

**The launcher mirror needs no hand-editing.** `scripts/forge-launcher/resources/templates/` is
gitignored (`.gitignore` line 7) and regenerated from `templates/` by
`scripts/forge-launcher/scripts/stage-resources.mjs` during the launcher's `prepack` script, so
a change in `templates/` reaches the packed launcher on its own. A stale local copy only affects
local verification; re-run the staging script or rsync `templates/` over it if local runs look
out of date.

## Test plan

`copilot-adapter.test.ts` provides the pattern: a shim binary recording its argv, with
`COPILOT_BIN` pointed at it. The Claude shim differs in one way: it must print a JSON result
envelope on stdout, and the tests need to control which envelope it prints and its exit code.
Drive that through an environment variable the shim reads, for instance `CLAUDE_SHIM_RESULT`
holding a JSON string and `CLAUDE_SHIM_EXIT` holding the status. Default to a minimal success
envelope so the argv cases stay short.

Argv cases, with `CLAUDE_BIN`:

1. `--agent <name>` is passed and the persona is absent from the prompt for a `.claude/agents/`
   rooted agent.
2. The persona is inlined and no `--agent` flag appears for `.github`, `.opencode`, and
   `.agents` rooted agents.
3. No `--agent` flag when `agent.name` is empty, even under `.claude/agents/`.
4. `FORGE_ENGINE_NATIVE_AGENT=0` forces the inline fallback for a `.claude` rooted agent.
5. The execute-now directive and the timeout/retry budget appear in the prompt in both modes,
   matching the existing assertions at lines 126-156.
6. Provider prefix stripping: `anthropic/claude-sonnet-5` reaches the CLI as
   `claude-sonnet-5`.
7. `--output-format json` and `--permission-mode bypassPermissions` are always present, and
   `CLAUDE_EXTRA_FLAGS="--model opus --bare"` yields `defaultModel: "opus"` with `--bare` in
   argv and no duplicated `--model`.

Envelope cases, one per row of the classification table:

8. Success envelope: `success: true`, `stdout` equals the `result` text, `outputFiles` filtered
   by existence.
9. `is_error: true` with `result: "Not logged in · Please run /login"` maps to `configuration`.
10. `is_error: true` with `api_error_status: 429` maps to `retryable`; with `403` to
    `configuration`.
11. `subtype: "error_during_execution"` maps to `retryable`.
12. `subtype: "error_max_turns"` maps to `configuration`.
13. `is_error: false` with a non-empty `permission_denials` maps to `configuration` and names
    the denied tools in `errorMessage`.
14. Empty stdout with exit 1 and a stderr message maps to `configuration` with the stderr text
    as `errorMessage`. This is the unknown-agent and bypass-refused shape.
15. Non-JSON stdout with exit 0 maps to `exception`.
16. A spawn failure maps through `result.failureKind` unchanged.
17. `subtype: "success"` with `is_error: true` is treated as a failure, guarding the trap noted
    above.

## Estimate

The adapter itself is roughly 120 lines, most of it structurally identical to the Copilot
adapter, plus about 160 lines of tests. The larger share of the work is the wiring checklist; the
launcher mirror regenerates itself at pack time. One focused change, not a project.
