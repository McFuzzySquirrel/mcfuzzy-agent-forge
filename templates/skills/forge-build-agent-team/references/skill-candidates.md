# Skill candidate handoff

`docs/SKILL-CANDIDATES.json` is the durable boundary between team planning and
independent project-skill generation. The team stage plans candidates; the
skills stage owns package creation and review.

## Version 1 shape

```json
{
  "version": 1,
  "candidates": [
    {
      "name": "release-validation",
      "description": "Repeatable release verification for generated artifacts.",
      "consumers": ["release-engineer"],
      "action": "create",
      "reason": "The process repeats across release phases."
    }
  ]
}
```

Only a valid `{ "version": 1, "candidates": [] }` handoff, or a valid list
whose actions are all `omit`, is an explicit `complete` /
`no-skills-required` outcome. A missing or malformed handoff is an error.
Legacy projects without handoff markers retain the old build path until an
explicit draft-team adoption. The skills stage must preserve the immutable
handoff, unaffected packages, and manifest IDs. Stage status, fingerprints,
outputs, errors, timestamps, and invocation provenance belong in
`docs/authoring-state.json` or separate review artifacts, not this handoff.
