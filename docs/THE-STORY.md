---
layout: post
title:  "The Story of Agent Forge: Building an AI Development Team from Scratch"
date:   2026-03-20 21:45:00 +0200
categories: personal update
---

# The Story of (McFuzzy) Agent Forge: Building an AI Development Team from Scratch

> *How a simple question: "What if AI could work like a real team?", became a framework that turns ideas into coordinated agent teams.*


## The Spark

It started with a frustration that every person who is working with agentic AI knows.

You're sitting with GitHub Copilot, this incredibly powerful AI assistant, and you ask it to build something complex. A web application, maybe. Authentication, database layer, API endpoints, frontend components, testing, an awesome game. The AI dives in, and it's impressive… at least for a while. But then you notice the cracks. It forgets the authentication approach it chose when it moves to the API layer. It makes frontend decisions that conflict with the backend architecture it just created. It's like asking one person to be the architect, the plumber, the electrician, the interior designer and the architect all at once. They *can* do all of those things, but not with the same depth and consistency as specialists who coordinate.

That frustration led to a question that changed everything:

**"What if, instead of one AI doing everything, we had a *team* of AI specialists, each an expert in their domain, working together like a real development team?"**

A practical one: *Can we actually build this, today, with the tools we have?*

We know the answer is yes, beacuse orchestrated multi-agent systems are in place and there are many ways people, and systems are doing this today. The journey to get there, after exploring all the options out there, and expanding on that, is what this document is about.

---

## Chapter 1: Starting with the Problem, Not the Solution

The first instinct was to jump straight into code. Build some agents, wire them together, see what happens. But experience whispers: *that's how you build something that works for the demo but falls apart in the real world.*

Instead, the process started with a deliberate step back, and one I believe is the constant in this ever-changing world. Before writing a single line of agent definition, three questions needed answers:

1. **What does a "team" actually mean in the context of AI agents?** A team isn't just multiple agents: it's agents with clear roles, defined boundaries, and a way to coordinate. A frontend specialist shouldn't be writing database migrations. A QA engineer shouldn't be designing the API schema.

2. **How do real development teams organize?** They start with **requirements**. Someone figures out *what* to build (the product manager, the PRD). Someone decides *who* builds *what* (the tech lead, the team structure). And someone coordinates the work (the project manager, the execution plan). That's three distinct phases: requirements -> team -> execution.

3. **What already exists that we can build on?** Most systems like GitHub Copilot, Claude, etc. already supports custom agents, I use GitHub Copilot (markdown files in `.github/agents/`) and skills (reusable process files in `.github/skills/`). The infrastructure was there. What was missing was the *system* for creating and coordinating them.

These three questions became the blueprint. Not a technical specification: a *way of thinking* about the problem.

### The Takeaway for Builders

> **Don't start with "what should I build?" Start with "what problem am I actually solving?" and "how do humans already solve this?"** The best frameworks mirror real-world processes that already work. AI agent teams work because real development teams work, we just translated the pattern.



## Chapter 2: The PRD-First Epiphany

Here's where the first major design decision happened, and it's one that shaped everything that followed.

The initial temptation was to build agents that could figure out what to build on their own. Give them a vague description, let them decompose it, and watch them go. It sounds cool. It's also a terrible idea.

Why? Because **AI agents follow instructions faithfully**. If the instructions are vague, the output is vague. If the requirements are ambiguous, the agents will resolve that ambiguity in ways you can't predict,nand different agents will resolve it differently. You end up with a frontend that expects data the API doesn't provide, tests that validate the wrong behavior, and an architecture that no one actually agreed on.

The solution was both obvious: **start with a Product Requirements Document (PRD)**, this has been the start long before agentic AI and agents became a thing. 

Not because PRDs are trendy. Because a PRD is a *single source of truth* that every agent can reference. When the API engineer needs to know what endpoints to build, they check the PRD. When the frontend specialist needs to know what data to display, they check the PRD. When the QA engineer needs to know what "correct" means, they check the PRD. No ambiguity. No conflicting interpretations.

