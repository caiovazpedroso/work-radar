# Section brief: Jira

You are the **Jira** section of a personal work-surface sweep. Execute the queries below, distill, and return ONLY the structured JSON contract. Your final message **is** that JSON — no prose. Do not dump full issue JSON.

**Tool:** `mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql` (Jira Cloud, getjones site).

**Setup (required first):** This tool is deferred — its schema is not pre-loaded. Before running any query, call `ToolSearch` with `query: "select:mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql"` to load the schema. Only then call the tool directly. Do not skip this step or you will fail to invoke it.

**Inputs handed to you:** `accountId`, `today` (YYYY-MM-DD), `since.jql_relative` (a relative JQL window like `"-885m"`), the `worklog` flag, and the `jira_comments` slice (`{ issue_key: { last_seen_comment_at, open_card } }`).

## Queries

**Full / current-state (always run — these re-surface still-open tickets for free):**

1. `assignee = currentUser() AND duedate <= now() AND status != Done ORDER BY duedate ASC` — due/overdue.
2. `assignee = currentUser() AND priority in (High, Blocker) AND status not in (Done, Closed)` — high-urgency.

**Time-windowed (narrowed to `since`):**

3. `assignee = currentUser() AND updatedDate >= "{since.jql_relative}"` — recently-touched. From these, **only flag** ones where the last comment was NOT from you (accountId) AND its timestamp is newer than `jira_comments[key].last_seen_comment_at`. These are unanswered comments. For each, emit a `cache_delta` updating `last_seen_comment_at` to the latest comment timestamp **in UTC Zulu ISO format** (e.g. `2026-06-24T06:40:41.664Z` — no offset suffix) **and** setting an `open_card` (the rendered line) so it re-surfaces next run. When you (accountId) have since replied (your comment is newest), clear it: set `open_card` to `null`.
4. Tickets you're blocking (`issueLinkType = "blocks"`). If unsupported, skip gracefully (add a note).

Also re-emit any `open_card` already present in the slice that is still unanswered.

## Worklog check (only if `worklog` is true; run in parallel)

- JQL: `worklogAuthor = currentUser() AND worklogDate = "{today}"` with `fields: ["summary", "worklog"]`.
- From `fields.worklog.worklogs`, keep entries where `author.accountId` == yours AND `started` begins with `{today}`. Sum `timeSpentSeconds`. (Do NOT use `fields.timespent` — it's cumulative.)
- ≥ 28800 → ✅ Full day; 0 < total < 28800 → 🔴 Partial — {Xh Ym} logged, {Zh Wm} needed; 0 → 🔴 No worklog today.

## Return contract (JSON only)

```json
{ "section": "jira", "ok": true,
  "worklog": "✅ Full day logged (8h) | 🔴 Partial — Xh logged, Yh remaining | 🔴 No worklog entries for today | SKIPPED",
  "worklog_breakdown": [ { "key": "JON-123", "logged": "2h 0m" } ],
  "flagged": [ { "emoji": "🔴", "who": "JON-123 <title>", "why": "overdue | High | unanswered comment from <name> | blocking JON-456", "action": "<action>", "link": "<issue URL>" } ],
  "cache_delta": { "jira_comments": { "JON-123": { "last_seen_comment_at": "2026-06-24T06:40:41.664Z", "open_card": "🔴 JON-123 …" }, "JON-456": { "open_card": null } } },
  "notes": [] }
```

On failure set `"ok": false` and put the reason in `notes`.
