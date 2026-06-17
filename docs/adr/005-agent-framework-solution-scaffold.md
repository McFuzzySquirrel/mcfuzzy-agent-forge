# ADR-005: Agent Framework Solution Scaffold via `forge-build-agent-framework-solution`

**Date:** 2026-05-18
**Status:** Accepted

---

## Context

The McFuzzy Agent Forge pipeline produces a PRD (`forge-build-prd`) and a Copilot
specialist agent team (`forge-build-agent-team`). When a PRD selects **Microsoft Agent
Framework** as its technology choice, the pipeline stops there: no skill translates that
decision into an actual, runnable project on disk. The specialist agents that follow are
then expected to build a solution from scratch, without a consistent starting layout,
without pinned package references, and without the "hello agent" smoke test that proves
the scaffold even compiles.

Several specific gaps drive the need for a dedicated skill:

1. **No scaffold baseline.** The `project-orchestrator` and specialist agents expect a
   repo with a real build system, project references, and a compiling skeleton to modify
   phase by phase. Without one, Phase 1 work begins with `dotnet new` or `uv init` being
   run ad-hoc and inconsistently.

2. **No framework version discipline.** Agent Framework APIs are still evolving rapidly.
   Without an explicit "verify package names and versions against the official docs before
   writing code" requirement, agents tend to copy stale snippets and produce code that
   silently targets deprecated APIs or wrong package names.

3. **No topology normalisation.** Agent Framework supports multiple orchestration
   topologies (single-agent, sequential, concurrent, group-chat, hand-off, graph
   workflow). Without a named topology extracted from the PRD and baked into the folder
   layout, specialist agents add files inconsistently and the solution diverges.

4. **Agent role confusion.** The *Copilot specialist agents* produced by
   `forge-build-agent-team` are GitHub Copilot custom agents that implement features in
   the repo. The *runtime agents* inside the Agent Framework solution are Azure-hosted AI
   agents that the product ships. These are entirely different constructs with different
   files, tooling, and lifecycles. Without an explicit boundary, the two are easily
   conflated, leading to misplaced files and incorrect tool wiring.

5. **No framework-selection guard.** Nothing prevents `forge-build-agent-team` from being
   called for a PRD that chose LangChain, AutoGen (standalone), or another framework.
   A dedicated skill that halts when the PRD does not name Agent Framework explicitly
   is the right place to enforce this gate.

---

## Decision

We introduce a new **`forge-build-agent-framework-solution` skill** that bridges the gap
between a PRD that has selected Microsoft Agent Framework and a working, buildable
project on disk.

### 1. Scope and Non-scope

The skill is responsible for:

- Reading an existing PRD (Full Build Mode), product-vision + features (Vision + Features
  Mode), or a Feature PRD (Feature Increment Mode).
- Extracting agents, tools, orchestration topology, hosting surface, model providers, and
  non-functional requirements from that document.
- Scaffolding the full project layout (solution + class libraries / Python packages,
  packages pinned, DI wiring, prompts directory, tests, README, gitignore, editorconfig).
- Generating a runnable "hello agent" skeleton for the chosen topology.
- Running a clean build and test pass before reporting completion.

The skill is **not** responsible for:

- Deciding whether Agent Framework is the right technology. That decision lives in the
  PRD. If the PRD does not name Agent Framework, the skill stops and asks the user to
  confirm or re-run `forge-build-prd`.
- Deciding which Copilot specialist agents to create. That is `forge-build-agent-team`'s
  job, which runs *after* this skill.
- Implementing the product features. The skeleton it produces is deliberately minimal;
  specialist agents fill in feature work phase by phase.

### 2. Framework-Selection Guard

The first step in the skill's process is to read the PRD's **Technology Stack** /
**Technical Architecture** section and confirm that "Microsoft Agent Framework" is the
chosen framework. If it is absent, the skill surfaces a clear message and pauses. This
makes the guard structural rather than advisory.

### 3. Language Stack Auto-Detection

The skill auto-detects the target language from signals in the PRD:

| Signal | Detected stack |
|--------|---------------|
| C#, .NET, `dotnet`, NuGet, ASP.NET, Aspire, `Microsoft.Agents.AI` | .NET |
| Python, `pip`/`uv`/`poetry`, FastAPI, `agent-framework` | Python |
| Silent | Asks the user |

Stack detection is surfaced to the user before any files are written.

### 4. Ecosystem-Tooling-First Scaffolding

The skill uses official CLI tooling to generate the initial scaffold:

- **.NET** - `dotnet new sln`, `dotnet new classlib`, `dotnet new console/webapi/worker`,
  `dotnet new xunit`, `dotnet sln add`, `Directory.Packages.props` for central package
  management.
- **Python** - `uv init --package` (or `poetry new --src`), `pyproject.toml`,
  `uv sync` / `poetry install`.

This minimises hand-written boilerplate and ensures the scaffold follows the language
ecosystem's own conventions.

### 5. Verify-Before-Code Requirement

