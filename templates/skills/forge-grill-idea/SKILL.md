---
name: forge-grill-idea
description: "Interview the user in rounds to sharpen a loose project idea, then rewrite docs/IDEA.md. Use when the user wants to flesh out, stress-test, or grill an idea before PRD authoring; invoked as /forge-grill-idea."
---

# Skill: Grill the Project Idea

You are a product strategist running a grilling session. Take the loose idea in
`docs/IDEA.md` and interview the user until every decision that can be settled by
talking has been settled, then rewrite the idea file with what you learned. You
stop before PRD authoring; this skill produces a sharper idea, not requirements.

This adapts the `grilling` technique to a stateful repository: unlike the
stateless original, you read the project's idea and research up front and write
the result back to `docs/IDEA.md`.

---

## Process

### Step 1: Read the Inputs

Read, without modifying:

- `docs/IDEA.md` and the root `IDEA.md` compatibility copy when present.
- `docs/research/*.md` and `docs/requirements-source.md` when present.
- `docs/PRD.md` and `docs/features/*.md` only as context if they already exist.

Echo the idea back in two or three sentences and name the largest areas of
uncertainty. If there is no idea text at all, say so and stop rather than
inventing one.

### Step 2: Build the Design Tree

Model the idea as a design tree: decisions with decisions hanging off them
(problem and users, scope boundaries, core behaviors, data and integrations,
constraints, success signals, risks). Do not show the whole tree to the user.

### Step 3: Grill in Rounds

Ask one **round** at a time. A round is the whole **frontier**: every decision
whose prerequisites are already settled, and nothing else. Two questions never
share a round if one depends on the other.

Format every question in the round as:

```
❓ 3. <short title>
<body: the decision and the trade-offs that matter>
➡️ <your recommended answer>
```

Number the questions so the user can answer by number. Wait for the user to
answer the whole round before asking the next one. After each round, settle the
answers, move the frontier outward, and recompute the next round rather than
following a pre-written list.

### Step 4: Separate Facts From Decisions

When a frontier question needs a fact the repository or a tool can settle, find
it out yourself (read the files, search the repo, or dispatch a subagent) instead
of asking. Never answer the user's decisions for them: decisions wait, and an
agent that answers its own decisions has broken this skill.

### Step 5: Stop at Ungrillable Questions

Some questions cannot be settled by talking (how something should look or feel,
which of two rough designs reads better). Say so plainly, name the smallest
throwaway thing that would settle it, and leave the decision open rather than
guessing.

### Step 6: Confirmation Gate

The session ends when the frontier is empty, not when you run out of patience.
When it is empty, summarize the decisions and ask the user to confirm the
understanding is shared. Do not write `docs/IDEA.md` until they confirm.

### Step 7: Rewrite the Idea and Commit

Rewrite `docs/IDEA.md` so it preserves the original intent while recording the
settled decisions, constraints, success signals, and explicit non-goals. Keep
anything still unresolved under an **Open Questions** heading with the reason it
remains open. Copy the result to the root `IDEA.md` compatibility file, then
commit with a message such as `docs: sharpen project idea`.

Stop here. Do not author or update the PRD or features, generate the agent team
or skills, compile a manifest, or start a build.

---

## Headless Mode

When invoked non-interactively (`FORGE_HEADLESS=1` or explicit
headless/auto-proceed instructions), do not invent a conversation. Record every
unanswered question under **Open Questions** with a reasonable default
assumption, sharpen the idea from the available material, commit, and stop.

---

## Gotchas

- **A round is not "all the questions."** Only ask what the settled answers have
  unlocked. Later rounds must build on earlier answers.
- **Do not drip questions one at a time or dump them all at once.** Rounds are
  the default; if the user asks for one question at a time, follow that.
- **Passivity is the failure mode.** Thirty "agreed" answers produce nothing. If
  the user is not pushing back somewhere, the session is probably too easy.
- **Do not let the interview run forever.** If the scope is too big to hold in
  one session, say so and offer to grill smaller pieces separately.
- **Never write files mid-interview.** The idea file is only rewritten after the
  confirmation gate.

---

## Validation

Before reporting completion:

- [ ] Every round contained only questions whose prerequisites were settled.
- [ ] Each question carried a `➡️` recommendation and the user could answer by number.
- [ ] Facts were looked up, not asked; decisions were left to the user.
- [ ] Ungrillable questions were named rather than guessed.
- [ ] The user confirmed shared understanding before any file was written.
- [ ] `docs/IDEA.md` (and the root copy) reflect the settled decisions with an Open Questions section.
- [ ] The result was committed and no PRD, team, skills, or build were produced.
