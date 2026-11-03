# 07: Complete the Board keyboard and screen-reader contract

**What to build:** Keyboard and screen-reader users can understand and operate
the Board, open Task details, and retain their place as the Board changes.

**Blocked by:** 06: Make the Board semantic and consistent across views.

**Status:** resolved

- [x] Every visual Task card or bar has an equivalent semantic DOM control
  operable with standard keyboard focus and Enter/Space.
- [x] Selecting a Task moves focus into its details; closing details restores
  focus to the originating Task control.
- [x] Switching Board views, filtering, and rerendering retain logical focus
  when the selected Task remains available.
- [x] Dependency and artifact relationships are available as structured text
  in Task details and are not pointer-only or placed in the focus order.
- [x] Significant changes, including failures, Human review readiness, and
  cleared blockers, are announced; routine progress and animation are not.
- [x] Affected Console documentation and visual captures reflect the delivered
  behavior.
