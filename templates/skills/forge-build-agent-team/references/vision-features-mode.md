# Vision + Features Mode

Complete process for building an agent team from a Product Vision document and associated Feature documents in `docs/features/`.

## Load Trigger

Load this file when: the source document is a Product Vision (`docs/product-vision.md`) with feature documents in `docs/features/`, and no existing agent files exist in `.agents/agents/` beyond forge templates.

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
