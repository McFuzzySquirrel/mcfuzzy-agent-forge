---
name: forge-build-agent-team
description: >
  Analyze a Product Requirements Document (PRD), Product Vision with Feature documents, or
  Feature PRD and generate a complete team of GitHub Copilot custom agents and reusable skills
  tailored to the project. Use this skill when asked to create, scaffold, or design a development
  team from requirements documents.
---

# Skill: Build a Custom Agent Team from a PRD

You are building a team of GitHub Copilot custom agents and reusable skills from a Product Requirements Document (PRD), a Product Vision with Feature documents, or a technical specification. The goal is to produce a set of specialist `.md` files that can be committed to a repository so Copilot can act as each team member.

---

## Process

### Step 0: Detect Mode — Full Build vs. Vision + Features vs. Feature Increment

Before analyzing the document, determine which mode to operate in:

**Full Build Mode** (existing behavior, unchanged):
- The document is a complete project PRD (has "Overview", "Technical Architecture", full "Implementation Phases")
- No existing agent files in `.github/agents/` beyond the forge templates (project-orchestrator, forge-team-builder)
- Proceed with the existing **Step 1–8** process below

**Vision + Features Mode** (new):
- A Product Vision document exists (`docs/product-vision.md`) with feature documents in `docs/features/`
- The product vision has a "Features" section listing individual feature documents
- No existing agent files in `.github/agents/` beyond the forge templates
- Proceed with the **Vision + Features process (Steps 1v–8v)** at the end of this document, before the Feature Increment Mode section

**Feature Increment Mode** (existing behavior, unchanged):
- The document is a Feature PRD (has "Feature Overview", "Context: Existing System State", "Agent Impact Assessment")
- Existing agent files already exist in `.github/agents/`
- Switch to the **incremental analysis process (Steps 1i–7i)** at the end of this document

---

### Step 1: Locate and Analyze the PRD

Find the project's PRD or specification document. Look in common locations:

- `docs/PRD.md`
- `docs/spec.md`
- `README.md` (if it contains detailed requirements)

Read the **entire** document and extract the following:

1. **Technology stack** — Languages, frameworks, engines, build tools, package managers.
2. **Project structure** — File/folder layout, module boundaries, entry points.
3. **Functional requirement groups** — Distinct feature areas (e.g., "Player Ship", "Wave System", "HUD").
4. **Non-functional requirements** — Performance, security, accessibility, offline support.
5. **Implementation phases** — How the work is broken into ordered stages.
6. **Testing strategy** — Test frameworks, coverage expectations, test scenarios.
7. **Cross-cutting concerns** — Audio, visual effects, deployment, CI/CD.

### Step 2: Identify Specialist Roles

Map the PRD's domains to specialist agent roles. Each agent should own a **distinct, non-overlapping area** of the project. Use the following heuristics:

#### Required Agents (create for every project)

| Role Pattern | When to Create | Owns |
|---|---|---|
| **Project Architect** | Always | Project scaffolding, build config, dependency management, folder structure |
| **QA / Test Engineer** | Always | Test framework setup, unit/integration tests, test scenarios from PRD |

#### Domain Agents (create based on tech stack)

| Role Pattern | When to Create | Owns |
|---|---|---|
| **[Framework] Specialist** | When a major framework/engine is used | Framework initialization, core APIs, rendering/routing/etc. |
| **Backend Engineer** | When there is a server, API, or database layer | API endpoints, data models, database, authentication |
| **Frontend Engineer** | When there is a web/mobile UI (not framework-specific) | Pages, components, layouts, client-side routing |
| **DevOps / Infra Engineer** | When there is deployment, CI/CD, or infrastructure | Dockerfiles, CI pipelines, cloud config, monitoring |
| **PWA / Offline Specialist** | When offline support, Service Workers, or caching is required | Service Worker, manifest, cache strategy |

#### Feature Agents (create based on functional requirement groups)

| Role Pattern | When to Create | Owns |
|---|---|---|
| **Core Logic Engineer** | When there is substantial business/game logic | State machines, core algorithms, domain rules |
| **Physics / Simulation Engineer** | When physics or simulation is a distinct subsystem | Physics engine integration, collision, simulation tuning |
| **UI / HUD Developer** | When UI is a separate concern from rendering | UI components, overlays, menus, accessibility |
| **VFX / Animation Artist** | When visual effects are a distinct subsystem | Particles, animations, transitions, visual polish |
| **Audio Engineer** | When audio/sound is specified in the PRD | Sound loading, playback, spatial audio, music |
| **Data / Analytics Engineer** | When telemetry, analytics, or data pipelines are required | Event tracking, dashboards, data models |
| **Security Engineer** | When security is a major concern (auth, encryption, compliance) | Auth flows, encryption, RBAC, compliance |

