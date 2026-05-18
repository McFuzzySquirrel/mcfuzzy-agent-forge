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

You are scaffolding a runnable **Microsoft Agent Framework** solution from a Product
Requirements Document (PRD), a Product Vision with Feature documents, or a Feature PRD.
The PRD has already selected **Microsoft Agent Framework** as the chosen technology in its
**Technical Architecture** / **Technology Stack** section. Your job is to translate that
PRD into a working project on disk — folder layout, package references, configuration,
sample agents, tools, workflow, tests, and developer docs — that the
`project-orchestrator` and specialist agents can then build on phase by phase.

> [!IMPORTANT]
> This skill **does not** decide whether Agent Framework is the right choice. If the PRD
> does not call out Microsoft Agent Framework as the chosen framework, stop and ask the
> user to confirm or to re-run `forge-build-prd` first.

---

## What is Microsoft Agent Framework?

Microsoft Agent Framework is Microsoft's unified, open-source framework for building AI
agents and multi-agent systems. It consolidates the prior **Semantic Kernel** agent
abstractions and **AutoGen** multi-agent orchestration into a single SDK with first-class
support for:

- **Single agents** backed by Azure OpenAI, OpenAI, Azure AI Foundry, or any
  OpenAI-compatible endpoint.
- **Tools / function calling** — native .NET methods or Python functions exposed as tools,
  plus **Model Context Protocol (MCP)** servers.
- **Multi-agent orchestration** — sequential, concurrent, group chat, hand-off, and
  graph-based **workflows**.
- **Memory / threads** — conversation state, checkpointing, and pluggable stores.
- **Observability** — OpenTelemetry tracing of agent runs, tool calls, and token usage.
- **Hosting** — console apps, ASP.NET Core / FastAPI services, Azure Container Apps,
  Azure Functions, Aspire-based local orchestration.

Two officially supported language stacks exist:

| Stack  | Primary packages |
|--------|------------------|
| .NET   | `Microsoft.Agents.AI`, `Microsoft.Agents.AI.OpenAI`, `Microsoft.Agents.AI.AzureAI`, `Microsoft.Agents.AI.Workflows`, `Microsoft.Extensions.AI` |
| Python | `agent-framework`, `agent-framework-azure-ai`, `agent-framework-mcp` (install names vary; verify against the latest docs) |

> [!NOTE]
> Package names, namespaces, and APIs in Agent Framework are evolving. **Always verify the
> current package names, versions, and minimal "hello agent" sample against
> https://learn.microsoft.com/en-us/agent-framework/ and the official GitHub repo at
> https://github.com/microsoft/agent-framework before writing code.** If you cannot reach
> the docs, say so and ask the user to paste the latest "getting started" snippet.

---

## Process

### Step 0: Detect Mode and Preconditions

1. Locate the source document(s):
   - `docs/PRD.md` (Full Build Mode)
   - `docs/product-vision.md` + `docs/features/*.md` (Vision + Features Mode)
   - `docs/features/<feature>.md` (Feature Increment Mode — extending an existing
     Agent Framework solution)
2. Read the document's **Technology Stack** / **Technical Architecture** section.
   Confirm that **Microsoft Agent Framework** is the chosen technology. If it is not,
   stop and ask the user to confirm or to update the PRD.
3. Detect the language stack:
   - **.NET** if the PRD mentions C#, .NET, `dotnet`, NuGet, ASP.NET, Aspire, or
     `Microsoft.Agents.AI`.
   - **Python** if the PRD mentions Python, `pip`/`uv`/`poetry`, FastAPI, or
     `agent-framework`.
   - If the PRD is silent, ask the user which stack to scaffold.
4. Check what already exists in the repo. If a non-trivial project layout is already
   present, switch to **Increment Mode** and only add/modify what the PRD or Feature PRD
   requires.

State the detected mode, stack, and target paths back to the user before writing any
files.

---

### Step 1: Extract Solution Requirements from the PRD

Read the **entire** PRD and extract the following into a short internal plan you will
present to the user:

