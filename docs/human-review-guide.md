# Human Review Guide

Use this guide when a workflow reaches a `human-review` task. The review is an
operator decision, not an agent task: read the actual deliverables, perform the
checks the contract calls for, and record what you observed. The Console or CLI
attestation records the decision and binds it to the task and evidence files; it
does not independently prove the review was thorough or authenticate reviewer
identity.

## Step-by-step review

1. **Wait for the review to be ready.** In the Console, open **Tasks** and select
   the review task. Confirm it says **Human review required**, not **Human review
   blocked**. If blocked, inspect the listed prerequisites and let them complete.
   Do not approve before the deliverables being reviewed are complete.
2. **Read the review contract.** Read the task's requirements, acceptance
   criteria, constraints, and references. In the Console, use the task detail;
   in the CLI, inspect the compiled manifest or generated task instruction under
   `docs/task-executions/`. Turn each criterion into an observable check. Note
   constraints and explicitly excluded scope.
3. **Identify the exact work to inspect.** Review the task's declared references,
   expected outputs, and prerequisite tasks. Inspect the relevant integrated
   changes (for example with `git diff` or your normal code-review tooling).
   Check wiring/reachability as well as isolated components; verify that the
   implementation is used through its real entry point when applicable.
4. **Exercise the behavior.** Follow the acceptance criteria. For a user-facing
   feature, run the application and exercise the primary user journey. For
   security, accessibility, localization, or other specialist review, use the
   contract's specified scenarios and applicable standards. Perform required
   live integration checks; mocked tests alone do not prove a live service
   integration. Do not claim a check passed if it was not run.
5. **Inspect upstream validation gaps.** In the Console, read **Unverified
   upstream checks**. This includes checks from transitive task and prerequisite
   phase dependencies. If a check is required for your decision and has not run,
   run it or record that the review cannot approve. Do not treat agent-reported
   test names as proof; inspect the test result or run the command yourself when
   needed.
6. **Decide against the criteria.** Approve only when the required observations
   pass and no blocking issue remains. Record concrete failures, missing
   evidence, or follow-up work when not approving. A local attestation is not a
   substitute for a required organizational, regulatory, or independent
   approval process.
7. **Record durable evidence.** Keep review evidence concise and specific:
   environment/build reviewed, scenarios exercised, commands or checks run,
   observed outcomes, and any limitations/findings. Use a repository-local
   evidence file if you use the CLI, or enter these notes in the Console form.
   Do not include secrets or unnecessary personal/sensitive data.
8. **Submit the approval only after the review.** In the Console, select
   **Complete human review**, enter your reviewer name and findings (at least 40
   characters), explicitly attest that you performed and approve the review,
   then submit. The Console writes
   `docs/reviews/<task-id>-console-review.md`, records the configured
   `reviewFile` attestation, and resumes the run when appropriate.
9. **For CLI approval, provide the evidence file explicitly.** From the installed
   workflow-engine skill directory:

   ```bash
   npm run workflow-engine -- approve-task <task-id> \
     --repo <repo-path> \
     --reviewer "Reviewer Name" \
     --evidence docs/reviews/<task-id>-evidence.md \
     --confirm-human-review

   npm run workflow-engine -- run --repo <repo-path> --harness <harness> --yes
   ```

   Repeat `--evidence` for each evidence file. The evidence paths must be
   repository-relative and contain non-empty review material.
10. **Verify the workflow resumed correctly.** Confirm the task is complete and
    the run progressed. If review inputs or evidence changed after approval, the
    task-bound attestation becomes stale and the review must be performed again.

## Suggested review-notes format

```text
Scope/build reviewed:
Criteria and scenarios exercised:
Commands or live checks run:
Observed outcomes:
Findings or limitations:
Decision and rationale:
```

Replace the prompts with actual evidence. Never record checks as passing merely
because an agent reported success. If a required criterion remains unverified,
leave it unresolved and do not approve.

## What the attestation means

The Console and CLI use the same content-bound engine verification. Approval
records the task ID, current task/reference fingerprint, reviewer-entered name,
timestamp, decision, and hashes of evidence files. Changes to the task, selected
references, or evidence invalidate the approval. This is repository-local
operator evidence, not authenticated identity or a security boundary against an
agent that can write to the repository.

See [Task contracts: Human review](task-contracts.md#human-review),
[the Console walkthrough](forge-console-user-guide.md#human-review-when-it-pauses-and-how-to-prove-approval),
and [ADR-049](adr/049-human-review-evidence-and-console-completion.md).
