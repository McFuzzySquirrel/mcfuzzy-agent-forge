# Architecture

This document gives a high-level view of how MyForge is structured and how the main subsystems fit together.

## Overview

MyForge is a PRD-first orchestration system for turning an idea into an implemented project. The flow is intentionally split into a few layers:

1. **Authoring and intake** - the launcher collects the idea, creates or updates the repository, and gathers the PRD and supporting context.
2. **Planning and agent generation** - the system turns the PRD into a team of specialist agents and supporting skills.
3. **Execution orchestration** - the workflow engine runs the tasks, tracks state, and handles replay and resumption.
4. **Observation and control** - the console exposes runs, logs, artifacts, and task controls through a local web UI.

## Core components

### Launcher

The launcher is the user-facing entry point. It is responsible for:

- creating or selecting a repository,
- bootstrapping the MyForge templates into the target harness,
- collecting the idea and optional PRD context,
- launching the build path or handing off to the execution engine.

It lives in [scripts/forge-launcher](scripts/forge-launcher) and is the primary entry point for interactive and headless flows.

### Workflow engine

The workflow engine is the execution core. It reads the compiled manifest, schedules tasks, tracks their state, and persists progress so runs can pause and resume.

Key responsibilities:

- dependency-aware task execution,
- concurrency management,
- replay and resume behavior,
- state persistence in the repository’s docs and runtime files.

The main reference is [docs/workflow-engine.md](docs/workflow-engine.md).

### Execution adapter

The execution adapter translates the workflow manifest into calls that can be executed through a specific harness. It is responsible for:

- mapping tasks to the appropriate agent or harness runtime,
- producing the execution manifest,
- validating outputs,
- handling per-task retries and verification.

### Workforce compiler

The workforce compiler packages the agent team and skill definitions into a form that the runtime can consume. Its job is to assemble the generated structure from the PRD and the agent plan.

### Forge Console

The Forge Console is a local web UI over the same artifacts produced by the launcher and engine. It does not replace the CLI; instead, it provides a browser-based view for:

- project selection,
- run overview,
- board and task views,
- logs and artifacts,
- pause, stop, resume, and replay controls.

The main reference is [docs/forge-console.md](docs/forge-console.md).

## Runtime data flow

A typical run follows this path:

1. The launcher creates or opens a project and bootstraps the harness files.
2. The PRD and supporting docs are captured or generated.
3. The agent team and task manifest are assembled.
4. The workflow engine executes the tasks through the adapter.
5. The console reads the generated state and artifacts to present progress to the user.

## Repository layout

- [templates](templates) - reusable agent and skill templates bootstrapped into target repos.
- [scripts](scripts) - launcher wrappers and supporting scripts.
- [docs](docs) - user guidance, deep dives, ADRs, release notes, and generated artifacts.
- [README.md](README.md) - project landing page and quick-start entry point.

## Design principles

- **PRD-first** - implementation should not begin until the quality gate is reviewed.
- **Automation with review boundaries** - mechanical work can be automated, but important decisions should remain visible and reviewable.
- **Stateful execution** - runs should be resumable and inspectable.
- **Cross-harness portability** - the same workflow should work across supported agent runtimes.
