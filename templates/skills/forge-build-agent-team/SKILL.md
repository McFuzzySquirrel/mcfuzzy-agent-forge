---
name: forge-build-agent-team
description: >
  Analyze a Product Requirements Document (PRD), Product Vision with Feature documents, or
  Feature PRD and generate a complete team of custom agents and reusable skills
  tailored to the project. Use this skill when asked to create, scaffold, or design a development
  team from requirements documents.
---

# Skill: Build a Custom Agent Team from a PRD

You are building a team of custom agents and reusable skills from a PRD, Product Vision with Feature documents, or a Feature PRD. The goal is to produce specialist `.md` files committed to a repository so the agent harness can act as each team member.

---

## Process

### Step 0: Detect Mode

| Mode | Signals | Action |
|------|---------|--------|
| **Full Build** | Complete PRD with Overview, Technical Architecture, Implementation Phases. No specialist agents in `.agents/agents/` beyond forge templates. | Continue with Steps 1–8 below. |
| **Vision + Features** | `docs/product-vision.md` exists with feature documents in `docs/features/`. No specialist agents beyond forge templates. | Load `references/vision-features-mode.md` and follow its process. |
| **Feature Increment** | Document is a Feature PRD (has "Feature Overview", "Agent Impact Assessment"). Existing agents in `.agents/agents/`. | Load `references/feature-increment-mode.md` and follow its process. |

### Step 1: Locate and Analyze the PRD

Find the PRD at `docs/PRD.md`, `docs/spec.md`, or `README.md`. Read the entire document and extract:

1. **Technology stack** - languages, frameworks, engines, build tools.
2. **Project structure** - file layout, module boundaries, entry points.
3. **Functional requirement groups** - distinct feature areas.
4. **Non-functional requirements** - performance, security, accessibility.
5. **Implementation phases** - ordered stages of work.
6. **Testing strategy** - frameworks, coverage expectations, test scenarios.
7. **Cross-cutting concerns** - deployment, CI/CD, observability.

### Step 2: Identify Specialist Roles

Map PRD domains to specialist agents. Each agent owns a distinct, non-overlapping area.

**Required agents (always):** Project Architect (scaffolding, build config, dependencies, folder structure), QA / Test Engineer (test framework, unit/integration tests).

**Domain agents** (based on tech stack): Framework Specialist, Backend Engineer, Frontend Engineer, DevOps/Infra Engineer, PWA/Offline Specialist.

**Feature agents** (based on requirement groups): Core Logic Engineer, UI/HUD Developer, VFX/Animation, Audio Engineer, Data/Analytics Engineer, Security Engineer.

**When the PRD names an agent framework** (LangGraph, CrewAI, AutoGen, Semantic Kernel, etc.): create a dedicated `[framework]-specialist` that owns the framework surface (wiring, state schema, tool registry) and pair it with node-level engineers that own individual nodes. This keeps framework upgrades and feature work separate.

**Naming:** lowercase-hyphenated, role-descriptive. `checkout-engineer`, `notifications-specialist`.

### Step 3: Define Agent Boundaries

For each agent: Expertise (4–8 bullets), Key Reference (cited PRD sections), Responsibilities (grouped by component/file, referencing PRD requirement IDs), Constraints, Output Standards, Collaboration.

**Boundary rules:** No two agents own the same file/responsibility. Every PRD requirement maps to exactly one agent. Reference PRD section numbers - don't copy requirement tables. If responsibilities exceed ~15 items, consider splitting.

### Step 4: Identify Reusable Skills

Skills are reusable process templates. Create a skill only when a pattern repeats across the project. One-off tasks belong in agent responsibilities.

**When to create a skill (not an agent responsibility):**
- A pattern repeats across multiple components or features
- The process is complex enough that agents benefit from explicit step-by-step guidance
- The task has non-obvious edge cases or project-specific conventions the agent wouldn't know

