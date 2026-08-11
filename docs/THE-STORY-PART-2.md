---
layout: post
title:  "The Story of Agent Forge, Part 2: From Framework to Factory"
date:   2026-08-11 19:00:00 +0200
categories: personal update
---

# The Story of (McFuzzy) Agent Forge, Part 2: From Framework to Factory

> *Part 1 ended with a methodology, a growing component library, and ten principles. Part 2 is about what happened when those foundations were stress-tested: when users wanted better quality gates, fewer manual steps, a one-command start, and - ultimately - a build pipeline that could run itself.*

If Part 1 was about learning *how to design* agent teams, Part 2 is about learning *how to ship them faster and more reliably* - and then realizing that the framework itself needed to become an autonomous actor.

---

## Chapter 14: The Quality Problem - Skills Were Good, But Were They Good Enough?

After the v2 harness migration had settled, an uncomfortable question surfaced. The framework was generating skills. The team builder created project-specific skills through its structured process. But *how good were those skills, actually?*

The `forge-optimize-skills` audit could tell you what was wrong after the fact. And the agent template had strong conventions. But the creation process itself had no quality gate. A skill could be written, accepted, and handed to agents without anyone - human or AI - ever verifying that it met a minimum standard.

The consequence was subtle but damaging. A skill that scored below 2.0 on the quality rubric didn't *fail* visibly. It just produced inconsistent results. Agents following it would sometimes get lost, sometimes skip steps, sometimes produce outputs that didn't match expectations. The problem was hard to diagnose because it looked like agent misbehaviour, not a skill quality problem.

