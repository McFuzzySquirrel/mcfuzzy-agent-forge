# Agent Framework Package References

Package names and namespaces are evolving. Always verify against https://learn.microsoft.com/en-us/agent-framework/ before adding.

## .NET Packages

| Package | Purpose | Target Project |
|---------|---------|----------------|
| `Microsoft.Agents.AI` | Core agent abstractions, single-agent runtime | `<ProjectName>.Agents` |
| `Microsoft.Agents.AI.OpenAI` | Provider package for Azure OpenAI / OpenAI | `<ProjectName>.Agents` |
| `Microsoft.Agents.AI.AzureAI` | Provider package for Azure AI Foundry | `<ProjectName>.Agents` |
| `Microsoft.Agents.AI.Workflows` | Multi-agent orchestration, workflows | `<ProjectName>.Workflows` |
| `Microsoft.Extensions.AI` | AI building blocks, middleware pipeline | `<ProjectName>.Host` (if needed) |
| `Microsoft.Extensions.Hosting` | Generic Host, DI, configuration | `<ProjectName>.Host` |
| `Microsoft.Extensions.Configuration.UserSecrets` | Local secret storage (dev only) | `<ProjectName>.Host` |
| `OpenTelemetry.Extensions.Hosting` | OpenTelemetry hosting integration | `<ProjectName>.Host` |
| `OpenTelemetry.Exporter.OpenTelemetryProtocol` | OTLP exporter | `<ProjectName>.Host` |

Use **central package management** via `Directory.Packages.props` to pin all versions in one place.

## Python Packages

| Package | Purpose | Dependencies Group |
|---------|---------|-------------------|
| `agent-framework` | Core agent framework SDK | Runtime |
| `agent-framework[azure-ai]` | Azure AI Foundry provider extra | Runtime |
| `agent-framework[openai]` | Azure OpenAI / OpenAI provider extra | Runtime |
| `agent-framework-mcp` | MCP tool support | Runtime (if MCP tools required) |
| `fastapi` | HTTP API host | Runtime (web host only) |
| `uvicorn[standard]` | ASGI server | Runtime (web host only) |
| `pydantic` | Data validation, settings | Runtime |
| `pydantic-settings` | Strongly typed configuration | Runtime |
| `python-dotenv` | .env file loading | Runtime |
| `opentelemetry-api` | OTel API | Runtime (if OTel required) |
| `opentelemetry-sdk` | OTel SDK | Runtime (if OTel required) |
| `opentelemetry-exporter-otlp` | OTLP exporter | Runtime (if OTel required) |
| `pytest` | Test runner | Dev |
| `pytest-asyncio` | Async test support | Dev |
| `ruff` | Linter + formatter | Dev |
| `mypy` | Static type checker | Dev |

Verify exact package names against the official Agent Framework docs before installing.
