# Grilling Reference

Mechanics of the interview loop used by `forge-grill-idea`. Keep this open while
running a session.

## The three ideas

- **Design tree** - the subject modeled as decisions with decisions hanging off
  them. Never shown to the user as a tree.
- **Frontier** - the set of decisions whose prerequisites are all settled: the
  only questions that can honestly be asked yet.
- **Round** - one frontier, asked in full and answered in full.

Two questions never share a round if one depends on the other. When a round is
answered, the frontier moves outward and the next round is recomputed, not
pre-written.

## Question format

```
❓ 3. Authentication boundary
Do we ship accounts in v1, or is this single-user until a second user exists?
Accounts pull in email, password reset, and session storage, which roughly
doubles the first milestone.
➡️ Single-user file store in v1; add accounts only when a second real user appears.
```

Number questions so the user can answer "1 yes, 2 the second option, 3 no,
because …". The recommendation sometimes argues against the question as worded;
when that happens the user answers the recommendation and says so.

## Facts vs decisions

| Kind | Owner | How it is resolved |
|---|---|---|
| Fact | The agent | Read the repo, search, or dispatch a subagent |
| Decision | The user | Asked in a round and waited on |

Only questions downstream of a running fact-finding task wait on it; the rest of
the round proceeds. Never let the agent resolve a decision on the user's behalf.

## The frontier's honest limit

The frontier is the agent's judgement, not a computed graph. It may put two
questions in one round and only afterwards discover that one answer should have
changed the other. Tell the user when that happens and reopen the affected
branch in the next round.

## Ending

The session ends when the frontier is empty **and** the user confirms the
understanding is shared. Until that confirmation, keep asking or synthesize;
do not start writing or building.
