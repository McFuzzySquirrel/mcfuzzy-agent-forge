---
name: forge-build-agent-framework-solution
description: >
  Scaffold a working Microsoft Agent Framework solution from a PRD that has selected
  Microsoft Agent Framework (https://learn.microsoft.com/en-us/agent-framework/) as the
  technology choice. Use this skill when asked to create, scaffold, bootstrap, or generate
  an Agent Framework project (single-agent, multi-agent, or workflow-based) in .NET or
  Python from an existing PRD, Feature PRD, or Product Vision + Feature documents.
---

# Skill: Build a Microsoft Agent Framework Solution from a PRD

You are scaffolding a runnable **Microsoft Agent Framework** solution from a PRD. The PRD has already selected Agent Framework as the chosen technology. Your job is to translate the PRD into a working project - folder layout, packages, configuration, sample agents, tools, workflow, tests, and developer docs - that `project-orchestrator` and specialist agents can build on.

> This skill does **not** decide whether Agent Framework is right. If the PRD doesn't name it, stop and ask the user.

Agent Framework is Microsoft's unified, open-source SDK for AI agents with two stacks: .NET (`Microsoft.Agents.AI`, `Microsoft.Agents.AI.OpenAI`, etc.) and Python (`agent-framework`). Package names and APIs are evolving - **always verify against [the official docs](https://learn.microsoft.com/en-us/agent-framework/) before writing code.**

---

## Process

### Step 0: Detect Mode and Preconditions

1. Locate the source document(s): `docs/PRD.md`, `docs/product-vision.md` + `docs/features/*.md`, or a single Feature PRD.
2. Confirm Agent Framework is the chosen stack. If not, stop.
3. Detect language: .NET (C#, NuGet, ASP.NET) or Python (`pip`/`uv`/`poetry`, FastAPI). If ambiguous, ask.
4. Check what exists. If a non-trivial layout is present, switch to Increment Mode.

State the mode, stack, and target paths before writing files.

### Step 1: Extract Solution Requirements from the PRD

Read the entire PRD and extract into a plan you present to the user:
1. **Agents** - Each AI persona, its role, inputs/outputs, tools, model tier.
2. **Tools** - Functions, MCP servers, retrieval, code interpreter.
3. **Workflow topology** - Single agent, sequential, concurrent, group chat, hand-off, or graph workflow.
4. **State/memory** - Conversation history, long-term memory, vector store, checkpointing.
5. **Model providers** - Azure OpenAI, OpenAI, AI Foundry, Ollama, or other endpoints.
6. **Hosting surface** - Console, web API, background worker, chat UI, Teams app.
7. **Non-functional** - Auth, logging, OpenTelemetry, rate limiting, content safety, evaluation.
8. **Testing** - Unit, integration (with stub chat client), end-to-end smoke tests.

Present the extracted plan and **wait for confirmation** before scaffolding.

### Step 2: Choose the Target Project Layout

Pick the layout based on stack and topology. Load the appropriate reference:
- **.NET** → `references/dotnet-layout.md`
- **Python** → `references/python-layout.md`

Collapse the layout for very small PRDs (a single console app may only need `src/<ProjectName>` + `tests/`).

### Step 3: Scaffold the Project

Prefer ecosystem tooling over hand-written files. Run from the repo root.

Load `references/package-references.md` for current package names and versions - **verify them against the latest official Agent Framework docs before adding.**

**Key .NET steps:**
- Pin SDK in `global.json` (current LTS or STS).
- `dotnet new sln`, `dotnet new classlib` for agents/tools/workflows, `dotnet new console`/`webapi`/`worker` for host, `dotnet new xunit` for tests.
- Enable central package management (`Directory.Packages.props`).
- Add Agent Framework packages, configure user-secrets for provider keys.
- `dotnet restore && dotnet build` to confirm.

**Key Python steps:**
- Pin Python in `.python-version` (3.11 or 3.12).
- `uv init --package <name>` (or `poetry new --src`).
- Add dependencies: `agent-framework`, provider extras, `fastapi`/`uvicorn` if web host, `pydantic-settings`, `pytest`, `ruff`, `mypy`.
- Create `.env.example` (never `.env`).
- `uv sync && ruff check && mypy src && pytest`.

### Step 4: Generate the Code Skeleton

Write **runnable but minimal** code. For each agent: a factory/builder function with system prompt (from `prompts/`), configured chat client, registered tools, and memory config.

For tools: one file per logical tool group. Typed parameters, doc comments used as tool descriptions, independently testable.

For workflows: a definition file with clear node/edge wiring matching the topology from Step 1.

For the host: config binding, logging + OpenTelemetry wiring, one sample invocation (console prompt loop or `POST /chat`).

### Step 5: Configuration, Secrets, and Environments

Document every required setting in `README.md` and `.env.example`. Never commit secrets. Prefer Entra ID / DefaultAzureCredential over API keys for Azure. Add environment profiles (`Development`/`Production`).

### Step 6: Observability

Wire OpenTelemetry tracing and metrics if the PRD requires it. Verify instrumentation source names against latest docs.

### Step 7: Testing

Produce: tool unit tests (no LLM), agent unit tests (stub chat client), workflow tests (stub agents), and one live integration smoke test gated behind `RUN_LIVE_TESTS=1` (skipped by default in CI).

### Step 8: Developer Experience

1. Write `README.md`: summary, prerequisites, run commands, config instructions, test commands, links to PRD and Agent Framework docs.
2. Add `.gitignore` appropriate to stack.
3. Add `.editorconfig` (.NET only).
4. Add minimal CI at `.github/workflows/ci.yml` **only if** the PRD or repo conventions call for it.
5. Scaffold `infra/` with `azure.yaml`, Bicep, or Aspire host **only if** the PRD specifies Azure deployment.

### Step 9: Verify the Scaffold Builds and Runs

- .NET: `dotnet restore && dotnet build && dotnet test` - clean build, no warnings.
- Python: `uv sync && ruff check && mypy src && pytest`.

Guard integration tests behind an env var if credentials are missing.

### Step 10: Report Completion

Summarize: mode/stack/topology, folder tree, packages/versions, required env vars/keys, run/test commands, open questions, and suggested next step (`@project-orchestrator Execute Phase 1`).

---

## Gotchas

- **Agent Framework APIs are evolving.** Package names and namespaces change between releases. Always verify against the official docs. If you can't reach them, say so and ask the user to paste a "getting started" snippet.
- **Never commit secrets.** Always emit `.env.example` / user-secrets instructions. Never commit `.env`.
- **Don't introduce a second agent framework.** Agent Framework supersedes Semantic Kernel and AutoGen. Use only Agent Framework packages unless the PRD explicitly requires another runtime.
- **Don't scaffold what the PRD doesn't ask for.** No speculative CI, infra, or evaluation tooling.
- **Verify compiler availability.** Before running `dotnet new` or `uv init`, check the tool is installed. If missing, tell the user what to install.
- **Domain agents fill in the work.** Your scaffold is a skeleton - specialist agents from `forge-build-agent-team` implement the features phase by phase. Keep it minimal.

---

## Constraints

- Do not invent agents, tools, or workflows not described in the PRD. If ambiguous, ask.
- Do not copy verbatim code from docs without verifying it compiles against pinned versions.
- Use current stable APIs. Search for latest official documentation when uncertain.
- Make the smallest changes needed for a runnable skeleton.

---

## Output Standards

- Project name: derived from PRD's product name in PascalCase (.NET) or snake_case (Python).
- File/folder names follow the layouts in `references/dotnet-layout.md` / `references/python-layout.md`.
- All public types/methods carry doc comments - they double as tool descriptions.
- Prompt content lives in version-controlled `prompts/` files, not string literals.
- Configuration is strongly typed (Options pattern / `pydantic-settings`).

---

## Collaboration

- **forge-build-prd / forge-build-feature-prd** - Produce the PRD this skill consumes.
- **forge-build-agent-team** - Run after scaffolding to generate the specialist agent team.
- **forge-assign-models** - Run after team generation for per-agent model assignment.
- **project-orchestrator** - Drives implementation phases against the scaffold.