**Naming conventions:**
- Agent names must be **lowercase with hyphens**: `checkout-engineer`, `notifications-specialist`.
- Names should be **role-descriptive**, not person-names.
- Prefer established industry role titles that are intuitive.

### Step 3: Define Agent Boundaries

For each agent, determine:

1. **Expertise** — 4–8 bullet points of their technical specializations.
2. **Key Reference** — Which PRD sections they must consult (cite by section number).
3. **Responsibilities** — Numbered list of specific deliverables, grouped by component/file.
4. **Constraints** — Rules they must follow (e.g., "do not modify production code", "strict TypeScript").
5. **Output Standards** — Where their files go, coding conventions, API patterns.
6. **Collaboration** — Which other agents they depend on or coordinate with.

**Boundary rules:**
- No two agents should own the same file or responsibility.
- Every PRD functional requirement must map to exactly one agent.
- Agents should reference PRD section numbers, not copy entire requirements.
- If an agent's responsibilities list exceeds ~15 items, consider splitting into two agents.

### Step 4: Identify Reusable Skills

Skills are **process templates** that any agent can invoke for common, repeatable tasks. Analyze the PRD for patterns that will be repeated across the project:

| Skill Pattern | When to Create | Example |
|---|---|---|
| **Scaffold [entity type]** | When multiple similar entities/components will be created | `create-data-model`, `create-api-endpoint`, `create-react-component` |
| **Set up [subsystem]** | When a complex subsystem requires multi-step initialization | `setup-auth-provider`, `setup-database`, `setup-ci-pipeline` |
| **Create [effect/asset]** | When a category of assets will be produced repeatedly | `create-dashboard-widget`, `create-migration`, `create-test-suite` |
| **Implement [UI pattern]** | When UI follows a repeatable pattern | `implement-ui-screen`, `implement-form`, `implement-dashboard-widget` |

**Skill naming conventions:**
- Lowercase with hyphens: `create-data-model`, `setup-database`.
- Use verb-noun format: `create-X`, `setup-X`, `implement-X`, `build-X`.

### Step 5: Write the Agent Files

Create each agent file at `.github/agents/{agent-name}.md` using this template:

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

- {Technical specialization 1}
- {Technical specialization 2}
- {Technical specialization 3}
- {4–8 items total}

---

## Key Reference

Always consult [{PRD path}]({relative path to PRD}) for the authoritative project requirements. The relevant sections for your work are:

- **Section {N} — {Title}**: {What it covers for this agent}
- {List all relevant PRD sections}

---

## Responsibilities

### {Component/Area 1} (`{file path}`)

1. {Specific deliverable referencing PRD requirement IDs where applicable}
2. {Next deliverable}

### {Component/Area 2} (`{file path}`)

3. {Deliverable}
4. {Deliverable}

---

## Process and Workflow

When executing your responsibilities:

1. **Understand the task** — Read the referenced PRD sections and any dependencies from other agents
2. **Implement the deliverable** — Create or modify files according to your responsibilities
3. **Verify your changes**:
   - Run relevant linters for the files you modified
   - Run builds to ensure nothing is broken
   - Run tests related to your changes
4. **Commit your work** — After verification passes:
   - Use descriptive commit messages referencing the task or requirement
   - Include only files related to this specific deliverable
   - Follow the project's commit conventions (if specified in the PRD)
5. **Report completion** — Summarize what was delivered, which files were modified, and verification results

---

## Constraints

- {Rule 1 — referencing PRD requirement IDs}
- {Rule 2}
- When implementing features, verify that you are using current stable APIs, conventions, and best practices for the project's tech stack. If you are uncertain whether a pattern or API is current, search for the latest official documentation before proceeding.
- After completing a deliverable and verifying it works (builds, tests pass), commit your changes with a clear, descriptive message
- When working as part of orchestrated project execution, follow the orchestrator's instructions for progress tracking and coordination
- Report the status of verification steps (linting, building, testing) when communicating completion to other agents or users

---

## Output Standards

- {Where files go}
- {Coding conventions}
- {API patterns}

---

## Collaboration

- **project-orchestrator** — Coordinates your work as part of the overall project execution, provides task context, and tracks progress across all agents
- **{other-agent-name}** — {What they provide or need from this agent}
- **{other-agent-name}** — {Coordination point}
````

