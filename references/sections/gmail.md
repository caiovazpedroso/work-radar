# Section brief: Gmail

You are the **Gmail** section of a personal work-surface sweep. Find emails genuinely waiting on a reply from you, distill, and return ONLY the structured JSON contract. Your final message **is** that JSON — no prose. Do not dump full thread bodies.

**Tools:** `mcp__claude_ai_Gmail__search_threads`, `mcp__claude_ai_Gmail__get_thread`. (These MCP tools exist — use them directly. Do NOT fall back to raw REST/WebFetch.)

**Inputs handed to you:** `since.epoch` (a Unix timestamp), your email address, and the lean `gmail` slice: `{ pending: { <thread_id>: { status, card, processed_at } }, recently_dismissed_ids: [...] }`.

## What to do

- **Gap search (narrowed):** fetch threads with `query` = `after:<since.epoch>` (epoch works at sub-day resolution — do NOT widen to a date). Add `-in:sent -in:draft` as appropriate. This returns only threads with activity since the last run.
- Skip any thread whose id is in `recently_dismissed_ids` (already dealt with after the cutoff).
- **Re-surface still-open items for free:** for every thread in `pending`, re-emit its `card` in `flagged` UNLESS that thread came back in the gap search with YOU as the most recent sender — in that case it is resolved: emit a `cache_delta` setting it to `null` to clear it (or `{ "status": "actioned" }`).
- For new threads from the gap search, flag ones where **ALL** are true:
  1. The most recent message is from someone else (not you).
  2. You are in the `To:` field (not just CC'd).
  3. The message contains question/request language: `?`, "could you", "can you", "please", "let me know", "would you", "when can".
  4. The sender is not a no-reply address (skip `noreply@`, `notifications@`, `donotreply@`, automated senders).
- For each newly flagged thread, emit a `pending` cache entry that **includes a `card`** (the rendered line) so it re-renders next run without a re-fetch. Always set `processed_at` to UTC Zulu ISO (e.g. `2026-06-24T06:40:41.664Z`) — no offset suffixes.

## Return contract (JSON only)

```json
{ "section": "gmail", "ok": true,
  "flagged": [ { "emoji": "🔴", "who": "<sender>", "why": "<subject / what they ask>", "action": "reply", "link": "<thread URL>", "card": "🔴 <sender> — <subject> → reply · <thread URL>" } ],
  "cache_delta": { "gmail_threads": {
    "<new_thread_id>": { "status": "pending", "card": "🔴 …", "processed_at": "2026-06-24T06:40:41.664Z" },
    "<resolved_thread_id>": null } },
  "notes": [] }
```

On failure set `"ok": false` and put the reason in `notes`.