1. **Agents** — Each distinct AI persona the PRD describes (e.g. "Research Agent",
   "Triage Agent", "Customer Support Agent"). For each, capture:
   - Role / system prompt intent
   - Required inputs and expected outputs
   - Tools it needs (functions, MCP servers, retrieval, code interpreter, file search)
   - Model tier (reasoning vs. fast vs. embedding)
2. **Tools** — Concrete capabilities to expose as functions or MCP tools (e.g.
   `search_orders`, `send_email`, `query_kb`). Note required external services.
3. **Workflow / Orchestration topology** — How agents interact:
   - **Single agent** (one agent, possibly with tools)
   - **Sequential** (A → B → C)
   - **Concurrent** / fan-out-fan-in
   - **Group chat** (round-robin / selector)
   - **Hand-off** (router agent delegates to specialists)
   - **Graph workflow** (explicit nodes/edges with conditional routing)
4. **State and memory** — Whether the PRD requires conversation history, long-term
   memory, vector store, or checkpointing.
5. **Model providers** — Azure OpenAI, OpenAI, Azure AI Foundry, Ollama, or other
   OpenAI-compatible endpoints. Capture deployment / model names if specified.
6. **Hosting / surface** — Console app, web API (ASP.NET Core / FastAPI), background
   worker, chat UI, Teams app, Azure Function, etc.
7. **Non-functional requirements** — Authentication, logging, OpenTelemetry, rate
   limiting, content safety, evaluation, cost ceilings.
8. **Testing strategy** — Unit tests for tools, integration tests for agents (often with
   a recorded/stub chat client), end-to-end smoke tests.

Present this extracted plan to the user and **wait for confirmation** before scaffolding.

---

### Step 2: Choose the Target Project Layout

Pick the layout based on stack and topology. Adapt names to the PRD.

#### .NET layout (default)

```
<repo-root>/
├── src/
│   ├── <ProjectName>.Agents/              # Class library: agent factories, prompts
│   ├── <ProjectName>.Tools/               # Class library: function tools, MCP tool clients
│   ├── <ProjectName>.Workflows/           # Class library: multi-agent workflows (if any)
│   ├── <ProjectName>.Host/                # Executable: console / ASP.NET Core / Worker
│   └── <ProjectName>.Shared/              # DTOs, options, abstractions
├── tests/
│   ├── <ProjectName>.Agents.Tests/
│   ├── <ProjectName>.Tools.Tests/
│   └── <ProjectName>.Workflows.Tests/
├── samples/                               # Optional: minimal runnable examples
├── infra/                                 # Optional: Bicep / Terraform / azd
├── .config/dotnet-tools.json              # Local tools (e.g. dotnet-ef, aspire)
├── Directory.Packages.props               # Central package management
├── Directory.Build.props                  # Common build settings (LangVersion, Nullable)
├── global.json                            # Pinned .NET SDK
├── <ProjectName>.sln
└── README.md
```

Collapse the layout for very small PRDs (a single console app may only need
`src/<ProjectName>` + `tests/<ProjectName>.Tests`).

#### Python layout (default)

```
<repo-root>/
├── src/
│   └── <package_name>/
│       ├── __init__.py
│       ├── agents/                        # Agent factories, system prompts
│       ├── tools/                         # Function tools, MCP clients
│       ├── workflows/                     # Multi-agent workflows
│       ├── config.py                      # Settings (pydantic-settings)
│       └── main.py                        # Entry point (CLI / FastAPI app)
├── tests/
│   ├── unit/
│   └── integration/
├── samples/
├── infra/
├── pyproject.toml                         # Build + deps (uv / poetry / hatch)
├── .python-version                        # Pinned Python version
└── README.md
```

---

### Step 3: Scaffold the Project

Prefer **ecosystem tooling** over hand-written files wherever possible. Run commands from
the repo root.

#### .NET scaffolding

