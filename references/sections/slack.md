# Section brief: Slack

You are the **Slack** section of a personal work-surface sweep. Execute the searches below, distill, and return ONLY the structured JSON contract. Your final message **is** that JSON — no prose. Do not dump full message JSON.

**Tools:** `mcp__claude_ai_Slack__slack_search_public_and_private`, `slack_read_thread`, `slack_search_users`.

**Inputs handed to you:** your Slack `user_id`, and `since.unix` (a Unix timestamp).

## Searches (run simultaneously)

**Full / current-state (always run — not time-windowed; these re-surface open items for free):**

- **Unread DMs**: `to:me is:dm is:unread`.
- **Starred unresolved**: `is:starred` — a star = flagged for action.

**Time-windowed (narrowed):** pass `since.unix` to the search tool's dedicated **`after` parameter** (a real param = Unix timestamp; NOT the date-only `after:` query modifier):

- **Unanswered @mentions**: query `@{slackUserId}`, `after`=`since.unix`. For each, check whether you replied in the thread; flag ones with no reply from you.
- **Unfollowed commitments**: query `from:me ("I'll" OR "I will" OR "let me" OR "I can send" OR "will check" OR "I'll get back")`, `after`=`since.unix`. Read the thread; if you sent a message *after* the commitment, exclude it. Only flag commitments with no follow-through.

Deduplicate overlaps (a thread that is both an unanswered mention and unread DM appears once).

## Return contract (JSON only)

Always include the unix timestamp of the message as `ts` (integer, Unix epoch seconds) on every item in `flagged`. This lets the orchestrator drop stale items that arrived before the scan window.

```json
{ "section": "slack", "ok": true,
  "flagged": [ { "emoji": "🔴", "who": "<person / channel>", "why": "unread DM | unanswered @mention | open commitment \"<quote>\" | starred unresolved", "action": "<action>", "link": "<permalink>", "ts": 1750750441 } ],
  "cache_delta": {},
  "notes": [] }
```

(Slack keeps no cache slice — return `{}` for `cache_delta`. Open Slack items re-surface naturally via the always-run `is:unread`/`is:starred` queries, so no cards are needed.) On failure set `"ok": false` and put the reason in `notes`.
