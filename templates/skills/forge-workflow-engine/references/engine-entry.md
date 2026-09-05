# Native workflow engine entry

The launcher is the canonical entry point for native execution:

```bash
forge-launcher engine-run --repo <repo> --harness opencode --yes
forge-launcher resume --repo <repo>
```

For direct use:

```bash
cd .agents/skills/forge-workflow-engine
npm install
npm run workflow-engine -- run --harness opencode --yes
npm run workflow-engine -- run --harness copilot --yes
npm run workflow-engine -- run --harness openai --yes
npm run workflow-engine -- run --harness stub --yes
```

The engine consumes the native execution manifest and writes workflow state,
progress, and audit artifacts. It does not compile or invoke external
workflow-package runtimes. Use `--yes` for headless execution and
`--max-retries 0` for fail-fast CI behavior.