The answer was already sitting in a companion repository: **[skill-forge](https://github.com/McFuzzySquirrel/skill-forge)**.

Skill-forge had developed three capabilities that Agent Forge was missing:

- **`skill-creator`**: a five-step guided creation workflow - interview, template selection, scaffold, pre-flight check, validation loop. Not a template you fill in; a *process* that won't let you finish until the skill is good.
- **`skill-review`**: a six-axis automated audit with portable TypeScript tooling. It could run in CI, post comments on pull requests, and block merges if skills fell below a minimum score.
- **`skill-review-updater`**: a six-step workflow that keeps the rubric itself current as best practices evolve.

The integration decision (ADR-008) had two parts. First: bring all three skills into the forge templates. Second: remove `forge-build-agent-framework-solution`. That skill scaffolded .NET and Python projects for Microsoft Agent Framework, which was a narrow, platform-specific concern that didn't belong in a framework-agnostic tool. Users who needed it could build it themselves - with `skill-creator`.

The `forge-build-agent-team` skill gained a mandatory `skill-creator` gate: for every reusable skill it identified, it now had to run `skill-creator` and then pass `skill-review` scoring every axis ≥ 2.0 *before* handing the skill to any agent. If `skill-creator` wasn't present in the repository, the team builder stopped and said so explicitly - no silent fallback.

The result was a framework that had grown a conscience about its own output quality. Skills weren't just *created*; they were *validated*. And the validation wasn't optional.

### The Takeaway for Builders

> **A quality gate at creation time is worth ten quality reviews after the fact.** Catching a skill below 2.0 before any agent depends on it is orders of magnitude cheaper than diagnosing inconsistent agent behaviour two weeks later. Build the gate into the happy path, not the exception path.

---

## Chapter 15: The Automation Paradox - Powerful Steps, Too Many of Them

With skill quality solved, a new friction became the loudest complaint: **the pipeline was powerful, but using it required too many separate invocations**.

The standard flow was:
1. Run `forge-build-prd` - review the PRD
2. Run `forge-build-agent-team` - review the team
3. Optionally run `forge-assign-models` - review the assignments
4. Run the `project-orchestrator` - approve each phase

Four separate commands. Three or four explicit approval gates. For a project with a clear, well-understood scope, those gates added no value - they just slowed the user down.

`forge-bootstrap-project` (introduced in ADR-004) had partially addressed this by chaining PRD generation and team building with mandatory review gates between them. But it deliberately stopped before build execution, because phase-by-phase review was considered the safe default.

The missing piece was a **fast path**: a single invocation that would chain the *entire* pipeline - idea through deployed codebase - with exactly one gate, then run to completion autonomously.

That became `forge-auto-build` (ADR-009).

The design philosophy was intentionally different from `forge-bootstrap-project`. Where `forge-bootstrap-project` said "pause after every major artifact," `forge-auto-build` said "show everything up front in a pre-flight summary, get one explicit GO, then run unattended until done."

The pre-flight summary showed the user everything they were about to approve: the input source (explicit idea, detected `docs/PRD.md`, or detected `docs/IDEA.md`), the planned stages, the commit strategy, and any repo-state warnings (existing PRD, existing agents, detected mode). Once the user typed `GO`, the engine ran - PRD generation, team building, optional model assignment, all build phases - with validation and commits after each phase.

There was also a subtlety in input detection. When invoked without arguments, `forge-auto-build` needed to figure out what to build from. The resolution order (ADR-013) became: explicit user input first, then `docs/PRD.md`, then `docs/IDEA.md`, then root `IDEA.md`. If multiple candidate sources existed, it asked the user to choose. This meant the skill was useful both for a brand-new project (where you'd just typed your idea into the terminal) and for a repository that already had a PRD waiting.

### The Takeaway for Builders

> **The right level of automation depends on the user's confidence, not the framework's caution.** Build both paths: one with mandatory review gates for users who want to stay in the loop, and one with a single gate followed by full autonomy for users who know what they want. Don't make the cautious path the only option.

---

## Chapter 16: The Activation Problem - "How Do I Actually Start?"

With `forge-auto-build` handling the pipeline, there was still a barrier that no skill could solve: **getting to the starting line in the first place**.

Before you could run any skill, you needed:
1. A Git repository, locally or on GitHub
2. Agent Forge bootstrapped into that repository
3. Knowledge of which harness to use
4. The correct bootstrap flag for that harness
5. The right incantation to start `forge-auto-build` in your chosen harness

Five steps of prerequisite knowledge, all undocumented in a single place, all requiring the user to know what they were doing before the framework could help them.

This wasn't a documentation problem. It was an **onboarding problem**. And the right solution to an onboarding problem isn't more docs - it's a guided experience.

That became `forge-launcher` (ADR-010).

The design constraint was sharp: no new dependencies. The launcher had to work with the tools users already had - `git`, optionally `gh` (GitHub CLI), optionally the harness CLIs. Pure Bash on Linux/macOS, pure PowerShell on Windows. Nothing else.

Within that constraint, the launcher orchestrated nine steps in one terminal session:

1. **Pre-flight**: check `git`, `gh`, `opencode`, `claude` availability - missing optional tools just disabled the features that depended on them
2. **Harness selection**: choose between GitHub Copilot, opencode, Claude Code, or generic `.agents` - the choice determined *everything* downstream
3. **Repo creation**: create a GitHub repo via `gh`, or `git init` a local one with an optional remote
4. **Bootstrap**: run `bootstrap.sh` (or `bootstrap.ps1`) into the new repo with the correct `--harness` flag
5. **Idea capture**: prompt for the project idea, save it to `docs/IDEA.md` (and mirror to root `IDEA.md`)
6. **PRD and research**: optionally copy in an existing PRD or paste one directly; optionally add seed documents to `docs/research/`
7. **Commit**: commit everything and push
8. **Auto-build launch**: spawn `opencode .` or `claude .` in a new terminal if available; print fallback instructions otherwise
9. **Summary**: display the repo path, harness, and next-step commands

Step 6 deserves a note. The `forge-build-prd` skill had always supported starting from research documents as well as a blank slate. But nothing in the existing tooling *guided* users to prepare those materials before starting. Step 6 added that guidance: "Do you have an existing PRD? Do you have research or design notes? If yes, bring them now - the pipeline produces significantly better results with a richer starting point."

It was also non-interactive from the start. Set environment variables (`FORGE_HARNESS_CHOICE`, `FORGE_REPO_NAME`, `FORGE_IDEA`, etc.) and pass `--non-interactive`, and the entire nine-step flow ran unattended. That made it testable in CI, and a functional test script (`test-forge-launcher.sh`) verified the expected directory layout for every harness.

One harness required an extra fix (ADR-015): the opencode bootstrap path had been writing templates to `.agents/` instead of `.opencode/`. A small but important correction - because if your skills land in the wrong directory, your harness can't find them, and the whole point of harness selection evaporates.

### The Takeaway for Builders

> **An onboarding barrier is a capability barrier.** It doesn't matter how powerful your pipeline is if users can't reach the first step. Invest in the zero-to-running experience the same way you invest in the feature set. A guided, interactive start is not a luxury - it's the product.

---

## Chapter 17: The Contract Problem - Bridging Agent Forge and the Outside World

With `forge-auto-build` and `forge-launcher` in place, Agent Forge had become genuinely end-to-end: idea to shipped build in one session. But a new category of users started asking a question the framework had no answer to:

*"Can Agent Forge's output drive an external build system? Can I run the pipeline in CI, or hand it off to a FlowForge-style runner, or integrate it with a tool that isn't a conversational AI harness?"*

The problem was structural. Agent Forge's execution model was *conversational*: an orchestrator agent read the PRD, read the team files, and issued natural-language task instructions. That worked beautifully inside a chat harness. It was completely opaque to anything outside one.

What was missing was a **neutral contract** - a machine-readable document that described the build graph in a way any system could understand.

That became `forge-execution-adapter` (ADR-011): a portable TypeScript tool that compiled `docs/EXECUTION-MANIFEST.json` from the existing forge artifacts.

The manifest captured everything an external runner needed to know:
- Every phase and task
- Which agent owned each task
- Dependencies between tasks (the execution DAG)
- Expected outputs and validation commands
- Harness-specific metadata

The adapter also handled the other direction: keeping `docs/PROGRESS.md` in sync when an external runner reported task completion, and appending `docs/EXECUTION-AUDIT.jsonl` as an append-only event log for auditability.

The design decision that made this useful was keeping it *separate from the authoring pipeline*. The adapter was not a new step in `forge-auto-build`. It was a standalone tool you ran when you wanted a manifest - and when you didn't need one, you didn't have to think about it. The existing conversational orchestration path was completely unchanged.

### The Takeaway for Builders

> **Separate the contract from the implementation.** A neutral, machine-readable representation of your pipeline's output is what enables interoperability. If your execution model is baked into your authoring format, you can't integrate with anything that doesn't speak your language. Compile a clean contract and let anything consume it.

---

## Chapter 18: The Autonomy Problem - "Who Drives the Manifest?"

The execution manifest existed. The adapter could compile it. But there was a gap that the manifest itself made visible by existing: *something still needed to actually read it, drive the execution, and do so without a human in the loop*.

The existing paths all terminated at a conversational instruction. `forge-auto-build` was autonomous *within a chat session* - but a chat session was still a human-supervised environment where the harness could ask follow-up questions, and where the session ending meant the work stopped. The manifest was a machine-readable document sitting in a repository, pointed at nothing.

Three gaps defined the problem (ADR-014):

1. **No runtime driver.** Every execution path ended at "call this agent now." There was no process that picked up `EXECUTION-MANIFEST.json` and autonomously dispatched invocations, waited for results, retried failures, and advanced the task graph - without a human observing.

2. **No machine-readable run state.** `PROGRESS.md` was readable by humans. It was not readable by a process that needed to know, at boot, exactly which tasks were complete, which were pending, and how many retries remained.

3. **No harness abstraction.** Teams running Agent Forge builds in CI pipelines, scheduled jobs, or non-chat contexts had no integration path.

The solution was `forge-workflow-engine` (v3.5): a Node.js skill that read the manifest, built a live task DAG, and drove execution to completion.

The engine's most important design choice was what it was called: **dark orchestration**.

The term needed explaining, and it got a clear one in the testing guide: *dark orchestration means background execution with no human in the loop*. Once the pre-run gate is accepted, the workflow engine dispatches agent invocations, waits for results, retries failures, and advances the task graph on its own. You do not need to approve each step. Think of it the same way you would a CI/CD pipeline: it runs "in the dark" (unattended) until it finishes or hits a blocker that genuinely needs human input.

That is the explicit opposite of the conversational `project-orchestrator` flow. Both are valid. The difference is one pre-flight gate versus a gate at every phase boundary.

The engine shipped with three harness adapters: `OpenCodeAdapter` (shells out to `opencode run`), `OpenAIAdapter` (direct API), and `StubAdapter` (synthetic results for testing). The CLI supported `run`, `status`, `replay`, and `pause`. Machine-readable run state went to `docs/WORKFLOW-STATE.json`; human-readable progress synced to `docs/PROGRESS.md` continuously; every state transition appended to `docs/EXECUTION-AUDIT.jsonl`.

Resume was a first-class feature from day one. Kill the engine mid-run, restart it, and it reads `WORKFLOW-STATE.json` and picks up from the last incomplete task. Tasks already marked `complete` are never re-run. Replay let you re-run a single failed task without touching anything else.

The engine was deliberately scoped to *start where `forge-execution-adapter` ended*. It did not do PRD authoring, team generation, model assignment, or manifest compilation. It did not replace `forge-auto-build` or `project-orchestrator`. It was the runtime layer that the execution adapter's output had been waiting for.

The testing guide added to this release made the distinction concrete: a step-by-step manual verification protocol covering skill quality gates, manifest compilation, the pre-run gate, autonomous execution, state sync, resume, retry, and replay - and, critically, a Part 3 that combined `forge-launcher` with dark orchestration into a single end-to-end test: from zero to autonomous build in one terminal session.

### The Takeaway for Builders

> **"Autonomous" is a spectrum.** A chat session where the AI does the work while you watch is semi-autonomous. A process that reads a machine-readable contract, drives execution, handles failures, and resumes across sessions without a human in the loop is fully autonomous. Build toward the latter deliberately, step by step - a neutral contract first, then a runtime that consumes it. Don't skip the contract.

---

## Chapter 19: The Whole Picture - What Agent Forge Became

Let's zoom out again, the way Part 1 did.

Part 1 ended with Agent Forge as a **framework**: a set of principles, skills, and agents that turned ideas into coordinated agent teams. Part 2 added a **factory**: the automation, onboarding, quality gates, integration contracts, and autonomous runtime that make the framework work at scale.

Here is the full picture, extended from the Part 1 diagram:

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                      forge-launcher                          │
                    │  (repo create → harness select → bootstrap → idea capture   │
                    │   → PRD + research → commit → auto-build launch)            │
                    └───────────────────────────┬─────────────────────────────────┘
                                                │
                                                ▼
  ┌────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌────────────────────┐
  │  Your Idea  │──→│  PRD Builder  │──→│   Team Builder    │──→│  forge-auto-build  │
  │ (IDEA.md)  │   │              │   │  + skill-creator  │   │  (single GO gate)  │
  └────────────┘   └──────────────┘   │  + skill-review   │   └────────┬───────────┘
                                      └──────────────────┘            │
                                                                       │
                          ┌────────────────────────────────────────────┘
                          │
                          ▼
         ┌────────────────────────────┐
         │   forge-execution-adapter   │
         │  (compile EXECUTION-        │
         │   MANIFEST.json)            │
         └────────────┬───────────────┘
                      │
                      ▼
         ┌────────────────────────────┐
         │   forge-workflow-engine     │
         │  (dark orchestration:       │
         │   DAG → dispatch → retry   │
         │   → state sync → audit)    │
         └────────────────────────────┘
```

The new components added in Part 2:

| Component | What It Does | Why It Exists |
|-----------|-------------|---------------|
| `skill-creator` | Five-step guided skill creation with quality gate | Skills needed to be validated at creation time, not discovered to be poor after agents depended on them |
| `skill-review` | Six-axis automated audit with portable TypeScript CLI | Quality without tooling is just intention |
| `skill-review-updater` | Keeps the rubric current | Quality criteria evolve; the audit must evolve too |
| `forge-auto-build` | Entire pipeline in one command, single pre-flight gate | Users with clear scope shouldn't need to approve every intermediate artifact |
| `forge-launcher` | Zero to auto-build in one terminal session | Activation cost was a capability barrier for new users |
| `forge-execution-adapter` | Compiles `EXECUTION-MANIFEST.json` | A neutral contract enables integration with any execution backend |
| `forge-workflow-engine` | Reads the manifest and drives autonomous execution | The contract needed a runtime; dark orchestration closes the loop |
| `workflow-orchestrator` agent | Human-facing companion for the engine | The engine needed a face - something to report to and escalate blockers to |
| `docs/testing-guide.md` | Step-by-step manual verification protocol | Autonomous systems need verifiable behaviour; the testing guide makes it testable |

---

## Chapter 20: The New Principles - What Part 2 Taught

Part 1 ended with ten principles. Part 2 adds to them.

**11. Quality gates belong at creation time, not review time.** A skill that scores below 2.0 before any agent depends on it is a problem you can fix in five minutes. The same problem discovered through agent misbehaviour two weeks later costs orders of magnitude more to diagnose and fix. Build the gate into the process, not the exception.

**12. One gate is often enough.** If your framework requires users to approve every intermediate artifact, you've trained them to rubber-stamp approvals. Show everything in a pre-flight summary, get one explicit GO, then run to completion. Reserve mandatory gates for decisions that genuinely require human judgment.

**13. Activation cost is a capability barrier.** It doesn't matter how powerful your pipeline is if users can't reach the first step. Invest in the zero-to-running experience as seriously as you invest in features. A guided start isn't a luxury - it's the product.

**14. A neutral contract enables interoperability.** If your execution model is baked into your format, nothing else can consume it. Compile a clean machine-readable representation of your pipeline's output, and let any backend consume it. Decouple the contract from the implementation.

**15. "Autonomous" is a spectrum - build toward the far end deliberately.** Semi-autonomous (AI does work while human watches) is not the same as fully autonomous (runtime reads contract, drives execution, handles failures, resumes across sessions). Each step toward autonomy requires a new component: a contract first, then a runtime that consumes it. Don't skip the contract.

**16. Verify your autonomous systems manually before you trust them.** Dark orchestration running unattended is powerful. It is also opaque. A step-by-step testing protocol that walks through every observable behaviour - the pre-run gate, autonomous dispatch, state sync, resume, retry, replay - is what transforms "I think it works" into "I have verified it works." Write the testing guide.

---

## Epilogue for Part 2: The Framework That Builds Itself

There's a recursive dimension to everything in Part 2 that's worth naming explicitly.

Agent Forge v3.x uses `skill-creator` and `skill-review` to build and validate the skills that `forge-build-agent-team` generates. Those skills were themselves created and validated by the same tools. The `forge-workflow-engine` that drives autonomous builds was bootstrapped by the same `forge-launcher` experience it is now part of. The testing guide that verifies dark orchestration was written to cover the same workflow it describes.

The tools improved the tools. The framework built itself.

And at every layer, the same forcing function held: **write it down**. Research documents before implementation. ADRs alongside decisions. A testing guide before declaring something reliable. The act of writing is still the act of thinking.

Part 1 asked: *"What if AI could work like a real team?"*

Part 2 answers: *"What if that team could build the next team - and the one after that - without you standing in the loop for every step?"*

---

*This is the continuation of the story. Part 1 covered the foundations. Part 2 covered what happened when those foundations were stress-tested and extended to their logical conclusion: an autonomous build pipeline that starts with an idea and ends with a shipped project, with exactly as many human decisions in the middle as the project actually requires.*

*The principles still hold. The tools keep changing. The process keeps working.*

---

**Made with ❤️ and a lot of research documents by [McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
