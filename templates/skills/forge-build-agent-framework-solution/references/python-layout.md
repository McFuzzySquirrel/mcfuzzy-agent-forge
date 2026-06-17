# Python Project Layout

The standard project layout for Microsoft Agent Framework Python solutions.

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
