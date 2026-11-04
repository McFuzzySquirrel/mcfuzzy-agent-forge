# 03: Route Projects to their next action and recover by stage

**What to build:** Opening a Project takes the user to its next meaningful
action. Blockers, failures, unavailable repositories, and completed Projects
remain understandable and recoverable without losing Project history.

**Blocked by:** 02: Review a Project brief before starting a Build.

**Status:** resolved

- [x] New, partially authored, needs-review, preparing, ready-to-start,
  running, blocked, failed, and completed Projects each present their decided
  next action.
- [x] A blocked Project identifies the exact user action stopping progress. If
  work can continue, it retains its Preparing or Running state and surfaces the
  blocker without changing the execution state.
- [x] A failed Project explains which stage failed and offers recovery for that
  stage without discarding completed work or Project history.
- [x] A completed Project opens on its Project files.
- [x] Existing repositories enter the same lifecycle at their current state;
  they are not treated as a separate lifecycle state.
- [x] An unavailable Project remains listed with a reconnect or recovery
  action.
- [x] **Add a feature** remains a contextual existing-Project action, uses
  interactive authoring, and requires review of generated Tasks before they
  run.
- [x] Affected Console documentation and visual captures reflect the delivered
  behavior.
