# Offline Fallback

> Load when: agentskills.io is unreachable, internet access is missing, or page structure prevents reliable extraction.

If live source collection fails, do not fabricate updates.

## Fallback procedure

1. Declare source collection as blocked and state why (network, auth, parsing, or structural break).
2. Use only previously stored local artifacts (if available) and label them as potentially stale.
3. Downgrade all resulting proposals to medium/low confidence unless freshness can be proven.
4. Produce a temporary "monitoring plan" instead of final adoption recommendations.

## Required output in fallback mode

- Blocker summary (what failed and where)
- Evidence quality warning
- Watchlist-only recommendations unless high-confidence freshness is available
- Recheck trigger (for example: rerun when connectivity is restored)