Because Agent Framework package names, namespaces, and APIs are actively changing, the
skill carries a hard requirement to check the current package names and a minimal "hello
agent" snippet against the official docs
(`https://learn.microsoft.com/en-us/agent-framework/` and the GitHub repo) before adding
any package reference or writing any code. If the docs cannot be reached, the skill says
so and asks the user to paste the relevant getting-started snippet. The alternative —
encoding specific version numbers in the skill itself - would cause the skill to produce
outdated scaffolds as Agent Framework evolves.

### 6. Topology Extraction and Normalisation

Before scaffolding, the skill presents the user with an extracted plan that names the
chosen orchestration topology (single-agent, sequential, concurrent, group-chat, hand-off,
or graph workflow) and waits for confirmation. This serves two purposes: it surfaces PRD
ambiguities early, and it locks the folder layout choice before files are created.

### 7. Explicit Sequencing in the Forge Pipeline

The skill's position in the pipeline is defined in its Collaboration section:

```
forge-build-prd  →  [forge-decompose-prd (optional)]
    →  forge-build-agent-framework-solution   ← this skill
    →  forge-build-agent-team
    →  [forge-assign-models (optional)]
    →  project-orchestrator (phase implementation)
```

Running `forge-build-agent-team` before this skill is valid but uncommon: the Copilot
agent team can be generated without a code scaffold. Running this skill before
`forge-build-prd` is a user error; the framework-selection guard catches it.

### 8. Copilot-Agent / Runtime-Agent Distinction

The skill's documentation and completion report explicitly calls out the two agent
constructs:

- **Copilot specialist agents** (`.agents/agents/*.md`) - custom agents that implement
  features in the repository, produced by `forge-build-agent-team`.
- **Runtime Agent Framework agents** (`src/<Project>.Agents/`) - AI agents the *product*
  ships, hosted on Azure or locally, produced by this skill.

The two live in different directories, use different files and tooling, and are consumed
by different runtimes. The skill is the natural place to establish this distinction.

---

## Consequences

### Positive

- **Consistent scaffold baseline.** Every Agent Framework project in the forge pipeline
  starts from the same opinionated, buildable layout, giving specialist agents a reliable
  foundation to build on.
- **Version hygiene by default.** The verify-before-code requirement prevents stale API
  usage and surfaces breaking changes before they reach the specialist-agent build phase.
- **Topology clarity.** Extracting and confirming the orchestration topology before
  scaffolding eliminates the most common source of structural ambiguity in multi-agent
  PRDs.
- **Clear role boundary.** Documenting the Copilot-agent / runtime-agent distinction in
  the skill prevents a recurring confusion that otherwise surfaces as mis-filed code in
  nearly every Agent Framework project.
- **No regression for other stacks.** The framework-selection guard means the skill is
  silent when the PRD chooses a different technology; existing projects are unaffected.

### Negative

- **Extra step in the pipeline.** Projects that target Agent Framework now have one more
  skill to invoke between `forge-build-prd` and `forge-build-agent-team`. The
  `forge-bootstrap-project` meta-skill (ADR-004) can absorb this step in the fast path.
- **Doc-fetch overhead.** The verify-before-code requirement adds a network round-trip (or
  a user paste) at the start of each scaffold. This is acceptable given the cost of
  building on stale APIs, but it does slow the initial run.
- **Evolving constraints.** Agent Framework is pre-1.0. The skill's package-name table,
  topology wiring examples, and observability instructions will need updating as the
  framework stabilises. The verify-before-code requirement is a mitigation, not a fix.

### Neutral

- **No bootstrap script changes.** The skill is auto-discovered by the existing
  `templates/skills/*/` glob in `scripts/bootstrap.sh` and `scripts/bootstrap.ps1`.
- **No changes to existing skills.** `forge-build-prd`, `forge-build-agent-team`, and
  `forge-assign-models` are unchanged. This skill adds a new step; it does not replace any
  existing step.
- **Both language stacks are first class.** .NET and Python receive equivalent treatment
  in the scaffold layout, package list, and verification steps. Future language stacks
  (e.g. Java, TypeScript) can be added by extending Steps 2 and 3 without restructuring
  the skill.

---

## References

- Skill: [forge-build-agent-framework-solution](../../templates/skills/forge-build-agent-framework-solution/SKILL.md)
- Skill: [forge-build-prd](../../templates/skills/forge-build-prd/SKILL.md)
- Skill: [forge-build-agent-team](../../templates/skills/forge-build-agent-team/SKILL.md)
- Skill: [forge-assign-models](../../templates/skills/forge-assign-models/SKILL.md)
- Skill: [forge-bootstrap-project](../../templates/skills/forge-bootstrap-project/SKILL.md)
- Docs: [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/)
- ADR: [ADR-001 Agent/Skill Separation](001-agent-skill-separation-and-progress-reporting.md)
- ADR: [ADR-002 PRD Decomposition into Features](002-prd-decomposition-into-features.md)
- ADR: [ADR-003 Per-Agent Model Assignment](003-per-agent-model-assignment.md)
- ADR: [ADR-004 Bootstrap Meta-Skill](004-bootstrap-project-meta-skill.md)
