# Launcher bug: `reuse` skill candidates cannot complete the skills stage

> **Status: fixed in v3.83** — see
> [ADR-054](adr/054-reuse-candidates-are-not-authored-outputs.md) and
> [`docs/updates.md`](updates.md). Points 1, 2, 3, and 5 below are addressed;
> point 4 is resolved as "no verification" (a deliberate, documented limit).
> Point 2 needed a different fix than proposed: switching the fixture from
> `reuse` to `create` alone would have made the stub author a valid package, so
> the test also uses `FORGE_STUB_NOOP=1` so the stage authors nothing and the
> test supplies the packages. The `agent-ping` workaround below is no longer
> needed and can be removed.

**Component:** `forge-launcher` (`mcfuzzy-agent-forge/scripts/forge-launcher`)
**Severity:** blocks the skills authoring stage for any project that reuses an existing package
**Found while:** authoring the project-skills stage for `agent-ping`

---

## Summary

`validateAuthoringOutputs` treats `action: "reuse"` identically to `create`/`extend`, so it
requires a project-local `SKILL.md` for reused skills. A `reuse` candidate exists precisely
because its package is already available elsewhere (globally installed, or upstream), and
vendoring a project copy reintroduces the version drift that `reuse` exists to prevent.

Any project whose team legitimately reuses an existing package cannot complete the skills stage.

---

## Where

`scripts/forge-launcher/scripts/launcher.ts:563-571`

```ts
const planned = candidates.candidates.filter((candidate) => candidate.action !== "omit");
const outputs = planned.map((candidate) =>
  path.join(harnessRootDir(), "skills", candidate.name, "SKILL.md"));
for (const output of outputs) {
  if (!fs.existsSync(path.join(state.repoDir, output)) ||
      !fs.readFileSync(path.join(state.repoDir, output), "utf8").trim()) {
    throw new Error(`Planned project skill is missing or empty: ${output}`);
  }
}
```

`reuse` is never excluded, so a reused skill is validated as if it had to be authored in this
repository.

---

## Evidence it contradicts the intended design

The stub runner in the same file already gets this right — `scripts/launcher.ts:773`:

```ts
if (candidate.action === "omit" || candidate.action === "reuse") continue;
```

The two code paths disagree about what `reuse` means.

---

## Observed failure (agent-ping)

The handoff has 8 candidates. `pixijs` is `action: "reuse"` because PixiJS 8.21.0 guidance is
installed globally (`~/.agents/skills/`, one router plus 25 topic packages). The skills stage
fails with:

```
error: Planned project skill is missing or empty: .opencode/skills/pixijs/SKILL.md
```

All six packages the stage actually authored pass both launcher checkers. This is the only
failure.

---

## Heads-up: the current behavior is test-locked

This is **not a one-line fix**.

`scripts/forge-launcher/scripts/authoring.test.ts:618-624` — the test *"planned missing or
structurally invalid skills fail the durable gate"* — maps **every** candidate to
`action: "reuse"` and then asserts:

```ts
await assert.rejects(runDraftSkills(repo, stub), /Planned project skill is missing/);
```

The test's real intent — a planned skill that is missing or structurally invalid must fail the
durable gate — is about `create`/`extend`. Using `reuse` to make a candidate "planned" is
incidental, and it cements the wrong semantics.

Consequence: skipping `reuse` in the validator makes that assertion fail, because an all-`reuse`
candidate list yields `outputs: []` and resolves successfully instead of rejecting.

---

## What I think we should change

1. **`launcher.ts:565`** — derive planned outputs from authored actions only, matching line 773:

   ```ts
   const planned = candidates.candidates.filter(
     (candidate) => candidate.action === "create" || candidate.action === "extend");
   ```

2. **`authoring.test.ts:618-624`** — change the fixture override from `reuse` to `create`, so the
   original intent (a missing or invalid planned skill fails the gate) is preserved and now
   exercises the correct path.

3. **`noSkillsRequired` is derived from output count** — `launcher.ts:679`:

   ```ts
   if (stage === "skills") outcome.noSkillsRequired = outcome.outputs.length === 0;
   ```

   After the fix, an all-`reuse` handoff produces `outputs: []` and would be recorded as *"no
   skills required"* — which is wrong. Those skills **are** required; they are simply not authored
   here. Two existing tests depend on this field (`:465` for an empty candidate list, `:483` for
   all-`omit`), so it is a real signal. Suggest distinguishing all-`reuse` from all-`omit` rather
   than overloading one flag.

4. **Worth deciding: should `reuse` be verified at all?** A `reuse` candidate that names a package
   which does not actually resolve currently passes silently. We cannot reliably enumerate every
   harness's global skill roots, so a warning — or a check only where roots are known — may be the
   pragmatic call.

5. **Add a regression test** — a handoff containing a `reuse` candidate with no project package
   must reach `ready: true`.

---

## Interim workaround (agent-ping is unblocked) — *historical, no longer needed*

> Superseded by the v3.83 fix. Kept as a record of how the reported project was
> unblocked in the meantime.

Added `.opencode/skills/pixijs/SKILL.md` as a pure delegation stub: no PixiJS API guidance, only
routing to the 26 global packages, plus a `references/topic-map.md` with the full topic map. It
passes both launcher checkers.

Trade-off: a project-local `pixijs` may shadow the global router in harness resolution order.

This is a stopgap and should be removed once the launcher is fixed.