Now some people do start this way, and sometimes its called a **Specification (Spec)** but a lot of people never have, they may have the all the research, but they get lost on how to structure it.

So I came to a second realization that made this even more powerful: if you dont already have a PRD, then there should at least be an option where **the PRD itself could be built by an AI agent, through a structured conversation with the human.**

This became the first skill: `forge-build-prd`. Not a template you fill in. A *process*: an AI-guided interview that asks you the right questions across ten categories (scope, functional requirements, technical constraints, security, accessibility, design, testing, delivery, risks, dependencies), synthesizes your answers, and produces a comprehensive PRD.

But here comes the cool part, if you already have one, you can point it to that, if you have a whole bunch of research and notes, you can also point it at that, you dont need to start from scratch if you have already done most of the work.

Now the experience of building this first skill taught me a crucial lesson:

> **Skills are processes, not templates.** A template says "fill in section 3." A process says "let me ask you about section 3, challenge your assumptions, research whether your tech choices are current, and *then* write section 3." The difference is enormous.

### The Takeaway for Builders

> **Give your AI agents a single source of truth before you let them do anything.** The quality of your agents' output is directly proportional to the quality of their input. A PRD isn't bureaucracy, it's the foundation that prevents your agent team from building six different interpretations of the same project.



## Chapter 3: Designing the Team Builder

With the PRD skill working, the next challenge was translating a PRD into an agent team. This is where the framework's core innovation lives.

The naive approach would be: "Here's a PRD. Create some agents." But *how many* agents? *Which* specializations? *Where* do you draw the boundaries between them?

The design process involved studying how real technical leads decompose projects:

- **Every project needs certain roles**: Someone to set up the project structure (architect), someone to test everything (QA). These are non-negotiable.
- **Every major technology gets a specialist**: If you're using Next.js and FastAPI, you want a Next.js expert and a FastAPI expert, not a "full-stack generalist" who's mediocre at both.
- **Every distinct feature domain gets an owner**: Authentication is different from payments is different from notifications. Each deserves focused attention.
- **Cross-cutting concerns become specialists when they're substantial**: If security is a checkbox, the architect handles it. If security is a core requirement (healthcare, finance), it gets its own agent.

These heuristics were encoded into the `forge-build-agent-team` skill: a detailed process that the `forge-team-builder` agent follows. The skill doesn't just create agents; it *validates* the team. Every PRD requirement must map to exactly one agent. No gaps (requirements no one owns). No overlaps (requirements two agents fight over).

The most important design decision in the team builder was the **collaboration section** in each agent's definition. Every agent explicitly declares:
- **Dependencies**: What it needs from other agents before it can work
- **Handoffs**: Where its work ends and another agent's begins
- **Coordination points**: What needs to be synchronized

This isn't just documentation, this is the contract that makes multi-agent coordination actually work. When the project orchestrator needs to decide what order to call agents in, it reads these collaboration sections. The dependencies become the execution graph.

### The Takeaway for Builders

> **Don't just create agents: design a team.** The value isn't in individual agents; it's in how they coordinate. Explicit boundaries and collaboration contracts prevent the chaos that comes from multiple AI agents working in the same codebase without clear ownership.



## Chapter 4: The Orchestrator — Conducting the Symphony

This is cricital: Individual agents can do individual tasks. But who decides *what* to build *when*? Who makes sure the database schema exists before the API engineer tries to query it? Who verifies that Phase 1 is actually complete before Phase 2 begins?

Enter the `project-orchestrator`: the project manager of the agent team.

Building the orchestrator revealed something interesting about AI coordination: **the hard part isn't making agents do work, it's making them do work in the right order, with the right context, and knowing when to stop.**

The orchestrator's process is deceptively simple:

