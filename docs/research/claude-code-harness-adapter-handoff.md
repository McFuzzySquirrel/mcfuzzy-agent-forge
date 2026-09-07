# Session handoff: Claude Code harness adapter

**Written:** 2026-09-07
**Branch:** `feat/claude-harness-adapter`
**Companion:** [`claude-code-harness-adapter.md`](./claude-code-harness-adapter.md) is the scope. This file is the session context behind it, so a fresh session does not repeat the archaeology.

Start here, then read the scope document. Everything below was verified by reading the
repository or running the tool, not inferred. File and line references are against commit
`a39e963` on `main`.

---

## 1. State of play

| Item | State |
|---|---|
| Branch | `feat/claude-harness-adapter`, cut from `main` at `a39e963` |
| Commit | `800177a` docs(research): scope a Claude Code harness adapter |
| Fork | `lithiumriver/mcfuzzy-agent-forge`, public, parent `McFuzzySquirrel/mcfuzzy-agent-forge` |
| Remotes | `origin` upstream (read-only), `fork` the lithiumriver fork |
| Pushed | Yes, to `fork` |
| Upstream PR | Open: McFuzzySquirrel/mcfuzzy-agent-forge #79 (this branch), stacked with #80 (authoring runner) and #81 (follow-ups). |
| Fork PR | lithiumriver #1 to #3 were the interim review venue before upstream access; superseded by the upstream PRs. |
| Implementation | **Done**, same branch: adapter, wiring, docs, ADR-042, launcher default. Open questions resolved 2026-09-07, see section 5. |

### The upstream PR was blocked, resolved 2026-09-07

The cause was a pending collaborator invitation on the upstream repository. Accepting it granted
write access and the PRs opened normally. The diagnosis below is kept for the record.

`gh pr create` fails with:

```
GraphQL: lithiumriver does not have the correct permissions to execute `CreatePullRequest`
```

