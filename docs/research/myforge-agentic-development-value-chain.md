# MyForge in the Agentic Development Value Chain

**Date:** 2026-10-03  
**Status:** Working model: will be updated as the ecosystem and MyForge evolve

---

We have been spending a lot of time and effort in building out MyForge in amongst all the rapid changes happening in both the model and harness world. So it was time for a small pause and reflection: What is MyForge's role in agent-assisted software development, and how does it relate to the growing category of agent harnesses, and, is this something to continue pursuing?

## Reflection

If we think about MyForge and what it was originally build to solve for, it's still worthwhile, both as something to help build solutions and as platform to learn by doing (which may not be for everyones benefit, but is for the creators and collaborators)/

### MyForge and where it sits in the ecosystem and value chain

Well, MyForge could best be described as an **agentic software-development control plane**, or a **meta-harness**. It is not primarily the model/tool loop that powers an individual coding agent. Instead, it sits above harnesses such as GitHub Copilot, Claude Code, and OpenCode and coordinates them around a structured software-delivery process, it is a harness for the development process, implemented on top of agent harnesses.

There are so many harnesses out there, and each offers unique capabilities and can be argued over forever on "what is the best", but what if we could decide to use any one of them, at any stage, depending on the need - what is important is the way in which we want to execute:

```text
Product intent
    ↓
PRD and feature requirements
    ↓
Agent-team and skill design
    ↓
Execution manifest / task graph
    ↓
MyForge workflow engine
    ↓
Harness adapter
    ↓
Copilot / Claude / OpenCode / API model
    ↓
Tools, shell, repository, tests
    ↓
Artifacts, commits, audit trail, human review
```

The underlying harness generally owns model invocation, tool access, the workspace, and the agent loop. MyForge owns the development workflow around those primitives: requirements, decomposition, workforce design, scheduling, state, verification, evidence, and escalation.

You can find this reflected in the repository architecture: the launcher handles intake and bootstrapping, the execution adapter compiles a neutral manifest, the workflow engine executes it, and the Console observes and controls the run
([`ARCHITECTURE.md`](../../ARCHITECTURE.md)).

This is what MyForge adds:

#### 1. Requirements discipline

The PRD and canonical feature documents provide a quality gate before
implementation. They make the intended outcome explicit instead of requiring
every downstream agent to reinterpret a large, ambiguous prompt.

#### 2. Workforce design

MyForge generates specialist agents and skills for the project rather than
assuming one generic assistant can handle every concern. This makes ownership,
constraints, and expected outputs visible before execution starts.

#### 3. A neutral execution contract

The execution adapter compiles authored requirements and ownership into
`docs/EXECUTION-MANIFEST.json`. The manifest separates the description of the
work from the runtime that performs it. That boundary is what makes alternate
harnesses and future external runners possible.

#### 4. Operational autonomy

The workflow engine turns the manifest into a dependency-aware run. It persists
state, dispatches tasks, verifies outputs, retries failures, supports resume and
replay, and records audit events. This is materially different from a
conversation that appears autonomous while a human remains available to steer
each step. See [`docs/workflow-engine.md`](../workflow-engine.md).

#### 5. Evidence and control

Artifacts, validation results, commits, progress, audit events, and human-review
decisions make the run inspectable. The goal is not just to produce code, but
to preserve enough evidence to understand how the code was produced and why a
task was considered complete.

### Why this continues to be valuable

It is easy to just say “more agents”, its harder and more complex to make agent work repeatable enough to become close to an engineering process.

- **Context becomes structured.** Agents consume task contracts and relevant
  artifacts instead of inheriting an ever-growing conversation.
- **Work becomes composable.** Independent tasks can run in parallel; dependent
  tasks can consume deliberately narrow outputs.
- **Failures become operational events.** A failed invocation can be retried,
  inspected, replayed, or escalated instead of disappearing in a chat history.
- **Runtime choice becomes less permanent.** Requirements and workflow logic do
  not have to be rewritten whenever a model or harness changes.
- **Human attention can move upward.** People can focus on scope, architecture,
  acceptance criteria, and consequential review rather than manually relaying
  every task.