1. Pin the SDK:
   - Create `global.json` pinning a current LTS or STS .NET SDK (verify the active
     supported versions at https://dotnet.microsoft.com/download/dotnet).
2. Create the solution and projects via `dotnet new`:
   - `dotnet new sln -n <ProjectName>`
   - `dotnet new classlib -n <ProjectName>.Agents -o src/<ProjectName>.Agents`
   - `dotnet new classlib -n <ProjectName>.Tools  -o src/<ProjectName>.Tools`
   - `dotnet new classlib -n <ProjectName>.Workflows -o src/<ProjectName>.Workflows` *(if multi-agent)*
   - Choose **one** host template based on the PRD:
     - Console: `dotnet new console -n <ProjectName>.Host -o src/<ProjectName>.Host`
     - Web API: `dotnet new webapi  -n <ProjectName>.Host -o src/<ProjectName>.Host --use-minimal-apis`
     - Worker: `dotnet new worker   -n <ProjectName>.Host -o src/<ProjectName>.Host`
   - `dotnet new xunit -n <ProjectName>.Agents.Tests -o tests/<ProjectName>.Agents.Tests`
     (repeat per test project; xUnit is the default — match the user's preference if they
     specify NUnit or MSTest).
   - Add every project to the solution via `dotnet sln add`.
3. Enable **central package management** by creating `Directory.Packages.props` and
   setting `<ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>` in
   `Directory.Build.props`. Pin all package versions in one place.
4. Add Agent Framework package references (verify exact names + latest versions against
   the official docs before adding):
   - To `<ProjectName>.Agents`: `Microsoft.Agents.AI`, plus the provider package needed
     (e.g. `Microsoft.Agents.AI.OpenAI` for Azure OpenAI / OpenAI, or
     `Microsoft.Agents.AI.AzureAI` for Azure AI Foundry).
   - To `<ProjectName>.Workflows` (if multi-agent): `Microsoft.Agents.AI.Workflows`.
   - To `<ProjectName>.Host`: `Microsoft.Extensions.Hosting`,
     `Microsoft.Extensions.Configuration.UserSecrets`,
     `OpenTelemetry.Extensions.Hosting`,
     `OpenTelemetry.Exporter.OpenTelemetryProtocol` (if OTel is required).
   - To test projects: the chosen Agent Framework testing/stub helpers if available,
     otherwise standard mocking libraries (e.g. `NSubstitute` or `Moq`).
5. Use `dotnet user-secrets init` on the Host project and document the required keys
   (`AzureOpenAI:Endpoint`, `AzureOpenAI:Deployment`, etc.) — never commit secrets.
6. Run `dotnet restore` and `dotnet build` to confirm the empty scaffold compiles.

#### Python scaffolding

1. Pin Python:
   - Create `.python-version` with a current supported version (3.11 or 3.12 unless the
     PRD specifies otherwise — verify against the latest Agent Framework docs).
2. Initialize the project:
   - Prefer `uv init --package <package-name>` (or `poetry new --src <package-name>` if
     the user prefers Poetry).
3. Add dependencies (verify exact package names against the official Agent Framework
   docs before installing):
   - Runtime: `agent-framework`, plus a provider extra such as `agent-framework[azure-ai]`
     or `agent-framework[openai]`. Add `agent-framework-mcp` only if MCP tools are
     required.
   - Web host: `fastapi`, `uvicorn[standard]` (only if the PRD specifies an HTTP surface).
   - Config: `pydantic`, `pydantic-settings`, `python-dotenv`.
   - Observability: `opentelemetry-api`, `opentelemetry-sdk`,
     `opentelemetry-exporter-otlp` (only if OTel is required).
   - Dev: `pytest`, `pytest-asyncio`, `ruff`, `mypy`.
4. Create a `.env.example` (never `.env`) listing the required environment variables.
5. Run the package manager's lock + install (`uv sync` / `poetry install`) and confirm
   the project imports.

---

### Step 4: Generate the Code Skeleton

Write **runnable but minimal** code that demonstrates the chosen topology. The goal is a
working "hello agent" the user can run immediately, not a finished product.

For **each** agent identified in Step 1, emit:

1. A factory / builder function that constructs the agent with:
   - Its system prompt (loaded from a `.md` or `.prompty` file under `prompts/`)
   - The configured chat client (Azure OpenAI / OpenAI / AI Foundry)
   - Its registered tools
   - Any required memory / thread configuration
2. A registration in the host's dependency-injection container (.NET) or
   factory module (Python).

For **tools**, emit one file per logical tool group. Tools must:

- Have typed parameters and return types.
- Carry concise XML doc comments (.NET) or docstrings (Python) — the framework uses
  these as the tool description sent to the model.
- Be unit-testable independently of any LLM call.

For **workflows** (if multi-agent), emit:

- A workflow definition file in `<ProjectName>.Workflows` / `src/<package>/workflows/`.
- Clear node/edge wiring for sequential, concurrent, hand-off, or graph topologies,
  matching the topology identified in Step 1.

For the **host**, emit:

- Configuration binding (strongly typed options).
- Logging + OpenTelemetry wiring (if required by the PRD).
- A single sample invocation (e.g. a console prompt loop, or a `POST /chat` endpoint)
  that exercises the primary agent or workflow end-to-end.

Prompts should live in versioned files (`prompts/<agent>.system.md` or `.prompty`) rather
than being hard-coded as string literals in source.

---

### Step 5: Configuration, Secrets, and Environments

1. Document every required setting (endpoint, deployment, API key, model name, MCP
   server URLs, etc.) in `README.md` and in `.env.example` / user-secrets help text.
2. **Never** commit real secrets. Provide instructions for:
   - Azure OpenAI: `az login`, deployment name, endpoint, optional managed identity.
   - OpenAI: `OPENAI_API_KEY`.
   - Azure AI Foundry: project endpoint + Entra ID auth.
3. Add at least two environment profiles where it makes sense (`Development` and
   `Production` for .NET; `dev` / `prod` settings classes for Python).
4. Prefer **Entra ID / DefaultAzureCredential** over API keys for Azure providers
   whenever the PRD permits it.

---

### Step 6: Observability

If the PRD lists logging, tracing, or telemetry as a requirement (and even when it
doesn't — strongly recommend it), wire OpenTelemetry:

- **.NET**: register `AddOpenTelemetry().WithTracing(...).WithMetrics(...)` in the host,
  including the Agent Framework instrumentation source, and export via OTLP.
- **Python**: configure the SDK tracer/meter providers and the Agent Framework
  instrumentation hook; export via OTLP.

Verify against the latest Agent Framework observability docs that the
instrumentation source / library name has not changed.

---

### Step 7: Testing

Produce at least the following tests, scoped to what the PRD calls out:

| Test type | What it covers |
|-----------|----------------|
| **Tool unit tests** | Pure function tools, no LLM involvement. |
| **Agent unit tests** | Construct the agent with a stub / recorded chat client and assert it picks the right tool / returns the right structured output for canned inputs. |
| **Workflow tests** | Exercise the multi-agent topology with stub agents to verify routing and termination. |
| **Integration smoke test** | One opt-in test that hits the real model provider behind an environment flag (e.g. `RUN_LIVE_TESTS=1`); skipped by default in CI. |

Use the framework's official testing helpers if they exist; otherwise inject the chat
client via DI so it can be replaced with a fake in tests.

---

### Step 8: Developer Experience

1. Write a project `README.md` covering:
   - One-paragraph summary of what the solution does.
   - Prerequisites (.NET SDK or Python version, Azure CLI, provider credentials).
   - "Run it" commands (`dotnet run --project src/<ProjectName>.Host`, or
     `uv run python -m <package_name>` / `uvicorn ...`).
   - How to configure secrets / env vars.
   - How to run tests (`dotnet test`, `pytest`).
   - Link to the PRD and to https://learn.microsoft.com/en-us/agent-framework/.
2. Add a `.gitignore` appropriate to the stack (`dotnet new gitignore`, or a standard
   Python `.gitignore`).
3. Add an `.editorconfig` (use `dotnet new editorconfig` for .NET).
4. Add a minimal CI workflow at `.github/workflows/ci.yml` that runs restore/build/test
   for the chosen stack on push and pull request, **only if** the PRD or repository
   conventions call for CI. Do not invent CI when none is requested.
5. If the PRD specifies deployment to Azure, scaffold an `infra/` folder with an
   `azure.yaml` for `azd`, Bicep modules, or Aspire app host as appropriate. Otherwise
   skip infrastructure.

---

### Step 9: Verify the Scaffold Builds and Runs

Before reporting completion, run:

- **.NET**: `dotnet restore`, `dotnet build`, `dotnet test`. Confirm clean build with no
  warnings introduced by the scaffold itself.
- **Python**: `uv sync` (or `poetry install`), `ruff check`, `mypy src`, `pytest`.

If any step fails because of missing credentials (e.g. an integration test trying to
reach Azure OpenAI), guard it behind an environment variable rather than removing it,
and document the variable in the README.

---

### Step 10: Report Completion

Summarize for the user:

1. Mode, stack, and topology chosen.
2. Folder structure created (tree view).
3. Packages added and the versions used (note that you verified them against the latest
   docs, or flag that you could not and the user should double-check).
4. Required environment variables / secrets.
5. The exact commands to run the solution and the tests.
6. Open questions or assumptions made (e.g. "PRD did not specify a model deployment
   name — used `gpt-4o-mini` as a placeholder; update `appsettings.json` before
   running").
7. Suggested next step: invoke `@project-orchestrator` to execute Phase 1 of the PRD on
   top of this scaffold.

---

## Constraints

- **Do not** invent agents, tools, or workflows that are not described in the PRD. If
  the PRD is ambiguous, ask the user before adding speculative content.
- **Do not** copy verbatim code from the Microsoft docs without verifying it compiles
  against the package versions you pinned. Agent Framework APIs are still evolving.
- **Do not** commit secrets, API keys, or `.env` files. Always emit `.env.example` /
  user-secrets instructions instead.
- **Do not** introduce a second agent framework (Semantic Kernel, AutoGen, LangChain,
  etc.) into the solution. Agent Framework supersedes Semantic Kernel and AutoGen — use
  only Agent Framework packages unless the PRD explicitly requires another runtime.
- **Do not** scaffold infrastructure, CI, or evaluation tooling that the PRD does not
  ask for.
- When implementing features, verify that you are using current stable APIs,
  conventions, and best practices for Microsoft Agent Framework. If you are uncertain
  whether a pattern or API is current, search for the latest official documentation
  before proceeding.
- Make the smallest changes needed for a runnable skeleton. Specialist agents from
  `forge-build-agent-team` will fill in the feature work phase by phase.

---

## Output Standards

- Project name should be derived from the PRD's product name in **PascalCase** (.NET)
  or **snake_case** (Python). Confirm with the user if ambiguous.
- File and folder names follow the conventional layout in Step 2.
- All public types and methods (.NET) and public functions / classes (Python) carry
  doc comments / docstrings — they double as tool descriptions for the model.
- Prompt content lives in version-controlled files under `prompts/`, not in string
  literals.
- Configuration is strongly typed (Options pattern in .NET, `pydantic-settings` in
  Python). No magic strings reading directly from `process.env` /
  `Environment.GetEnvironmentVariable` outside the configuration layer.

---

## Collaboration

- **forge-build-prd / forge-build-feature-prd** — Produce the PRD or Feature PRD that
  this skill consumes. If Agent Framework is the chosen stack, ensure the PRD's
  Technology Stack section names it explicitly.
- **forge-build-agent-team** — Run **after** this skill to generate the specialist
  Copilot agent team that will implement the features on top of the scaffold.
- **forge-assign-models** — Run after the Copilot agent team is generated to assign
  appropriate LLM models to each Copilot specialist (note: this is distinct from the
  *runtime* model used by the Agent Framework agents inside the solution).
- **project-orchestrator** — Drives the implementation phases against the scaffold
  produced by this skill.
