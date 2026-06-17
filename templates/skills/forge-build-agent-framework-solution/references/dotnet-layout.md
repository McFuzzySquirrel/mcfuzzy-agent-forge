# .NET Project Layout

The standard project layout for Microsoft Agent Framework .NET solutions.

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
