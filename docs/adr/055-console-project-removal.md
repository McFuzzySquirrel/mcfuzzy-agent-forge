# ADR-055: Repository-preserving Console project removal

- **Status:** Accepted
- **Date:** September 2026

## Context

The Console remembers projects and detached job history outside repositories.
Users need to forget individual or multiple projects, including stale folders,
without uninstalling Forge or touching any project content.

## Decision

Provide per-row **Remove from Forge** and bulk **Remove selected (N)** controls
in a project table with aligned checkboxes, name, state, and last accessed
date/time. Require explicit confirmation that no files inside project folders
will be changed or deleted. Return independent outcomes for each project.

The token-gated removal endpoint removes registry records and associated Console
job history only after checking every unfinished associated job and the
repository's engine PID. Running or paused jobs whose process is still alive
block removal. A running job with no PID is conservatively blocked. Completed and
failed jobs are not probed: their recorded PIDs may since have been reused by
unrelated processes, and treating those as live would make projects unremovable.
Removal never kills jobs.

Only exact Console-generated result paths with a matching terminal receipt are
eligible for file cleanup. Resolve physical paths and existing ancestors, reject
storage inside registered project/job roots or Git repositories, and preserve
linked, shared, and unverified result files. Never recursively delete a project
or follow arbitrary job log/result paths. Strict registry/history reads prevent
malformed data from being silently replaced with empty lists. Strictness targets
unreadable structure, not legacy content: registry records with relative paths
or no name are intact and preserved. Because a relative record's real location
is unknowable, it matches only by exact text and is never resolved against the
Console's working directory. New registry entries are stored as absolute paths.

Removal runs synchronously with respect to this Console's request handling and
job launches. Each project is independent: an error does not cancel the remaining
bulk entries. Each store is replaced atomically to avoid truncating other
projects' records on a failed write. Registry-save failure attempts to restore the associated job
history. External receipts already deleted before a failure are not recoverable;
the failure message explicitly states that limitation. This is not a
cross-process transaction across independent Console instances.

Clear the current project and broadcast the empty snapshot when it is removed.
Missing folders remain removable, and existing folders can be registered again
without bootstrapping.

## Consequences

- Source, Git data, documentation, configuration, agents, skills, logs, and
  generated repository artifacts remain untouched.
- Shared settings and other projects' history/results remain intact.
- Suspicious or unverifiable files may remain outside repositories. Conservative
  preservation is preferable to deleting data without proven ownership.
- Forge storage configured inside a project cannot be cleaned by this operation;
  removal reports a failure rather than violating the preservation guarantee.
- No migration or repository rewrite is required.

## Alternatives

- **Uninstall Forge from the repository:** rejected; it violates the requested
  repository-preservation boundary.
- **Delete every path in job history:** rejected; history can reference project
  logs, shared results, links, or unrelated files.
- **Terminate jobs automatically:** rejected; removal is not an execution
  control and must not disrupt active work.

## References

- [Console removal implementation](../../scripts/forge-launcher/scripts/console/remove-projects.ts)
- [Console reference](../forge-console.md#remove-from-forge)
- [User guide](../forge-console-user-guide.md#remove-one-or-more-projects-from-forge)