### Step 6: Write the Skill Files

Create each skill file at `.github/skills/{skill-name}/SKILL.md` using this template:

````markdown
---
name: {skill-name}
description: >
  {One-sentence summary of what this skill does and when Copilot should use it.}
---

# Skill: {Human-Readable Title}

{One-sentence context about what this skill produces.}

---

## Process

### Step 1: {First Step Title}

{Instructions for the first step, including decision criteria or lookup tables.}

### Step 2: {Second Step Title}

{Instructions with code templates, examples, or scaffolding patterns.}

{Use fenced code blocks with language tags for any code templates:}

```{language}
// Template code here
```

### Step 3: {Additional Steps}

{Continue with as many steps as needed for the process.}

---

## Reference

See [{PRD path}]({relative path to PRD}) for the full specification:

- **Section {N}** — {What it covers}
````

### Step 7: Validate the Team

Before finalizing, verify:

- [ ] Every PRD functional requirement (Section 8+) maps to exactly one agent.
- [ ] Every agent has a `## Collaboration` section listing agents it depends on.
- [ ] No two agents own the same file path or responsibility.
- [ ] Agent files use valid YAML frontmatter with `name` and `description`.
- [ ] Skill files use valid YAML frontmatter with `name` and `description`.
- [ ] All PRD section references are accurate (check section numbers).
- [ ] Agent names are lowercase-hyphenated and match the filename (minus `.md`).
- [ ] Skill directory names match the skill `name` field.
- [ ] The team covers: foundation/scaffolding, core logic, testing, and all major feature areas.

### Step 8: Present the Team

Summarize the team in a table:

```markdown
## Custom Agents

| Agent | Role | Primary PRD Sections | Phase |
|-------|------|---------------------|-------|
| `{name}` | {role} | {sections} | {implementation phase} |

## Skills

| Skill | Purpose | Used By |
|-------|---------|---------|
| `{name}` | {what it does} | {which agents use it} |

## Collaboration Map

{agent-a} → {agent-b}: {what flows between them}
```

---

## Guidelines

- **Scale to the project.** A weekend prototype may need 3–4 agents. A large application may need 8–12. Don't create agents for areas the PRD doesn't cover.
- **Agents are specialists, not generalists.** Each agent should be the undisputed expert in their area. If you can't articulate their unique expertise in one sentence, merge them with another agent.
- **Skills are reusable processes.** Only create a skill if the process will be invoked multiple times across the project. One-off tasks belong in an agent's responsibilities, not a separate skill.
- **Reference, don't duplicate.** Agents should cite PRD section numbers. Don't copy entire requirement tables into agent files — they'll go stale.
- **Keep collaboration sections honest.** Only list agents that genuinely need to coordinate. Not every agent needs to talk to every other agent.
- **Test the mapping.** For each PRD requirement, you should be able to point to exactly one agent who owns it. If a requirement is unowned, add an agent or expand an existing one. If it's dual-owned, clarify the boundary.
- **Encourage currency verification.** Generated agents should include a constraint reminding them to verify they are using current, stable APIs and best practices for their tech stack. Agents should search for latest official documentation when uncertain rather than relying solely on training data.
- **Include process guidance.** All agents should include the standard Process and Workflow section to ensure consistent practices for verification, commits, and progress reporting. This aligns specialist agents with the orchestrator's progress tracking capabilities.
- **Scale changes to feature scope.** When operating in Feature Increment Mode, only create or modify what the feature requires. A small feature might only extend one existing agent. A large feature might add 2–3 new agents and extend several existing ones. Match the changes to the feature's actual scope.
- **Aggregate across features in Vision + Features Mode.** When building from decomposed documents, always aggregate requirements across all features before identifying agent roles. Don't create per-feature agents — create per-domain agents that own requirements from multiple features.

---

## Vision + Features Mode — Building from Decomposed Documents

When Step 0 detects a Product Vision with Feature documents, use the following process instead of Steps 1–8. The goal is to build a complete agent team from a product vision document and its associated feature documents, considering requirements across all features holistically.

### Step 1v: Locate and Analyze the Product Vision

Find the product vision document (typically `docs/product-vision.md`) and read it to extract:

1. **Technology stack** — Languages, frameworks, engines, build tools, package managers (Section 6.1).
2. **Project structure** — File/folder layout, module boundaries, entry points (Section 6.2).
3. **Non-functional requirements** — Performance, security, accessibility, offline support (Sections 7–9).
4. **Cross-cutting concerns** — System states, analytics, dependencies, risks (Sections 10–12).
5. **Feature list** — The summary of all features and their dependency graph (Section 14).

