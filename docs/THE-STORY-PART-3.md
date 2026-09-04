---
layout: post
title:  "The Story of MyForge, Part 3: From Factory to Workbench"
date:   2026-09-04 08:00:00 +0200
categories: personal update
---

# The Story of MyForge, Part 3: From Factory to Workbench

> *Part 2 ended when MyForge could take a reviewed plan, compile a contract, and run the build autonomously. Part 3 is about what happened next: when autonomy met real projects, real interruptions, existing codebases, and the need for a control surface humans could actually live in every day.*

If Part 2 was about turning a framework into a factory, Part 3 is about turning that factory into a **workbench**: something you can stop, inspect, steer, extend, and reuse without starting from a blank slate every time.

---

## Chapter 21: The Visibility Problem - Dark Orchestration Needed a Window

Once `forge-workflow-engine` existed, MyForge could run in the dark. That was the point. But dark orchestration immediately produced a new problem: if a build was running detached, where exactly did you *look*?

The raw ingredients already existed. `WORKFLOW-STATE.json` held machine-readable truth. `PROGRESS.md` held the human summary. `EXECUTION-AUDIT.jsonl` held the event stream. `engine-run.log` held the noisy details. But using them meant terminal spelunking across files and commands, with the Forge Board as the only visual surface.

That was enough for a prototype. It was not enough for daily use.

The answer was not "replace the CLI." The answer was **project the CLI into a new surface**. That became the Forge Console: a loopback-only local web UI over the same launcher and engine commands, backed by the same files, with the same pause/stop/resume/replay controls.

That decision mattered because it kept the architecture honest. The Console did not become a second system with its own runtime model. It remained a projection layer over the one that already worked.

### The Takeaway for Builders

> **When observability is built from the same artifacts as execution, your UI stays honest.** Don't invent a second state model just because you built a dashboard. Project the real system, or the dashboard will drift into fiction.

---

## Chapter 22: The Control Problem - Autonomy Is Only Useful If It Can Pause

A fully autonomous run sounds clean in theory. In practice, users needed to interrupt it, resume it later, retry one broken task, or run only a carefully chosen slice of work.

That led to a series of changes that look small individually but add up to a philosophical shift:

- graceful pause and stop through a control channel,
- persisted engine configuration so resume means *resume*, not "retype your flags from memory,"
- manual pre-build that stops at manifest creation,
- manual execution mode for selected tasks,
- per-task timeout editing,
- auto-commit after each task so every checkpoint is reviewable in Git.

This is where the engine stopped being just an autonomous runner and became an **operator-friendly runtime**. The system learned that autonomy without interruption is brittle, and interruption without durable state is chaos.

There was also a subtler lesson hiding in the concurrency work. Parallel dispatch was attractive, and the ready-frontier model supported it. But once output verification and artifact attribution depended on repository-wide worktree snapshots, safety won over headline speed. The framework learned - again - that a capability you cannot trust is not really a capability.

### The Takeaway for Builders

> **Control is part of autonomy, not the opposite of it.** A system becomes more autonomous when it can survive pause, resume, replay, and review boundaries without losing coherence.

---

## Chapter 23: The Blank-Slate Assumption - Most Real Projects Already Exist

Early MyForge flows assumed the same thing many greenfield tools assume: that the project starts with an idea file and an empty repository waiting to be shaped.

Real users broke that assumption immediately.

They already had code. They already had tests. They already had architecture, naming, and constraints embodied in a running application. What they needed was not "start over with MyForge." They needed: **"teach MyForge about what already exists, then help me change it safely."**

That requirement drove a new direction:

- bootstrap Forge into an existing repository without replacing the app,
- author a project PRD from the codebase itself when no `IDEA.md` exists,
- add Feature PRDs under `docs/features/` instead of rewriting the original PRD,
- update only the affected team members,
- recompile the canonical manifest while preserving stable task state,
- explicitly surface added, removed, and changed task contracts for review.

This was a major shift in what MyForge was *for*. It was no longer just a system for birthing new projects. It became a system for **continuing existing ones**.

That may be the most important transition since Part 1. A framework proves itself not when it handles the clean-room demo, but when it can enter a messy, already-lived-in codebase and still improve the work.

### The Takeaway for Builders

> **Your framework is only mature when it can join work already in progress.** Greenfield flows are necessary. Brownfield flows are the real test.

---

## Chapter 24: The Planning Problem - One Team Is Not One Model

As the project team model matured, another simplification started to hurt: assuming one default model choice was good enough for everyone.

It wasn't.

