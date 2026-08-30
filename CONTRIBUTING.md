# Contributing

Thanks for helping improve MyForge.

## Development setup

1. Clone the repository.
2. Install Node.js 18 or newer.
3. Install the launcher package dependencies:

```bash
cd scripts/forge-launcher
npm install
```

## Common commands

Run the test suite:

```bash
cd scripts/forge-launcher
npm test
```

Run type checking:

```bash
cd scripts/forge-launcher
npm run typecheck
```

Build the package:

```bash
cd scripts/forge-launcher
npm run build
```

## Repository conventions

- Keep documentation in sync with behavior changes.
- Update the relevant docs when you change the launcher, engine, or console flow.
- Prefer small, focused changes with clear intent.
- Preserve the project’s PRD-first and review-boundary philosophy.

## Pull request expectations

- Summarize what changed and why.
- Include any user-facing documentation updates.
- Mention relevant tests or verification steps.
- Keep changes scoped and easy to review.

## Where to look

- [README.md](README.md) for project overview and usage.
- [docs/forge-launcher.md](docs/forge-launcher.md) for launcher behavior.
- [docs/forge-console.md](docs/forge-console.md) for console behavior.
- [docs/workflow-engine.md](docs/workflow-engine.md) for engine behavior.
- [docs/testing-guide.md](docs/testing-guide.md) for validation expectations.
