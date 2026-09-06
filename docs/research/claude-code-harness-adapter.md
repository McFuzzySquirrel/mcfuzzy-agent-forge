# Scoping: a Claude Code harness adapter for the workflow engine

**Date:** 2026-09-07
**Status:** Proposal, not yet implemented
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
| Non-interactive invoke | `copilot -p "<prompt>"` | `claude -p "<prompt>"` |
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

`invoke(request)` follows the Copilot body almost line for line: build args, `runCommand` with
`cwd: repoRoot`, `timeoutMs: request.budget.timeoutMs`, `signal: request.signal`,
`maxBufferBytes: 10 * 1024 * 1024`, then the same three-branch result mapping (transport error,
non-zero status, success with `expectedOutputs` existence filtering).

Argument construction is where it diverges:

```ts
const native = this.canSelectAgent(request);
const prompt = native
  ? request.instructions
  : [inlinePersona(request), request.instructions].join("\n\n");
const agentFlag = native ? ["--agent", agent.name] : [];
const modelFlag = request.effectiveModel
  ? ["--model", stripProviderPrefix(request.effectiveModel)]
  : [];
const args = ["-p", prompt, ...agentFlag, ...modelFlag, ...this.extraFlags];
```

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

## Deliberate non-goals for v1

- **No `--fallback-model`.** ADR-040 states `modelFallback` is metadata and does not trigger an
  execution fallback. Wiring it would breach the contract the engine owns.
- **No attach or keep-alive mode.** `cli.ts:307` gates `--keep-alive` to opencode, backed by
  `opencode-server.ts`. Claude Code has `--bg` plus `claude attach` and could support an
  equivalent later, but that is a second body of work with its own state handling.
- **No `--resume` or `--continue`.** Each task stays an isolated invocation, as with Copilot.
  `--session-id <uuid>` derived from `runId` and task id is a cheap traceability win and can
  follow.
- **Text output, not JSON.** `--output-format json` would give structured `is_error` and
  `subtype` fields, which map far better onto `TaskFailureKind` than an exit code does. It is
  the right eventual answer and the wrong first step: it changes what `stdout` means to the
  verifier. Ship text parity first, then propose JSON as its own change.

## Known behavioral wrinkles

- **CLAUDE.md auto-discovery.** `claude -p` at `repoRoot` loads the project CLAUDE.md on top of
  the injected persona. Copilot and OpenCode have comparable ambient context, so this is not
  novel, but it does mean the persona is not the only instruction source. `--bare` would
  suppress it at the cost of hooks, skills resolution, and plugin sync. Document, do not
  suppress.
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

**Do not forget the launcher mirror.** `scripts/forge-launcher/resources/templates/skills/forge-workflow-engine/`
carries a full duplicate of the engine, harness directory included. A change that lands only in
`templates/` ships a launcher that cannot select the new harness.

## Test plan

`copilot-adapter.test.ts` provides the pattern: a shim binary recording its argv, with
`COPILOT_BIN` pointed at it. The Claude cases, with `CLAUDE_BIN`:

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
7. Non-zero exit maps to `failureKind: "retryable"`; a spawn failure maps through
   `result.failureKind` unchanged.

## Estimate

The adapter itself is roughly 120 lines, most of it structurally identical to the Copilot
adapter, plus about 160 lines of tests. The larger share of the work is the wiring checklist and
keeping the launcher mirror in step. One focused change, not a project.