1. Read the PRD. Understand all the phases.
2. Read every agent file. Understand who can do what, and what they need from whom.
3. For each phase, identify the right sequence of agent calls.
4. Execute tasks, verify deliverables, handle dependencies.
5. Provide progress updates. Flag blockers. Move to the next phase.

But within that simplicity are subtle design choices:

- **The orchestrator never does implementation work itself.** It coordinates, delegates, and validates. The the actual code, tests, and configuration come from specialist agents. This separation of concerns mirrors how the best project managers operate: they don't write code, they ensure the right people write the right code at the right time.

- **Verification before progression.** The orchestrator doesn't blindly move from Phase 1 to Phase 2. It checks that deliverables actually exist and meet acceptance criteria. This catches problems early, before they cascade.

- **Error handling is explicit.** When something goes wrong (as they usually do) an agent can't complete a task, requirements are ambiguous, dependencies are missing, the orchestrator stops and reports. It doesn't silently push through hoping things work out.

### The Takeaway for Builders

> **Coordination is the hardest problem in multi-agent systems.** Don't underestimate it. A team of brilliant specialists without coordination produces chaos. Build your orchestration layer with the same care you build your specialist agents, maybe more.



## Chapter 5: The First Real-World Test (and What It Revealed)

The framework worked. You could describe an idea or give it your existing work, get a validated PRD, generate an agent team, and orchestrate a build. But using it on real projects revealed gaps that theory hadn't predicted.

### The Freshness Problem

The first surprise was subtle but dangerous. An agent generating a Next.js application confidently used the Pages Router, **which was the standard approach during its training data cutoff**, when the App Router had been the recommended approach for months. Another agent installed a library version with known security vulnerabilities. The PRD said "use React" but didn't specify a version, and the agent used patterns from 2024!

This wasn't a bug in any individual component. It was a *systemic gap*: **the framework had no mechanism for ensuring agents used current information.**

The instinct was to add "always search for the latest version of everything" to every agent. But that would be noisy, slow, and counterproductive: agents would spend half their time searching and second-guessing the PRD's deliberate choices.