### Step 2v: Read All Feature Documents

Read every feature document listed in the product vision's Features section (typically in `docs/features/`). For each feature, extract:

1. **Feature name and ID prefix** — From the Feature Overview section.
2. **User stories** — All user stories with their IDs.
3. **Functional requirements** — All requirements with their IDs and priorities.
4. **Implementation tasks** — Phases and tasks for this feature.
5. **Dependencies** — Which other features this feature depends on.
6. **Testing strategy** — How this feature will be tested.

Build a **unified requirements view** — a consolidated list of all functional requirements across all features, noting which feature each requirement belongs to.

### Step 3v: Identify Specialist Roles

Using the unified requirements view, map domains to specialist agent roles. Apply the same heuristics as Step 2 (in Full Build Mode):

- **Required agents** — Project Architect, QA/Test Engineer (always created).
- **Domain agents** — Based on the tech stack from the product vision.
- **Feature agents** — Based on functional requirement groups across all features.

**Key difference from Full Build Mode:** Requirements come from multiple feature documents rather than one PRD. When the same domain appears across multiple features (e.g., database requirements in Feature 1 and Feature 3), aggregate them under one agent rather than creating per-feature agents.

### Step 4v: Define Agent Boundaries

Follow the same process as Step 3 (in Full Build Mode), with these additional considerations:

- Map each feature requirement to exactly one agent. The mapping should note which feature document the requirement came from.
- When an agent owns requirements from multiple features, list all feature document references in their Key Reference section.
- Foundation feature tasks (project setup, scaffolding) typically map to the Project Architect agent.

### Step 5v: Identify Reusable Skills

Follow the same process as Step 4 (in Full Build Mode). Look for patterns that repeat across features — these are strong skill candidates since the pattern appears in multiple independent units of work.

### Step 6v: Write the Agent and Skill Files

Follow the same process as Steps 5–6 (in Full Build Mode), with these adaptations:

- **Key Reference sections** should list both the product vision and the specific feature documents relevant to each agent:
  ```markdown
  ## Key Reference

  Always consult the following documents for authoritative project requirements:

  - [Product Vision](../../docs/product-vision.md) — Architecture, tech stack, NFRs, security, accessibility
  - [Feature: Authentication](../../docs/features/authentication.md) — Sections 2–3 (user stories, requirements)
  - [Feature: Dashboard](../../docs/features/dashboard.md) — Sections 2–3 (user stories, requirements)
  ```

- **Responsibilities sections** should group deliverables by feature:
  ```markdown
  ## Responsibilities

  ### Authentication Feature (`AUTH-FR-*`)
  1. Implement login flow (AUTH-FR-01)
  2. Implement session management (AUTH-FR-02)

  ### Dashboard Feature (`DASH-FR-*`)
  3. Build data API endpoints (DASH-FR-03)
  ```

### Step 7v: Validate the Team

Follow the same validation checklist as Step 7 (in Full Build Mode), plus:

- [ ] Every feature document's functional requirements map to exactly one agent.
- [ ] Agents that own requirements from multiple features reference all relevant feature documents.
- [ ] The product vision is referenced for cross-cutting concerns (NFRs, security, accessibility).
- [ ] No feature document is left unrepresented in the agent team.

### Step 8v: Present the Team

Follow the same presentation format as Step 8 (in Full Build Mode), with an additional Feature Coverage table:

```markdown
## Feature Coverage

| Feature | Feature Doc | Agents Involved | Requirements |
|---------|-------------|----------------|-------------|
| Authentication | `docs/features/authentication.md` | auth-engineer, qa-tester | AUTH-FR-01 – AUTH-FR-04 |
| Dashboard | `docs/features/dashboard.md` | frontend-engineer, api-engineer, qa-tester | DASH-FR-01 – DASH-FR-06 |

## Feature Dependency Order

1. Foundation (no dependencies)
2. Authentication (depends on Foundation)
3. Dashboard, Search (depend on Authentication, can be parallel)
4. Notifications (depends on Dashboard)
```

---

## Feature Increment Mode — Incremental Steps

When Step 0 detects a Feature PRD, use the following incremental process instead of Steps 1–8. The goal is to extend the existing agent team with minimal, targeted changes rather than regenerating the entire team.

### Step 1i: Analyze the Feature PRD and Existing Team