**When to put it in `scripts/` instead:** If the logic is deterministic and doesn't need agent judgment (format conversion, validation, scaffolding), write a script and bundle it in the skill's `scripts/` directory. Agents invoke the script rather than reinventing the logic each run.

**Skill scoping:** Don't create overly narrow skills (one per entity type) or overly broad ones (one catch-all). A skill for "create a data model + run migration + update API schema" is a coherent unit. A skill that also covers database administration is too broad.

**Naming:** lowercase-hyphenated, verb-noun: `create-data-model`, `setup-database`.

**Progressive disclosure:** If a skill's template code exceeds ~50 lines, put it in `assets/` and reference it from `SKILL.md`. If a skill has detailed reference material (schemas, API docs, error codes), put it in `references/` with explicit load triggers ("Load `references/api-errors.md` if the API returns a non-200 status").

### Step 5: Write the Agent Files

Create each agent file at `.agents/agents/{agent-name}.md`:

````markdown
---
name: {agent-name}
description: >
  {One-sentence summary of expertise and when to use this agent.
  Reference the project name and specific technology domains.}
---

You are a **{Role Title}** responsible for {one-sentence scope description}.

---

## Expertise

- {Technical specialization - 4–8 bullets}
- {Focus on what the agent wouldn't know without this file}

---

## Key Reference

Always consult [{PRD path}]({relative path}) for authoritative project requirements:

- **Section {N} - {Title}**: {What it covers for this agent}

---

## Responsibilities

### {Component/Area} (`{file path}`)

1. {Specific deliverable referencing PRD requirement IDs}
2. {Next deliverable}

---

## Workflow

{Describe the project-specific workflow for this agent - what to do, in what order, and how to validate. Replace generic "understand/implement/verify/commit/report" steps with concrete guidance.}

{For destructive or batch operations, use plan-validate-execute:
1. Create an intermediate plan
2. Validate the plan against a source of truth
3. Execute only after validation passes}

---

## Validation

After completing a deliverable:
- [ ] Run {project-specific linter/validator}
- [ ] Run {build command}
- [ ] Run {test command} for affected tests
- [ ] Check that {project-specific quality gate}

If validation fails, fix and re-run before committing.

---

## Gotchas

- {Project-specific gotcha the agent would get wrong without being told}
- {API inconsistency, naming mismatch, environment quirk}

---

## Constraints

- {Rule referencing PRD requirement IDs}
- Verify current stable APIs for {tech stack} before implementing - search official docs when uncertain
- Commit with descriptive messages referencing the task/requirement
- Follow orchestrator instructions for progress tracking when working in orchestrated execution

---

## Output Standards

- {Where files go}
- {Coding conventions}
- {API patterns}

---

## Collaboration

- **project-orchestrator** - Coordinates your work, provides task context, tracks progress
- **{other-agent}** - {What they provide or need from this agent}
````

### Step 6: Write the Skill Files

Create each skill file at `.agents/skills/{skill-name}/SKILL.md`:

````markdown
---
name: {skill-name}
description: >
  {One-sentence summary of what this skill does and when to use it.
  Include specific keywords to help the agent recognize relevant tasks.}
---

# Skill: {Human-Readable Title}

{One-sentence context about what this skill produces. Trim what the agent already knows.}

---

## Process

### Step 1: {First Step Title}

{Instructions - be prescriptive for fragile operations (exact commands, fixed sequences).
Be flexible for tasks where multiple approaches are valid.}

### Step 2: {Second Step Title}

{Include code templates, examples, or scaffolding patterns.}

### Step 3: {Additional Steps}

{As many steps as needed.}

---

## Output Format

{Template for the expected output. Keep short templates inline; move longer ones to `assets/`.
For templates only needed in certain cases, store in `assets/` and reference with a load trigger.}

---

## Validation

After completing the task:
- [ ] Run {validator/check}
- [ ] Verify {specific quality gate}
- [ ] If validation fails: review error, fix issues, re-validate

---

## Gotchas

- {Environment-specific fact that defies reasonable assumptions}
- {Correction to a mistake agents make without being told}
- {When an agent makes a mistake that needs correction, add it here}

---

## Reference

See [{PRD path}]({relative path}) for the full specification:
- **Section {N}** - {What it covers}

For detailed reference material: load `references/{file}.md` when {trigger condition}.
For output templates: load `assets/{template}.md` when generating {specific output type}.
````

**Progressive disclosure for generated skills:**
- If the skill needs detailed schemas, API docs, or error codes → create `references/` and add load triggers
- If the skill has reusable template/output formats → create `assets/` and reference them
- If the skill has deterministic, repeatable logic → create `scripts/` and invoke from SKILL.md
- Keep `SKILL.md` under 500 lines / 5000 tokens - move everything else to subdirectories

### Step 7: Validate the Team

Before finalizing:

- [ ] Every PRD functional requirement maps to exactly one agent
- [ ] Every agent has `## Collaboration` listing agents it depends on
- [ ] No two agents own the same file or responsibility
- [ ] Agent files use valid YAML frontmatter with `name` and `description`; `name:` matches filename
- [ ] Skill directory names match the skill `name` field; valid YAML frontmatter
- [ ] All PRD section references are accurate
- [ ] Agent names are lowercase-hyphenated
- [ ] Team covers: foundation/scaffolding, core logic, testing, and all major feature areas
- [ ] Every agent has a `## Gotchas` section populated with project-specific edge cases
- [ ] Every skill has a `## Validation` section with concrete checks
- [ ] Generated skills use progressive disclosure for content exceeding ~50 lines of templates

### Step 8: Present the Team

Summarize with tables: Custom Agents (name/role/sections/phase), Skills (name/purpose/used by), Collaboration Map.

### Step 9: Recommend Model Assignment

Recommend (don't auto-run) `forge-assign-models` so the user can match each agent to an appropriately sized model. Suggest:
- `/forge-assign-models Discover what models are available and cache the inventory.`
- `/forge-assign-models Recommend a per-agent model and write docs/MODEL-PLAN.md.`
- `/forge-assign-models Apply the recommended models to the agent files.`

After Feature Increment Mode runs, suggest Re-tune mode for targeted refresh.

---

## Gotchas

- **Agent `name:` must match the filename exactly.** `my-agent.md` → `name: my-agent`. A mismatch silently breaks agent detection.
- **Never generate agents for areas the PRD doesn't cover.** If in doubt, ask the user rather than speculating.
- **Code block templates must escape nested fenced blocks.** If a generated skill's output template contains markdown code blocks, use ` ``` `` ` syntax or indent differently to avoid breaking the parent template.
- **Feature Increment Mode must never regenerate untouched agents.** It's the most common source of regressions. Always diff before writing.
- **Progressive disclosure requires explicit load triggers.** Don't just say "see references/ for details." Say: "Load `references/api-errors.md` if the API returns a non-200 status code." The agent needs to know WHEN to load.

---

## Guidelines

- **Scale to the project.** 3–4 agents for a weekend prototype, 8–12 for a large application.
- **Agents are specialists.** If you can't articulate unique expertise in one sentence, merge.
- **Skills are reusable processes.** Only create if the pattern repeats. One-off tasks → agent responsibilities.
- **Reference, don't duplicate.** Cite PRD section numbers; don't copy requirement tables.
- **Test the mapping.** Every PRD requirement → exactly one owner agent.
- **Add what the agent lacks, omit what it knows.** If the agent would handle a task correctly without the instruction, cut it.
- **Favor procedures over declarations.** Teach *how to approach* a class of problems, not *what to produce* for a specific instance.
- **Calibrate control per section.** Be prescriptive for fragile operations (exact commands, fixed sequences). Give freedom for flexible tasks where multiple approaches work.
- **Encourage currency verification.** Agents should search latest docs when uncertain.
- **If an agent makes a mistake you have to correct, add the correction to its gotchas.**