Different agents have different jobs. A reviewer does not need the same model profile as an architect. A lightweight implementation task does not need the same budget as a high-stakes decomposition step. And a local environment only knows what is actually available if you ask it live.

So MyForge learned to separate three things that had previously blurred together:

1. **What models exist right now** in the user's actual environment.
2. **What the framework recommends** for a given agent role.
3. **What the operator overrides** for this project, on purpose.

That produced live model inventory, agent-level primary/fallback overrides, a `model-overrides.json` contract, and dedicated model-planning terminals in the Console. It also exposed a practical portability lesson: different runtimes want model IDs in different forms. Some paths need provider-qualified IDs preserved. Others need canonical IDs for metadata and comparison.

The lesson was bigger than model names. It was about **keeping recommendations, availability, and user intent as separate layers**.

### The Takeaway for Builders

> **A recommendation is not an override, and an override is not availability.** Keep those concepts separate or your runtime will confuse policy with reality.

---

## Chapter 25: The Documentation Problem - A Fast-Moving Tool Can Outrun Its Own Explanation

By this point MyForge had gained a Console, detached job tracking, feature increments, manifest reconciliation, model planning, manual execution controls, and a long list of operator quality-of-life improvements.

That success created a new failure mode: the docs started lagging the product.

The user guide had to move into the Console. Quick help had to match the actual screens. Deep dives had to explain not just the architectural ideal, but the *current runtime truth* - including places where the system had intentionally become more conservative in order to stay correct.

This matters more than it sounds. In an agent framework, documentation is not a marketing layer. It is part of the execution environment. Agents read it. Humans trust it. Future changes inherit from it.

So Part 3 includes a quieter but essential kind of work: tightening the correspondence between system behavior and written explanation.

### The Takeaway for Builders

> **In an AI-native toolchain, docs are operational infrastructure.** If the docs drift, the humans drift, the agents drift, and eventually the product drifts.

---

## Chapter 26: The Whole Picture - What MyForge Became After Part 2

Part 2 ended with MyForge as a **factory**: it could take a plan, compile a contract, and run an autonomous build.

Part 3 adds the **workbench** around that factory:

- a Console for visibility,
- pause/stop/resume/replay for control,
- task-scoped/manual execution for selective work,
- per-task commits for reviewable history,
- existing-repository bootstrap and Feature PRDs for continuity,
- reconciliation-aware manifest updates for safe iteration,
- model inventory and overrides for agent-level tuning,
- richer logs and lifecycle events for observability.

The center of gravity moved from "can MyForge build a project end-to-end?" to a harder question:

**"Can MyForge stay useful after the first build, when the project becomes a long-lived system with history, interruptions, constraints, and incremental change?"**

That is a better question. And the product got better because users forced it into the harder terrain.

---

## Chapter 27: The New Principles - What Part 3 Taught

Part 3 adds another set of principles to the ones from Parts 1 and 2.

**17. Observability should be a projection of real state, not a parallel fiction.** If your UI is backed by a second interpretation of the system, it will eventually lie. Build views over the canonical artifacts.

**18. Safe interruption is a feature, not an escape hatch.** Pause, stop, resume, replay, and task selection are part of a serious autonomous runtime.

**19. Existing codebases are first-class input.** A framework that only shines on blank-slate projects hasn't earned the right to call itself general.

**20. Separate availability, recommendation, and operator choice.** This applies to models, tools, and eventually any runtime dependency.

**21. Documentation is part of the runtime.** In a system used by both people and agents, stale docs are not just inconvenient - they are a source of wrong execution.

---

## Epilogue for Part 3: The Tool That Had To Learn to Rejoin Its Own Work

The recursive idea from Part 2 still holds: the framework keeps improving itself.

But Part 3 adds a new layer to that recursion. It is not enough for MyForge to create artifacts. It has to come back later, read those artifacts, understand what changed, preserve what still matters, and continue the work without pretending history didn't happen.

That is true for a build system. It is also true for the builder.

Part 1 asked: *"What if AI could work like a real team?"*

Part 2 asked: *"What if that team could build the next team without you in the loop for every step?"*

Part 3 asks: *"What if that team could come back to yesterday's work, understand the current project, and keep going without losing the thread?"*

---

*This is the continuation of the story. Part 3 covers what happened after autonomous execution existed: the move from factory to workbench, from greenfield assumptions to existing-repo reality, from detached runs to real operator surfaces, and from one-shot builds to iterative project life.*

*The process still works. The constraints got more real. That is why the lessons got better.*

---

**Made with ❤️ and a lot of research documents by [McFuzzySquirrel](https://github.com/McFuzzySquirrel)**