The earlier research reached a related conclusion: token efficiency comes primarily from designing narrow information boundaries, not from sequential execution by itself. The useful unit is therefore `task → agent → artifact → task`, not an unrestricted chain of conversations
([`Forge Research`](Forge%20Research.md)).

#### How it differs from adjacent categories

| Category | Primary abstraction | MyForge's relationship |
|---|---|---|
| Coding assistant | Synchronous developer interaction | MyForge can use one as a worker |
| Agent harness | Agent loop, tools, workspace, model/runtime integration | MyForge dispatches through it |
| Agent SDK | APIs for agents, tools, handoffs, guardrails, and tracing | MyForge is a higher-level process built from similar primitives |
| Workflow engine | Durable execution of steps and state | MyForge includes one specialized for software delivery |
| CI/CD | Deterministic build, test, and deployment automation | MyForge adds probabilistic workers before and alongside CI |
| Project management | Planning, ownership, and status | MyForge executes the plan and verifies outputs |
| Software factory | Repeatable conversion of intent into software | This is the closest long-term product metaphor |

### Assessment after reflection

MyForge should not be treated as automatically valuable for every task.

#### It shifts work; it **does not eliminate thinking**

A PRD-first process reduces ambiguity downstream, but a flawed PRD can produce
the wrong result very efficiently. Human effort moves toward scoping, prioritization, architecture, acceptance criteria, and review.

#### Orchestration has a cost

For a small bug fix, creating requirements, manifests, artifacts, and multiple
agent boundaries may cost more than using a single coding agent directly.
MyForge is most compelling for work that is multi-step, cross-cutting, long-running, parallelizable, repeated, or subject to evidence requirements.

#### Verification remains the hard problem

An exit code, changed file, or passing test does not prove that the implementation satisfies the user's intent. MyForge can require validation and make weak evidence visible, but semantic correctness still needs stronger tests, domain checks, and human judgment.

#### Portability is not behavioral equivalence

Harness adapters can standardize invocation, but different runtimes still vary in context handling, tools, permissions, output formats, and reliability.
MyForge can provide workflow portability; it cannot guarantee identical model behavior across providers.

#### Platform vendors may absorb generic features

Agent platforms are adding background execution, custom agents, planning, approvals, logs, and repository workflows. MyForge's durable differentiation therefore needs to be more than task dispatch. Likely differentiators include requirements quality, cross-harness neutrality, domain-specific workflows, measured outcomes, organizational memory, and evidence/governance.

### The future?
What could this become still

#### Agentic CI/CD

The task could become the unit of a new layer beside conventional CI: an agent task with an owner, contract, expected outputs, validation rules, retry policy, and escalation conditions. Traditional CI remains the deterministic evaluator; MyForge coordinates the probabilistic work that creates or changes the code.

#### A requirements compiler

The PRD and feature documents can be treated as a source language:

```text
requirements → tasks → assignments → validations → execution plan
```

The execution manifest then becomes an intermediate representation that different runtimes can consume.

#### Organizational memory

Completed artifacts, review decisions, failures, and validation results could show which agents and workflows work well for particular task types. Over time, the forge could recommend safer decompositions, better validators, and appropriate autonomy levels.

#### Evidence infrastructure

For regulated or high-risk development, the valuable output may include proof that requirements were approved, boundaries were followed, validations ran, and consequential decisions received human review.

#### A software factory

The long-term vision is less “one smart coding agent” and more:

- A repeatable factory that converts approved intent into verified software using interchangeable AI workers.

Humans set direction, constraints, architecture, and acceptance criteria. The factory handles decomposition, implementation, testing, documentation, and routine iteration within those boundaries.

### Working positioning

- **MyForge is not primarily another coding agent; it is the coordination,contract, and evidence layer that makes multiple coding agents usable as a repeatable software-delivery system.**

Its long-term success should be measured by outcomes—quality, lead time, rework, review burden, recovery from failure, and traceability—not by the number of agents or automation steps it can produce.

## Conclusion

It still worth working on and learning from, there are learnings and concepts we pickup that can be applied individually to other future problems or endevours, not specificallt this one, but MyForge still has its place.
