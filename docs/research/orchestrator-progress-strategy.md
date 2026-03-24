# Research: Orchestrator Progress Tracking and Bootstrap Fix

**Date:** 2026-03-24
**Status:** Implemented

---

## Question

Three issues were raised that need to be addressed:
1. The PowerShell bootstrap script errors with "The property 'Path' cannot be found on this object" on the line `$Target = $Target.Path`
2. The orchestrator should commit small units of work as it progresses, ideally after builds and tests pass
3. There is no mechanism to track completed and pending tasks in the repo, making it impossible to continue work on a different machine

---

## Current State Analysis

### Issue 1: PowerShell Bootstrap `.Path` Property Error

| File | Line | Code | Problem |
|------|------|------|---------|
| `scripts/bootstrap.ps1` | 44 | `$Target = Resolve-Path $Target -ErrorAction SilentlyContinue` | `Resolve-Path` returns a `PathInfo` object in some PowerShell versions, a string in others |
| `scripts/bootstrap.ps1` | 50 | `$Target = $Target.Path` | Fails when the result is already a string (no `.Path` property) |

**Root cause**: `Resolve-Path` returns a `System.Management.Automation.PathInfo` object in Windows PowerShell 5.1, which has a `.Path` property. However, behavior varies across PowerShell versions and environments. With `Set-StrictMode -Version Latest` enabled (line 30), accessing a non-existent property throws a terminating error rather than silently returning `$null`.

**Comparison**: The bash equivalent (`scripts/bootstrap.sh`, line 39) uses `realpath` which always returns a string. The PowerShell script should behave the same way.

### Issue 2: Orchestrator Does Not Commit Incrementally

The current `project-orchestrator.md` has no instructions for committing work during execution:

| Section | What It Does | What's Missing |
|---------|-------------|----------------|
| Task Execution (Step 5) | "Document completion" | No instruction to commit the completed work |
| Phase Completion | Reviews deliverables, verifies criteria, summarizes | No instruction to commit the phase |
| Progress Updates | Summarizes, lists files, previews next phase | No mention of persisting state to the repository |

**Impact**: All work exists only in the current session. If the session ends unexpectedly, progress may be lost. Work cannot be reviewed incrementally via version control history.

### Issue 3: No Persistent Task Tracking

The orchestrator currently tracks state "mentally" (in conversation context):

| Section | Reference | Approach |
|---------|-----------|----------|
| Monitor Progress (Section 4) | Line 155 | "Track completed vs remaining work" — but only in conversation |
| Tips | Line 469 | "Track state mentally" — explicitly ephemeral |
| Commands | Line 255 | "Resume from last checkpoint" — but no checkpoint mechanism exists |

**Impact**: The "Resume from last checkpoint" command (line 255) cannot actually work because there is no persistent record of what was completed. Switching machines or starting a new session loses all context.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `Convert-Path` behaves differently than `Resolve-Path` | Low | Low | `Convert-Path` is a standard cmdlet since PS 1.0, returns a string, and handles the same path resolution. Verified it accepts the same inputs. |
| Orchestrator commit instructions conflict with user workflow | Low | Medium | Instructions say to commit after builds/tests pass, giving users control. Progress file is optional context, not blocking. |
| Progress file becomes stale or inaccurate | Medium | Low | File is updated as part of each commit, not separately. The orchestrator is instructed to always update it before committing. |
| Breaking existing orchestrator behavior | Low | Low | All changes are additive — new steps added to existing process, new section added. No existing behavior is modified. |

---

## Implementation Plan

### Change 1: Fix PowerShell Bootstrap Script

**File**: `scripts/bootstrap.ps1`

Replace `Resolve-Path` with `Convert-Path` for the `$Target` variable. `Convert-Path` resolves a path and returns a **string** directly, eliminating the need for `.Path` property access.

- **Line 44**: Change `Resolve-Path` to `Convert-Path`
- **Line 50**: Remove `$Target = $Target.Path` (no longer needed)

### Change 2: Add Incremental Commit Instructions to Orchestrator

**File**: `templates/agents/project-orchestrator.md`

Add a new step 6 to the Task Execution subsection instructing the orchestrator to commit after each successful task (when builds and tests pass). Add a step 4 to Phase Completion for committing remaining phase work.

### Change 3: Add Progress Tracking File Section to Orchestrator

**File**: `templates/agents/project-orchestrator.md`

Add a new Section 6 "Maintain Progress Tracking File" that instructs the orchestrator to:
- Create and maintain a `docs/PROGRESS.md` file in the target repository
- Update it after each task with status, files modified, and notes
- Include it in every commit
- Use it when handling "Resume from last checkpoint" commands

Update the "Resume from last checkpoint" command description to reference this file.

---

## Summary

| Change | File(s) | Type | Risk |
|--------|---------|------|------|
| Fix `.Path` property error | `scripts/bootstrap.ps1` | Bug fix | Low |
| Add incremental commit guidance | `templates/agents/project-orchestrator.md` | Enhancement | Low |
| Add progress tracking file | `templates/agents/project-orchestrator.md` | Enhancement | Low |