and the REST equivalent (`POST /repos/McFuzzySquirrel/mcfuzzy-agent-forge/pulls`) returns a bare
`404 Not Found`. Ruled out: the CLI token carries account-wide `repo` scope; upstream is public,
not archived, not disabled, `allow_forking: true`, and PRs are plainly in use (#73 to #77). The
fork relationship is registered and the branch is visible at the right SHA. Permissions on
upstream read `{admin: false, maintain: false, pull: true, push: false, triage: false}`.
Interaction limits could not be read (needs admin). Most likely an interaction restriction or
block on the upstream side, which only the maintainer can lift.

Open it in a browser, which uses the session cookie rather than the CLI token:

```
https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge/compare/main...lithiumriver:feat/claude-harness-adapter?expand=1
```

A ready-to-paste PR title and body are in the appendix.

---

## 2. The finding that drove the scope

Claude Code is a first-class **authoring** harness and not an **execution** harness.

Authoring, which already works: `forge-launcher bootstrap --harness claude` scaffolds into
`.claude/`, spawns `claude .`, and the user drives the pipeline from chat
(ADR-010, `docs/forge-launcher.md:845`, `docs/forge-launcher.md:560`).

Execution, which does not: `resolveHarness` in
`templates/skills/forge-workflow-engine/scripts/cli.ts:147-158` offers exactly four transports.

```ts
case "opencode": return new OpenCodeAdapter({ attachUrl });
case "copilot":  return new CopilotAdapter();
case "openai":   return new OpenAIAdapter();
case "stub":     return new StubAdapter();
```

`scripts/harness/` contains only those four implementations plus `run.ts` and
`opencode-server.ts`. There is no `claude-adapter.ts` and no ADR proposing one. The single
occurrence of the string `claude` in the engine's code is a comment at
`scripts/harness/run.ts:34` noting that `cross-spawn` handles npm-installed CLIs including
`claude` on Windows. That is spawn plumbing, not an adapter.

**Why this is more than parity work.** Native agent selection is keyed to each transport's own
harness root. Copilot checks `.github/agents/` at `copilot-adapter.ts:114-116`; OpenCode checks
`.opencode/agents/`. For a `.claude` root, both fall back to inlining the persona body into the
prompt (`SKILL.md:284-295`). Claude Code's CLI exposes `--agent <agent>` and discovers agents
from `.claude/agents/`, so it is the only transport that can select forge agents natively on the
forge's own canonical Claude root.

---

## 3. Verified facts, with sources

### 3.1 The adapter contract (ADR-040)

`docs/adr/040-native-adapter-contracts.md`, accepted 2026-09-05. Relevant to this work:

- `HarnessAdapter` exposes `invoke(request)`, `capabilities`, optional `defaultModel`, and
  optional `prepare(context)` / `cleanup()` hooks (`scripts/types.ts:94-103`).
- `TaskAttemptRequest` is read-only and carries `agent`, `task`, `effectiveModel`, `repoRoot`,
  `contextBlock`, `requiredCapabilities`, `attempt`, `budget`, `instructions`, `signal`
  (`scripts/types.ts:75-86`).
- `TaskCapability` is `"text" | "repository-tools"`. Copilot and OpenCode are repository-capable,
  OpenAI is text-only, Stub does both synthetically.
- `TaskFailureKind` is `retryable | configuration | exception | timeout | cancelled`
  (`scripts/types.ts:72`).
- Model precedence is `task.model`, then `agent.model`, then the transport default.
  **`modelFallback` is metadata and does not trigger an execution fallback.**
- The engine owns scheduling, preflight, request construction, verification, retries and
  durability. Transports own wire formatting, native persona and model-ID translation, and
  process execution.

### 3.2 What the Copilot adapter actually does

`scripts/harness/copilot-adapter.ts`, the whole file is about 120 lines.

- Class fields: `name = "copilot"`, `supportsConcurrency = true`,
  `capabilities = ["text", "repository-tools"] as const`, optional `defaultModel`.
- Constructor reads `COPILOT_BIN` (default `copilot`) and `COPILOT_EXTRA_FLAGS`, runs the extra
  flags through `extractModelFlags`, and prepends `--yolo`.
- `invoke` builds `["-p", prompt, ...modelFlag, ...this.extraFlags]`, calls `runCommand` with
  `cwd: repoRoot`, `timeoutMs: request.budget.timeoutMs`, `signal: request.signal`,
  `maxBufferBytes: 10 * 1024 * 1024`.
- Three result branches: `result.error` returns `failureKind: result.failureKind`; non-zero
  `result.status` returns `failureKind: "retryable"`; success filters `task.expectedOutputs`
  through `existsSync(resolve(repoRoot, path))`.
- `canSelectAgent` returns false when `FORGE_ENGINE_NATIVE_AGENT === "0"` or the agent has no
  name, else checks `parts[0] === ".github" && parts[1] === "agents" && parts.length > 2` on the
  path relative to `repoRoot`.
- `stripProviderPrefix` keeps the segment after the last `/`.

Supporting helpers:

- `inlinePersona(request)` at `scripts/request.ts:64-66` joins `agent.rawBody` with
  `agent.constraints` rendered as `- ` bullets.
- `extractModelFlags(args)` at `scripts/harness/run.ts:164-177` pulls `--model` / `-m` /
  `--model=` out of a flag string, throws on a missing value or conflicting duplicates, and
  returns `{ flags, model }`.
- `runCommand` uses `cross-spawn`, spawns into a dedicated POSIX process group so cancellation
  reaches descendants, and yields while the child runs so heartbeats keep emitting.

Contrast worth remembering: OpenCode **keeps** the provider prefix on model IDs
(`opencode-adapter.ts:88`, e.g. `github-copilot/gpt-5.6-luna`), Copilot strips it. Claude Code
should strip, since it expects an alias or a bare model name.

### 3.3 Claude Code CLI surface, verified against v2.1.263

Run `claude --help` to re-check. What matters here:

| Flag | Behavior |
|---|---|
| `-p, --print` | Print response and exit. The workspace trust dialog is skipped in non-interactive mode. |
| `--agent <agent>` | Agent for the current session, overrides the `agent` setting. **The native-selection lever.** |
| `--agents <json>` | Defines custom agents inline as JSON. Not needed when agents live on disk. |
| `--permission-mode <mode>` | One of `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. `bypassPermissions` is the `--yolo` analogue. |
| `--dangerously-skip-permissions` | Second spelling of the same bypass. Prefer the enum. |
| `--model <model>` | Alias (`opus`, `sonnet`, `fable`) or a full model name. |
| `--fallback-model <model>` | Automatic fallback when the default is overloaded. **Deliberately unused, see ADR-040.** |
| `--output-format <format>` | `text` (default), `json`, `stream-json`. Only with `--print`. |
| `--session-id <uuid>` | Fixed session ID. Must be a valid UUID. Not passed, the envelope's `session_id` is logged instead, see section 5. |
| `--bg, --background` | Background session, with `claude attach`/`logs`/`stop`. Possible future attach mode. |
| `--add-dir`, `--bare`, `--settings`, `--setting-sources`, `--plugin-dir` | Context and config control. `--bare` disables CLAUDE.md auto-discovery, hooks, LSP and plugin sync. |

### 3.4 Engine wiring touchpoints

No type change is needed. Engine state types `harness` as a plain `string`
(`scripts/types.ts:51`), so adding a transport does not widen a union.

Places that enumerate transport names today:

- `scripts/cli.ts:18` import, `:28` and `:36` usage strings, `:66-67` env var help,
  `:142` invalid-harness error, `:147-158` `resolveHarness`, `:156` unknown-harness message
- `scripts/cli.ts:307` gates `--keep-alive` to opencode; `:322` branches on opencode
- `scripts/request.test.ts:26` transport matrix, `:47` construction, `:75-78` prompt vs flag
  assertions
- `SKILL.md` prerequisites (around `:19-24`), harness and env var tables, and the
  native-agent-selection prose at `:278-300`
- `templates/agents/workflow-orchestrator.md:34-36` quick actions and `:56` the harness
  confirmation step, both of which list opencode, openai and stub

**Correction: there is no trap here.** This document originally called
`scripts/forge-launcher/resources/templates/skills/forge-workflow-engine/` a committed duplicate
that had to be hand-mirrored. That was wrong: the directory existed locally only as a stale
`prepack` leftover, which is what the original listing found. `scripts/forge-launcher/resources/templates/`
is gitignored (`.gitignore` line 7) and regenerated from `templates/` by
`scripts/forge-launcher/scripts/stage-resources.mjs` during the launcher's `prepack` script. A
change in `templates/` alone ships correctly; a stale local copy only affects local verification.

### 3.5 Test pattern to copy

`scripts/harness/copilot-adapter.test.ts` is the model. It writes a shim binary that records its
argv, points `COPILOT_BIN` at it, invokes the adapter, then asserts on the recorded arguments.
Existing cases to mirror, at the noted lines: native selection with no inlined persona (`:72`),
inline fallback for other roots (`:84`), no native selection when the agent name is empty
(`:96`), `FORGE_ENGINE_NATIVE_AGENT=0` forcing inline (`:108`), the execute-now directive in
both modes (`:126`), and the timeout and retry budget appearing in the prompt (`:139`).

Run the engine's tests with:

```bash
cd templates/skills/forge-workflow-engine
npm install
npm test          # node scripts/test-runner.mjs
npm run typecheck # tsc --noEmit
```

---

## 4. Decisions already made, and why

Detail lives in the scope document. Summary so a reviewer can argue with them:

1. **Native selection via `--agent`, keyed to `.claude/agents/`.** Mirrors `canSelectAgent` with
   the root swapped. `FORGE_ENGINE_NATIVE_AGENT=0` keeps its meaning.
2. **Agent selection moves from prompt text to a flag.** Copilot prepends `/agent <name>` to the
   prompt; Claude takes a real flag, so in native mode the prompt carries only
   `request.instructions`. `request.test.ts` needs a Claude case that reads argv, not the prompt
   head.
3. **`--permission-mode bypassPermissions` over `--dangerously-skip-permissions`.** It is the
   documented enum value. Note bypass is refused in some environments, for instance running as
   root, which surfaces as a non-zero exit and should classify as `configuration` rather than
   `retryable`.
4. **Strip the provider prefix**, following Copilot rather than OpenCode.
5. **`CLAUDE_BIN` and `CLAUDE_EXTRA_FLAGS`**, through the existing `extractModelFlags`.
6. **`--output-format json` from the start**, with the adapter unwrapping the envelope so the
   verifier still sees plain final-message text. Superseded the earlier "text first" leaning
   once the probes showed every failure exits with status 1. See section 5.
7. **Non-goals for v1:** no `--fallback-model` (ADR-040), no attach or keep-alive mode (that is
   `opencode-server.ts`-shaped work), no `--resume`/`--continue`/`--session-id`, no `--bare`,
   no `stream-json`.

---

## 5. Open questions, resolved 2026-09-07

All five were resolved by probing `claude` v2.1.263 directly. The decisions are recorded in the
scope document under "Result envelope and failure classification", the non-goals, and the
wrinkles. Summary and the raw evidence:

1. **JSON output: go straight to JSON.** Every failure probed exits with status 1 (not logged
   in, unknown `--agent`, invalid `--session-id`, invalid `--permission-mode`, max turns), so
   text-mode parity would classify worse than Copilot. The adapter unwraps the envelope and
   returns `result` as `TaskResult.stdout`, so the verifier sees the same final-message text it
   would in text mode. Nothing downstream changes.
2. **Ambient CLAUDE.md: document, do not suppress.** `--bare` skips hooks, LSP, plugin sync,
   attribution and auto-memory, and the forge's own skills and plugins live in `.claude/`.
   Operators who want isolation can pass `CLAUDE_EXTRA_FLAGS="--bare"`.
3. **Failure classification: inventoried.** The table in the scope document covers every
   observed condition. The rule that does most of the work: a non-zero exit with **no JSON on
   stdout** is a CLI-level rejection and classifies as `configuration`. That single rule
   catches unknown agent, bad session ID, bad permission mode, and the bypass refusal, without
   pattern-matching stderr.
4. **`--session-id`: not passed.** The CLI rejects anything but a valid UUID, a fixed ID would
   collide across retries, and the envelope already returns `session_id`, which the adapter
   logs. `claude --resume <id>` then reaches the persisted transcript.
5. **Contribution path: a PR inside the fork.** The cause turned out to be that this account
   cannot open cross-fork PRs against upstream at all. The branch is reviewed through a PR
   against `lithiumriver:main`. Push the implementation to the same branch so scope and code
   review together. Upstream contribution, if wanted, is the maintainer's call and can be
   done from the merged fork branch later.

### Probe evidence

Run from a scratch directory with `CLAUDECODE` unset, model `haiku`. Only the fields that
matter are shown.

| Probe | Exit | Stdout | Stderr |
|---|---|---|---|
| `-p "Reply with exactly the word OK" --output-format json` | 0 | `{"type":"result","subtype":"success","is_error":false,"terminal_reason":"completed","stop_reason":"end_turn","num_turns":1,"result":"OK","session_id":"<uuid>","api_error_status":null,"permission_denials":[]}` | empty |
| Same, but not logged in (sandbox without keychain access) | 1 | `{"subtype":"success","is_error":true,"terminal_reason":"api_error","api_error_status":null,"result":"Not logged in · Please run /login"}` | empty |
| Same, text mode, not logged in | 1 | `Not logged in · Please run /login` | empty |
| `--agent no-such-agent-xyz` (either output format) | 1 | empty | `--agent 'no-such-agent-xyz' not found. Available agents: ...` |
| `--session-id not-a-uuid` | 1 | empty | `Error: Invalid session ID. Must be a valid UUID.` |
| `--permission-mode nonsense` | 1 | empty | `error: option '--permission-mode <mode>' argument 'nonsense' is invalid. Allowed choices are acceptEdits, auto, bypassPermissions, manual, dontAsk, plan.` |
| `--model not-a-real-model-xyz` | continues | proceeds to the API | warning `[claude-code:unrecognized_model]`; the API decides |
| Write a file, `--max-turns 1 --output-format json` | 1 | `{"subtype":"error_max_turns","is_error":true,"terminal_reason":"max_turns","num_turns":2,"result":"","permission_denials":[{"tool_name":"Write",...}]}` | empty |
| Write a file, `--permission-mode dontAsk --output-format json` | 0 | `{"subtype":"success","is_error":false,"terminal_reason":"completed","num_turns":5,"result":"I'm unable to complete this task because all file creation tools are currently denied...","permission_denials":[Write, Bash, ...]}` | empty |

Subtype values found in the binary: `success`, `error_during_execution`, `error_max_turns`,
`error_max_budget_usd`, `error_max_structured_output_retries`.

Two conditions are documented but were not reproduced: bypass refused when running as root,
and bypass disabled by the `disableBypassPermissionsMode` policy. Both exit before emitting an
envelope, so the empty-stdout rule covers them. Worth a quick confirmation on a root shell if
one is to hand.

Note the `dontAsk` row: the CLI reports success while the model reports it could not do the
work. That is why a non-empty `permission_denials` list under bypass mode classifies as
`configuration` rather than trusting `is_error`.

---

## 6. How to pick this up

```bash
cd /path/to/mcfuzzy-agent-forge
git checkout feat/claude-harness-adapter
```

Then, in order:

1. Read `docs/research/claude-code-harness-adapter.md` (the scope).
2. Read `scripts/harness/copilot-adapter.ts` and its test in full. The new adapter is
   structurally the same file.
3. Skim `docs/adr/040-native-adapter-contracts.md` for the contract boundary.
4. Read section 5 for the resolved decisions and the probe evidence behind them.
5. Implement against the wiring checklist in the scope document. The launcher copy under
   `scripts/forge-launcher/resources/templates/` is gitignored and regenerated at pack time, so
   there is nothing to mirror by hand.
6. `npm test` and `npm run typecheck` in `templates/skills/forge-workflow-engine`.
7. Add ADR-042 recording the decision and the non-goals.

Repository conventions are in `AGENTS.md`. There is no `CLAUDE.md` in this repo, so point the
new session at this file explicitly.

---

## Appendix: PR title and body

Title:

```
docs(research): scope a Claude Code harness adapter for the workflow engine
```

Body:

```markdown
Scope only, no implementation. Opening for review before writing code, since the non-goals are the part most worth disagreeing with.

## The gap

Claude Code is a first-class **authoring** harness: `forge-launcher bootstrap --harness claude` scaffolds into `.claude/`, spawns `claude .`, and the user drives the pipeline from chat (ADR-010, `docs/forge-launcher.md:845`). It is not an **execution** harness. `resolveHarness` in `scripts/cli.ts:147-158` offers opencode, copilot, openai, stub. So a repo bootstrapped for Claude Code cannot execute its own manifest with the tool it was scaffolded for.

The gap is sharper than missing parity. Native agent selection is keyed to each transport's own harness root: Copilot checks `.github/agents/` (`copilot-adapter.ts:114-116`), OpenCode checks `.opencode/agents/`. For a `.claude` root both fall back to inlining the persona into the prompt (`SKILL.md:284-295`).

`claude --help` (v2.1.263) exposes `--agent <agent>`, and Claude Code discovers agents from `.claude/agents/`. That makes it the only transport that can select forge agents **natively on the forge's canonical Claude root**.

## What the document covers

- Flag mapping against `copilot-adapter.ts`: `-p`, `--agent` (a real flag, not a `/agent` prompt prefix), `--permission-mode bypassPermissions` as the `--yolo` analogue, `--model` with the same provider-prefix stripping, `CLAUDE_BIN`, `CLAUDE_EXTRA_FLAGS` through the existing `extractModelFlags`.
- The ADR-040 `HarnessAdapter` shape, with `canSelectAgent` keyed to `.claude/agents/` and `FORGE_ENGINE_NATIVE_AGENT=0` keeping its existing meaning.
- Wiring checklist: `cli.ts` in six places, `request.test.ts` transport matrix, `SKILL.md`, `templates/agents/workflow-orchestrator.md`, two docs, and an ADR at 042. No type change needed, engine state types `harness` as `string` (`types.ts:51`).
- Test plan following `copilot-adapter.test.ts`, using the same argv-recording shim with `CLAUDE_BIN`.

## Non-goals, the part worth arguing about

- **No `--fallback-model`.** ADR-040 states `modelFallback` is metadata and does not trigger an execution fallback.
- **No attach or keep-alive mode.** `cli.ts:307` gates `--keep-alive` to opencode, backed by `opencode-server.ts`. Claude Code has `--bg` plus `claude attach` and could support an equivalent later.
- **No `--resume`/`--continue`/`--session-id`.** Tasks stay isolated invocations, as with Copilot. The JSON envelope returns `session_id`, which the adapter logs, so `claude --resume <id>` gives traceability without a flag.
- **No `--bare`.** Ambient CLAUDE.md is intended context on a Claude-bootstrapped repo, and `--bare` would also drop the `.claude/` skills and plugins the adapter exists to use. Operators can opt in through `CLAUDE_EXTRA_FLAGS`.

## JSON from the start

Probing `claude` v2.1.263 showed every failure exits with status 1: not logged in, unknown `--agent`, invalid `--session-id`, max turns. An exit code cannot separate configuration faults from transient ones, so the adapter passes `--output-format json` and classifies on `is_error`, `subtype`, `terminal_reason`, `api_error_status` and `permission_denials`. It unwraps the envelope and returns `result` as `stdout`, so the verifier sees the same final-message text it would in text mode. The full classification table and the raw probe results are in the two documents.

## No launcher mirror to maintain

`scripts/forge-launcher/resources/templates/` is gitignored and regenerated from `templates/` by `scripts/forge-launcher/scripts/stage-resources.mjs` during the launcher's `prepack` script, so a change in `templates/` alone ships correctly. A stale local copy only affects local verification.

## Estimate

Roughly 120 lines of adapter, most of it structurally identical to the Copilot adapter, plus about 160 lines of tests. The larger share is the wiring checklist; the launcher copy regenerates itself at pack time.
```
