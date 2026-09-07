# Discussion Document: PRD Context, Task Pointers, and Prompt Size

## Purpose

This document captures the proposed direction for addressing prompt-length failures
during task execution while preserving the detail needed for reliable downstream
work.

## The Problem

The current execution path can make a task prompt too large by combining:

- the full PRD;
- the decomposed PRD or feature document;
- task instructions;
- previous task outputs; and
- duplicated copies of the same requirements.

When the resulting prompt exceeds the model's context limit, execution fails before
the task starts.

This is primarily a **context management and ownership problem**, not a reason to
remove important planning detail.

## Proposed Direction

Use a small, structured task envelope instead of embedding all planning content in
every prompt.

Each task should identify:

- **Task ID**
- **Skill to run**
- **Relevant PRD, product-vision, or feature file**
- **Input artifact or task pointers**
- **Expected outputs**
- **Validation requirements**
- **Dependencies**

The task receives pointers to the information it needs. The skill or execution
layer then uses progressive disclosure to read the relevant content at the point
where it is needed.

## PRD and Decomposition Model

For larger projects, the preferred structure is:

```text
docs/PRD.md
docs/product-vision.md
docs/features/*.md
```

The documents have different responsibilities:

- `docs/PRD.md` is the overview and navigation document.
- `docs/product-vision.md` contains cross-cutting goals, architecture,
  technology choices, security, accessibility, and other concerns shared by
  multiple features.
- `docs/features/*.md` contain focused, independently executable feature
  requirements.

The main PRD should point to the decomposed documents rather than repeating their
full contents.

The repository currently supports monolithic PRDs for smaller projects, so making
decomposition mandatory would be a policy change. The immediate prompt-size fix
should not require removing that compatibility path.

## Task Inputs and Outputs

Pointers should not make task contracts less precise. Each task should still state
what it needs and what it produces.

### Inputs

Inputs may include:

- a task ID;
- an artifact ID;
- a repository-local file path;
- a prior task's declared interface; or
- a dependency that must be complete first.

### Outputs

Outputs should remain explicit and machine-readable where possible:

- named artifacts;
- changed files;
- exported interfaces;
- decisions that downstream tasks must know; and
- validation results.

The next task should consume the prior task's artifact pointer and declared
interface, rather than receiving the entire prior prompt and PRD again.

## Progressive Disclosure Requirement

A pointer only solves the problem if the execution layer does not immediately
expand every referenced document into the prompt.

Progressive disclosure should therefore be an execution rule:

1. Start with the task envelope.
2. Load the relevant feature or task document.
3. Read shared product-vision content only when the task needs it.
4. Retrieve prior artifacts through their declared projections.
5. Avoid reloading unrelated features, completed task prompts, or duplicate PRD
   sections.

The skill should own the interpretation of its focused requirements, while the
execution layer should enforce context boundaries.

## Questions for Discussion

1. Should decomposition become the default for all new projects, with monolithic
   PRDs retained only for compatibility?
2. Which fields must be present in every task envelope?
3. Which artifact fields are sufficient for downstream tasks?
4. Should skills receive file paths, artifact IDs, task IDs, or a combination?
5. Where should progressive disclosure be enforced: in the skill, the manifest
   compiler, the workflow engine, or all three?
6. How should a task declare the expected input and output interface for the next
   task?
7. What safeguards should detect accidental prompt expansion before execution?

## Desired Outcome

The goal is not to make PRDs smaller or less rigorous. The goal is to keep
high-quality planning documents available while ensuring that each execution
prompt contains only the focused context required for its task.

In short:

> Keep the detail in the PRD and feature documents; pass pointers through task
> contracts; disclose only the context needed at each step.
