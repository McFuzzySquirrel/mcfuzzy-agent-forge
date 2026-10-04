# ADR-065: OpenCode interactive authoring runs in `opencode mini`

Status: Accepted

## Context

MyForge opens a requirements interview in a new terminal and expects a human to
answer it, because requirements authoring is always interactive (ADR-060). The
Console's **Author PRD** button (`POST /api/authoring/session`), the launcher's
printed handoff commands, and the **Model planning terminal** control each build
that invocation themselves, and they each carried their own copy of the
runner-to-argv mapping.

Every one of those copies mapped OpenCode to `opencode --prompt <message>
--model <id>`. That command cannot start:

```console
$ opencode --help            # --standalone --server --auto -c -s --prompt
$ opencode run --help        # --model, -m string   ← the flag lives here
$ opencode --prompt "hi" --model openai/gpt-5
  Unrecognized flag: --model in command opencode
```

In OpenCode v2 the root command accepts `--prompt` but has **no** `--model`; the
flag exists only on the `run` subcommand. So argument parsing fails and the
session never opens.

The blast radius is wider than it looks. `authoringRunnerForHarness` returns
`copilot` for the GitHub harness and `opencode` for *everything else*, so OpenCode
is the default authoring runner for the OpenCode harness, the Claude harness, and
generic `.agents` repositories alike. Anyone who pinned a PRD-stage model and did
not override the runner hit a dead button. It looked intermittent because with
`inherit` there is no `--model` and the same command happens to be valid.

Three constraints rule out the two obvious repairs:

- `opencode run` does take `--model`, but it is the non-interactive path, and
  ADR-060 forbids authoring requirements without a conversation.
- `OPENCODE_CONFIG_CONTENT` would pin the model through config instead, but
  OpenCode resolves config in the background service, which a client-side
  environment variable does not reliably reach.
- Simply dropping `--model` would leave the per-stage model setting silently
  advisory for the default runner — the setting would appear to work while doing
  nothing.

## Decision

**Interactive OpenCode sessions run in the `mini` subcommand**, and all four
copies of the runner mapping collapse into one exported builder,
`interactiveAuthoringArgv`, beside the headless `authoringArgv`.

```ts
copilot  → ["-i", <message>, "--yolo", ...modelArgs]
claude   → [...modelArgs, <message>]
opencode → ["mini", "--prompt", <message>, ...modelArgs]
```

`opencode mini` is the documented minimal interactive interface and is the only
surface that accepts a queued prompt *and* `--model`. A queued `/skill …` prompt
is submitted as a command rather than as prose, so the forge skills still
resolve. `copilot -i` and `claude "query"` are already interactive sessions with
an initial prompt, so their argv is unchanged by this decision.

One path stays deliberately narrow. `forge-launcher resume`'s "open the CLI" step
queues the prompt for OpenCode only; `copilot` and `claude` still open a bare
session there and print the command to paste. Sharing the builder there would
have been tidier, but it would newly auto-approve permissions via `--yolo` in a
step that has always asked — a separate decision from fixing a broken command.

## Consequences

- **Authoring works again on the default runner**, for OpenCode, Claude, and
  generic `.agents` repositories alike, with the PRD-stage model honoured.
- **`mini` is a different interface from the full-screen TUI.** It is a
  prompt-focused split-footer view, which suits an interview; users who prefer
  the full TUI for authoring no longer get it from these buttons.
- **`mini` has no auto-approve flag**, so OpenCode asks you to approve each tool
  call. `copilot -i … --yolo` bypasses permissions, so the two runners now differ
  in how much they prompt. With a human at the keyboard this is the safer
  default, but it is a behaviour change worth knowing about.
- **One mapping, so the next CLI change has one place to land.** The regression
  survived from the feature's introduction (v3.80) precisely because four copies
  of the mapping existed and no test asserted that the argv was parseable. A test
  now pins the rule: no OpenCode argv may carry `--model` unless its subcommand
  is `run` or `mini`.
- **Requirements are still never authored headlessly.** This record exists to
  make that explicit: the fix was constrained by ADR-060, not a relaxation of it.

## Relationships

- Amends [ADR-060](060-interactive-requirements-authoring.md), which made
  requirements authoring always interactive. That decision is what rules out
  `opencode run --auto` here; this record only chooses the interactive surface.
- Amends [ADR-051](051-interactive-authoring-from-console.md), which made
  interactive sessions the primary Console action. Its argv mapping predates
  OpenCode v2 and is superseded by `interactiveAuthoringArgv`.
- Consistent with [ADR-058](058-opencode-v2-project-resolution.md) and
  [ADR-059](059-pwd-aligned-spawn-environment.md): the interactive command takes
  no path argument, and the project is selected by the spawn `cwd`.