1. **Read the Feature PRD**, focusing on:
   - Section 5 (Technical Approach) — What changes and what's new
   - Section 6 (Functional Requirements) — What needs to be built
   - Section 8 (Agent Impact Assessment) — The Feature PRD's own analysis of agent impact
   - Section 9 (Implementation Phases) — F-prefixed phases for the feature

2. **Read ALL existing agent files** in `.github/agents/`:
   - List each agent's name, role, and owned responsibilities
   - Note each agent's collaboration dependencies
   - Identify the boundaries between agents

3. **Read the original PRD** to understand:
   - The full project context and architecture
   - Established conventions and constraints
   - What was already built in completed phases

4. **Build a map** of existing agent domains and their boundaries.

### Step 2i: Evaluate Agent Impact Assessment

Review the Feature PRD's Section 8 (Agent Impact Assessment) as a starting point, then validate:

- For each "extended responsibility" — Does it actually fit within the agent's existing expertise? Would adding this responsibility keep the agent focused, or would it overload them?
- For each "new agent required" — Is a new agent truly needed, or can an existing agent cover this work? Is the justification sound?
- For each "no changes" agent — Confirm it genuinely isn't affected by the feature.

Produce a **revised assessment** if the Feature PRD's analysis needs correction.

### Step 3i: Plan Team Modifications

For each change category:

**A. Existing agents with extended responsibilities:**
- Draft updated **Responsibilities** sections (additive — append new items, don't rewrite existing ones)
- Draft updated **Collaboration** sections if new dependencies exist between agents
- Update **Key Reference** to include the Feature PRD path and relevant feature sections
- DO NOT modify Expertise, Constraints, or Output Standards unless the feature introduces fundamentally new technology or patterns that require it

**B. New agents required:**
- Follow the existing Steps 2–5 process for designing and writing new agent files
- Ensure new agents have Collaboration links to existing agents they depend on
- Ensure no boundary overlaps with existing agents
- New agents should reference both the original PRD (for project context) and the Feature PRD (for their specific requirements)

**C. Existing agents with no changes:**
- Leave completely untouched — do not regenerate or modify their files

### Step 4i: Identify New or Extended Skills

- Are there new repeatable patterns introduced by this feature?
- Can existing skills be reused for the feature's tasks?
- Only create new skills if the pattern will be invoked multiple times within or beyond this feature

### Step 5i: Write Only Changed or New Files

- **For modified agents:** Present the specific additions (what's being added to Responsibilities, Collaboration, and Key Reference sections) as a clear diff or addendum. If the agent was created before the Process and Workflow section was added to the template, add this section as well to bring it up to current standards. Present changes for user review and confirmation before applying them to the existing agent files.
- **For new agents:** Write complete agent files at `.github/agents/{agent-name}.md` following the standard template from Step 5.
- **For new skills:** Write complete skill files at `.github/skills/{skill-name}/SKILL.md` following the standard template from Step 6.
- **CRITICAL:** Do NOT regenerate or overwrite agents that aren't affected by the feature.

### Step 6i: Validate Incrementally

Before finalizing, verify:

- [ ] Every Feature PRD functional requirement (FT-FR-*) maps to exactly one agent (new or existing).
- [ ] No new boundary overlaps have been introduced between agents.
- [ ] Collaboration sections are updated for all affected agents (both directions).
- [ ] Existing unaffected agents remain completely unchanged.
- [ ] New agents follow all naming and format conventions (lowercase-hyphenated, valid YAML frontmatter).
- [ ] New agents include the currency verification constraint.
- [ ] Feature PRD section references use the correct path and section numbers.

### Step 7i: Present the Changes

Summarize the team modifications in tables:

```markdown
## Modified Agents

| Agent | Changes | Feature PRD Sections |
|-------|---------|---------------------|
| `existing-agent` | Added responsibilities for X, updated collaboration | FT-FR-01, FT-FR-03 |

## New Agents

| Agent | Role | Feature PRD Sections | Phase |
|-------|------|---------------------|-------|
| `new-agent` | Description of role | FT-FR-02, FT-FR-04 | F1 |

## Unchanged Agents

| Agent | Reason |
|-------|--------|
| `unaffected-agent` | Not involved in this feature |

## New Skills

| Skill | Purpose | Used By |
|-------|---------|---------|
| `new-skill` | What it does | Which agents |

## Reused Existing Skills

| Skill | Used For in This Feature |
|-------|--------------------------|
| `existing-skill` | How it applies to the feature work |
```