Instead, a research document was created: `latest-information-strategy.md`: that systematically analyzed:
- Where in the workflow does outdated information cause the most damage?
- What existing mitigations already help? (Human review, LLM knowledge, Copilot's web access)
- Where should we add targeted freshness checks?

The answer was four surgical additions:
1. **PRD Builder**: Verify tech stack currency during PRD creation (catch it at the source)
2. **Agent Template**: Every generated agent gets a constraint to verify current APIs when uncertain
3. **Orchestrator**: Check tech stack currency before starting Phase 1 (last chance before code is written)
4. **Team Builder**: Include freshness instructions in every agent it generates (systemic, not ad-hoc)

Four small changes across four files. No structural modifications. But they closed a gap that could have led to entire projects being built on deprecated foundations.

### The Takeaway for a Builder


> **Use your own framework. The gaps you find in real use are the ones that matter most.** And when you find a gap, don't patch it everywhere: analyze where the fix has the highest impact with the lowest noise. Surgical fixes beat sledgehammer fixes every time.



## Chapter 6: The Feature Problem: "What Happens After V1?"

The second major revelation came from a simple question: *"Okay, the initial build is done. Now I want to add a feature. What do I do?"*

The framework had no good answer.

The existing workflow assumed a single PRD driving a single team generation driving a single build execution. It was a one-shot process. But real software development isn't one-shot: it's iterative. You build V1, then you add notifications, then you add payment processing, then you refactor the authentication layer.

The naive solutions were all problematic:
- **Modify the original PRD and regenerate everything?** That overwrites all the customizations users made to their agents after generation. Unacceptable.
- **Just call individual agents directly?** That works for small changes but doesn't scale. How does a cross-cutting feature like "real-time notifications", which touches the frontend, the API, and needs new WebSocket expertise get coordinated?
- **Create a whole new PRD from scratch?** That ignores everything already built. The new PRD would have no awareness of existing agents, existing architecture, or completed phases.

This wasn't a missing feature, it was a missing *workflow*. The solution required thinking through the entire lifecycle, not just adding a skill.

Another research document was created: `feature-prd-strategy.md`, and this one was more complex. It identified six fundamental challenges:

1. **Preserving existing agent customizations**: Can't overwrite what users have refined
2. **Understanding completed state**: The feature needs to know what's already built
3. **Agent boundary evolution**: A new feature might cross existing agent boundaries
4. **Orchestrator continuity**: Feature phases are additive, not from-scratch
5. **PRD versioning**: Multiple PRDs need distinct IDs to avoid collisions
6. **Backward compatibility**: The existing workflow must remain untouched

The solution was three coordinated capabilities that mirrored the existing workflow:

```
Original workflow:  Idea -> PRD -> Agent Team -> Orchestrated Build

Feature workflow:   Feature Idea -> Feature PRD -> Team Update -> Feature Build
```

Each component was designed to be *context-aware*:

- The **Feature PRD Builder** (`forge-build-feature-prd`) reads the original PRD, scans existing agents, and examines the codebase before asking a single question. It knows what exists. Its output includes an "Agent Impact Assessment": a section that explicitly maps the feature's impact onto the existing team.

- The **Team Builder** gained an incremental mode. It auto-detects whether it's looking at a full PRD or a Feature PRD. In feature mode, it doesn't regenerate the team: it extends existing agents with new responsibilities, creates new agents only when needed, and leaves unaffected agents completely untouched. Changes are presented as diffs, not replacements.

- The **Orchestrator** gained a feature execution mode. It reads both the original PRD and the Feature PRD, understands which phases are already complete, and executes only the new F-prefixed feature phases. It never re-executes original phases.

The most important design decision was using **prefixed IDs** everywhere: `FT-US-01` for feature user stories, `FT-FR-01` for feature requirements, `Phase F1` for feature phases. This simple convention prevents the collision that would happen when Feature PRD requirement `FR-01` conflicts with the original PRD's `FR-01`.

### The Takeaway for Builders

> **Design for iteration from day one, but implement it when you actually need it.** The original framework didn't support features, and that was fine for V1. But when the need arose, the research-first approach meant the solution was additive, not a rewrite. If you build your original architecture with clear boundaries and single sources of truth, adding iteration support later becomes an extension, not a surgery.



## Chapter 7: The Research-Driven Approach

If there's one pattern that defined the entire development of Agent Forge, it's this: **research before implementation**.

Every significant capability was preceded by a research document that followed the same structure:

1. **The Question**: What are we trying to solve? State it clearly.
2. **Current State Analysis**: What exists today? What's the gap? Be specific: reference actual file paths and line numbers.
3. **Risk Assessment**: What happens if we don't solve this? What are the failure modes?
4. **Proposed Solution**: How do we solve it? Multiple options considered, one recommended.
5. **Implementation Plan**: What specific files change? What's the effort? Is it backward compatible?
6. **Open Questions**: What haven't we figured out yet? What can we defer?
7. **Summary Table**: A clean summary a busy person can scan in 30 seconds.

It served three practical purposes:

**First, it prevented over-engineering.** When you write down the risk assessment and implementation plan, you quickly see whether a change is proportionate to the problem. The freshness strategy could have been a massive "agent verification framework". The research document showed that four small additions across four files would solve 80% of the problem.

**Second, it created a decision trail.** Six months from now, when someone asks "why does the team builder have two modes?", the answer isn't "because someone thought it was a good idea." It's a documented analysis with specific reasoning, tradeoff discussions, and rejected alternatives.

**Third, it forced clarity before complexity.** Writing "the orchestrator needs to understand this is additive work, not a from-scratch build" in a research document is how you discover that you need separate phase prefixes, not just a flag. The writing process surfaces edge cases that coding doesn't.

### The Takeaway for Builders

> **Write the research document before you write the code.** Even if "research document" is just a page of notes in a markdown file. The act of writing down *what exists*, *what's missing*, *what could go wrong*, and *what specifically changes* will save you from building the wrong thing. It's not slower, it's faster, because you don't have to undo mistakes.



## Chapter 8: The Meta-Lesson — Building Tools That Build Tools

Here's the most interesting thing about Agent Forge: **it's a framework that uses AI to create AI teams that build software**. That recursion isn't accidental, it's the whole point.

- The PRD Builder skill doesn't fill in a template. It conducts an intelligent interview, challenges assumptions, and researches technology currency. 
- The Team Builder doesn't just slot agents into predefined roles. It analyzes the specific requirements, identifies the right specialization boundaries, and validates coverage. 
- The Orchestrator doesn't just call agents in a fixed order. It reads the dependency graph and adapts.

At every layer, the principle is the same: **give the AI enough structure to be effective, but enough freedom to adapt to the specific situation.**

This balance: structure versus freedom, is the hardest thing to get right. Too much structure and your framework only works for one type of project. Too little and agents go off in unpredictable directions.

The sweet spot, as discovered through building Agent Forge, is:
- **Structure the *process*, not the *output*.** Tell agents *how* to think about a problem (analyze requirements -> identify roles -> validate coverage), not *what* to produce (always create exactly 6 agents with these exact names).
- **Make the PRD the single source of truth.** Everything else is derived from it. If agents disagree, the PRD wins.
- **Use validation as a safety net.** The team builder validates that every requirement has an owner. The orchestrator validates that deliverables exist before moving forward. These checks catch the cases where freedom leads to gaps.



## Chapter 9: Your Turn — A Framework for Building Frameworks

This story isn't just about Agent Forge. It's about a *process* for building any framework that coordinates AI agents, or, really, any complex system where multiple components need to work together.

Here's the process, distilled:

### Step 1: Identify the Real Problem
Don't start with the technology. Start with the frustration. What are you actually trying to make better? For Agent Forge, it was: "One AI can't be an expert in everything simultaneously." Your problem will be different, but the approach is the same: name the pain clearly.

### Step 2: Study How Humans Solve It
Before you design an AI system, understand the human system it mirrors. Agent Forge works because real development teams work: specialists with clear roles, coordinated by a project manager, working from shared requirements. Whatever your domain, there's a human process that already works. Find it. Understand it. Translate it.

### Step 3: Build the Foundation First (PRD-Equivalent)
Every multi-agent system needs a single source of truth. For software, that's a PRD. For a content pipeline, it might be an editorial brief. For a data processing system, it might be a data specification. Whatever your domain, build the "single source of truth creation" tool first. Everything else depends on it.

### Step 4: Design Agents as a Team, Not as Individuals
It's tempting to build one amazing agent, then another, then another. Resist this. Design the *team*: the boundaries, the handoff points, the collaboration contracts. An individual agent's value comes from its place in the team, not its standalone capabilities.

### Step 5: Build Orchestration as a First-Class Concern
Don't bolt coordination on later. Design your orchestration layer alongside your agents. The orchestrator needs to understand agent capabilities, dependencies, and validation criteria. It's not a simple scheduler: it's the glue that makes the team function.

### Step 6: Use It, Break It, Fix It (With Research)
Ship the first version. Use it on a real project. Document the gaps you find: not as bugs to patch, but as research questions to answer. "How do we ensure agents use current information?" is a better starting point than "add a version check to every agent." The research-first approach leads to proportionate, surgical fixes instead of bloated workarounds.

### Step 7: Design for Iteration
Your V1 will handle the greenfield case. Eventually, you'll need to handle the "what now?" case: new features, changed requirements, evolved capabilities. When that happens, follow the same research-first approach: understand the existing state, identify the specific challenges, and design an additive solution that doesn't break what's working.

### Step 8: Document the Journey
You're reading this document because someone decided the *process* was as valuable as the *product*. Every research document, every design decision, every rejected alternative: these aren't just artifacts. They're the knowledge that lets other people build on your work, learn from your mistakes, and create their own versions of what you've built.



## Epilogue: What We Actually Built

Let's zoom out and see the whole picture.

**McFuzzy Agent Forge** is a template repository that takes an idea and turns it into a coordinated team of AI specialists:

```
 ┌─────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
 │  Your Idea   │ ──→ │  PRD Builder  │ ──→ │   Team Builder    │ ──→ │   Orchestrator   │
 │              │     │  (Interview)  │     │ (Specialist Team) │     │  (Coordination)  │
 └─────────────┘     └──────────────┘     └──────────────────┘     └─────────────────┘
                            │                      │                        │
                      Comprehensive PRD      Agent Files +           Phased Execution
                      (Single Source          Skill Files             with Validation
                       of Truth)             (Clear Ownership)       and Handoffs
```

And when V1 is done:

```
 ┌─────────────────┐     ┌────────────────────┐     ┌───────────────┐     ┌─────────────────┐
 │  Feature Idea    │ ──→ │  Feature PRD Builder │ ──→ │ Team Updater   │ ──→ │   Orchestrator   │
 │  (on existing    │     │  (Context-Aware)     │     │ (Incremental)  │     │  (Feature Mode)  │
 │   project)       │     └────────────────────┘     └───────────────┘     └─────────────────┘
 └─────────────────┘            │                          │                        │
                          Feature PRD               Only Changed/New          Feature Phases
                          (Impact Assessment,       Agent Files              (F-prefixed,
                           Prefixed IDs)            (Diff-based)             Context-aware)
```

The components:

| Component | What It Does | Why It Exists |
|-----------|-------------|---------------|
| `forge-build-prd` skill | Creates PRDs through AI-guided interviews | A team needs a single source of truth |
| `forge-build-feature-prd` skill | Creates feature PRDs aware of existing projects | V1 isn't the end — iteration needs structure too |
| `forge-build-agent-team` skill | Transforms PRDs into agent team definitions | Manual agent creation doesn't scale or validate |
| `forge-team-builder` agent | Executes the team-building process | An agent follows the skill's process to design teams |
| `project-orchestrator` agent | Coordinates agents through implementation phases | Specialists without coordination produce chaos |
| Bootstrap scripts | Deploy templates to any repository | The framework should be easy to adopt |

Each component was built in response to a real need, validated through real use, and refined through documented research. Nothing was added "just in case." Everything earns its place.



## The Principles That Guided Everything

If you take nothing else from this story, take these:

1. **Start with the problem, not the technology.** The best frameworks solve real frustrations, not imagined ones.

2. **Mirror human processes.** If real teams work with PRDs, specialists, and project managers, your AI teams should too.

3. **Single source of truth, always.** Every agent, every decision, every validation should trace back to one authoritative document.

4. **Research before implementation.** Write down what exists, what's missing, what could go wrong, and what specifically changes. Then build.

5. **Additive, not destructive.** New capabilities should extend the framework, not rewrite it. If your new feature requires rewriting existing code, your architecture needs rethinking.

6. **Validate at every layer.** The PRD builder validates tech currency. The team builder validates coverage. The orchestrator validates deliverables. Trust, but verify.

7. **Design for iteration.** V1 is never the end. Build your foundations so that V2 is an extension, not a replacement.

8. **Document the why, not just the what.** Code tells you what was built. Research documents tell you *why* — and that's what lets other people build their own versions.

And thats the story, **and here is the repo**: https://github.com/McFuzzySquirrel/mcfuzzy-agent-forge

---

*This is the story of how my Agent Forge came to be. But more importantly, it's a playbook. Take it. Adapt it. Build your own version. The patterns work whether you're building AI agent teams, data pipelines, content systems, or anything else where multiple specialized components need to work together toward a shared goal.*

*The tools will change. The process won't.*

---

**Made with ❤️ and a lot of research documents by [McFuzzySquirrel](https://github.com/McFuzzySquirrel)**

