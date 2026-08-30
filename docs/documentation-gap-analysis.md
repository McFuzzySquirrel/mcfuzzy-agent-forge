# Documentation map and missing pieces

This repository already has strong coverage for the launcher, console, workflow engine, testing, and release notes. The main gaps are in the areas that help new contributors and operators get productive quickly.

## Current documentation coverage

| Area | Current coverage | Notes |
| --- | --- | --- |
| Project overview | [README.md](../README.md) | Good landing page with quick start and high-level workflow. |
| Launcher usage | [docs/forge-launcher.md](forge-launcher.md) | Strong CLI reference. |
| Console usage | [docs/forge-console.md](forge-console.md) | Good feature and workflow reference. |
| Workflow engine | [docs/workflow-engine.md](workflow-engine.md) | Solid execution model overview. |
| Prompting flow | [docs/prompt-playbook.md](prompt-playbook.md) | Useful for manual prompting guidance. |
| Testing | [docs/testing-guide.md](testing-guide.md) | Good validation guidance. |
| Local model setup | [docs/running-with-local-models.md](running-with-local-models.md) | Helpful environment-specific notes. |
| Release notes | [docs/updates.md](updates.md) | Good history and changelog-style reference. |

## Missing or thin documentation

### 1. Architecture overview
**Priority: High**

A single architecture document would help readers understand how the launcher, workflow engine, execution adapter, workforce compiler, and console fit together. This is the most important missing document for new contributors.

Suggested file: [docs/ARCHITECTURE.md](ARCHITECTURE.md)

### 2. Contributor guide
**Priority: High**

The repository does not yet have a contributor-focused guide that explains:

- local development setup,
- package-level responsibilities,
- coding conventions,
- how to run tests and type checks,
- how to open a PR and validate changes.

Suggested file: [CONTRIBUTING.md](../CONTRIBUTING.md)

### 3. Troubleshooting and FAQ
**Priority: High**

Common issues are currently scattered across several documents. A dedicated troubleshooting guide would make it easier to answer questions about:

- missing harness binaries,
- launcher bootstrap failures,
- console startup issues,
- engine pause/stop behavior,
- local model configuration issues.

Suggested file: [docs/TROUBLESHOOTING.md](TROUBLESHOOTING.md)

### 4. End-to-end tutorial
**Priority: Medium**

There is strong reference material, but a guided tutorial would be valuable for first-time users. A short walkthrough could show:

- how to create a project,
- how to review and refine the PRD,
- how to launch the build,
- how to inspect results in the console.

Suggested file: [docs/TUTORIAL.md](TUTORIAL.md)

### 5. Release and publishing process
**Priority: Medium**

The repository has release notes, but it would help to document the expected release flow for the launcher package and related artifacts.

Suggested file: [docs/RELEASES.md](RELEASES.md)

### 6. Security and operational notes
**Priority: Medium**

The console and launcher have several safety-related behaviors, including loopback-only serving and token-based protections. A short operations/security doc would make those expectations explicit.

Suggested file: [docs/OPERATIONS.md](OPERATIONS.md)

## Recommended next steps

1. Add a top-level architecture document.
2. Add a contributor guide with setup and PR expectations.
3. Add a troubleshooting guide for common failures.
4. Add a short tutorial for first-time users.
5. Link these new docs from the main README.
