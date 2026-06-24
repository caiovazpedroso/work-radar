---
name: work-radar
description: >
  Personal work-surface sweep across Jira, Slack, Bitbucket, Fathom, Google Calendar,
  and Gmail — surfaces what needs your attention and what's coming up. Two profiles:
  **radar** (full sweep) and **light** (quick urgent check + cache digest). Run whenever
  the user signals a check-in: "work radar", "am I clear to log off?", "what's on my plate",
  "quick check", "anything urgent?", "week ahead", etc.
compatibility: >
  Claude Code only. Requires Node 16+ and MCP integrations for Atlassian, Slack, Gmail,
  Google Calendar, Bitbucket, and Fathom. Personalized for Jones Engineering (JON project,
  mirudman workspace).
---

# Work Radar

Node scripts own dates, cache, and rendering. **You** run MCP passes inline in this conversation,
build a `returns[]` array, commit, then print `render-report.mjs` stdout verbatim.

## Global rules

1. **No date/JSON math** — use `prep.mjs`, `commit.mjs`, `render-report.mjs` only.
2. **Distill, don't dump** — MCP payloads stay out of chat; brief status lines OK ("Jira done — 4 flagged").
3. **Append to `returns[]`** — one JSON object per section; write temp file only at Step 6.
4. **`flagged[]` = action only** (`🔴`/`🟡`). Resolved items → `notes[]` or omit. Never `✅` in flagged.
5. **Cache timestamps** — UTC Zulu ISO (`2026-06-24T06:40:41.664Z`), never offset suffixes.
6. **Never hand-format the report** — only `render-report.mjs` stdout is user-facing.
7. **Current-state queries always run**; time-windowed queries use `since` from run-plan only.

**Locale:** `~/.claude/cache/work-radar-user.json` — `work_week` (`mon_fri`|`sun_thu`), `holiday_region` (`latam`|`il`). PTO from user's Google Calendar only.

## Profiles

| Phrasing | Profile |
|----------|---------|
| "quick check", "anything urgent?", "what needs me right now?" | `light` |
| Everything else; first run (no cache) | `radar` |

| Profile | Live | Week Ahead | Worklog | Fast-exit |
|---------|------|------------|---------|-----------|
| `radar` | Jira, Slack, Bitbucket, Fathom, Gmail + calendar | full pass (cached on re-run) | yes (log-off anchor after 15:00 local) | radar re-run < 30 min |
| `light` | Jira, Slack, Bitbucket | cache digest | no | n/a |

Scan window = cache gap (14-day cap on first run). Report anchor is **last line**; scroll up for detail.

---

## Step 0 — Sprint (before prep)

`mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql`:
`project = JON AND sprint in openSprints()`, `maxResults: 1`, `fields: ["customfield_10010"]`.
Extract sprint `name`, `startDate`, `endDate` → trim to `YYYY-MM-DD`. On failure, omit sprint args.

---

## Step 1 — prep.mjs

```bash
node "{skill_dir}/scripts/prep.mjs" --profile <radar|light> \
  --sprint-start <YYYY-MM-DD> --sprint-end <YYYY-MM-DD> --sprint-name "<name>"
```

Windows: `$env:USERPROFILE/.claude/skills/work-radar/scripts/prep.mjs`. Default profile `radar`. Legacy `--mode` accepted.

**Run-plan keys you need:**

| Key | Use |
|-----|-----|
| `profile`, `today`, `local_hour`, `work_week`, `holiday_region` | context |
| `query_sections` | which sections to run live |
| `run_calendar_scope`, `run_week_ahead`, `worklog`, `fast_exit` | routing |
| `since.jira.jql_relative` | JQL `updatedDate >= "-885m"` |
| `since.gmail.epoch` | Gmail `after:<epoch>` |
| `since.slack.unix` | Slack search **`after` param** (not `after:` modifier) |
| `since.calendar.start_time` | Calendar `startTime` |
| `slices` | open cache items per source |
| `sprint`, `sprint_work_days_remaining`, `sprint_work_days_total` | week ahead — **never recompute** |
| `week`, `next_work_week_start`, `regional_holidays` | week ahead + PTO context |
| `run_start_iso`, `cache_path`, `skill_dir`, `user_config_path` | commit + paths |
| `first_run`, `user_config_using_defaults`, `cache_exists` | Step 1.5 |

On non-zero exit, stop and point to README. Announce: *"Running {profile} — scanning since {since.jira.iso}…"*

---

## Step 1.5 — First-run setup

When `first_run` or `user_config_using_defaults`: confirm `skill_dir`, `user_config_path`, `cache_path`.
If no user config, ask LATAM (1) vs Tel Aviv (2), write `work-radar-user.json`, re-run prep.
If user accepts defaults, continue. Wide first-run window is expected.

---

## Step 2 — Routing

```
fast_exit → Step 3 → Step 5 (query_sections only) → 6 → 7 → 8
full      → Step 3 → Step 4 → Step 5 (+ week ahead) → 6 → 7 → 8
```

Fast-exit: radar < 30 min; Jira/Gmail/Fathom replay from cache at render; Slack/Bitbucket live.

---

## Step 3 — Identity (parallel)

1. `atlassianUserInfo` → `accountId`, `email`
2. `slack_search_users` (email) → `user_id`
3. `bb_get` `/2.0/user` → `uuid` (workspace **`mirudman`**)
4. `Fathom get_identity` → confirm match

Gmail/Calendar are OAuth-bound.

---

## Step 4 — Calendar scope

**Skip** when `run_calendar_scope` is false.

Tool: `mcp__claude_ai_Google_Calendar__list_events` — params **`startTime`/`endTime`** only (not `timeMin`/`timeMax`).

**Two parallel fetches:**
1. Backward: `startTime=since.calendar.start_time`, `endTime=now` — find Fathom meetings.
2. Forward: `startTime=now`, `endTime=sprint.end` EOD (or +30d) — PTO discovery.

**Fathom IDs (backward scan):** real meetings (not PTO) with video/Fathom link or attendees. Extract `recording_id` from URL or use `cal:{eventId}`. Skip if already in `calendar_events` cache with `processed_at`.

**Personal PTO (`pto_dates`):** all-day events with PTO/OOO/vacation/time-off language (incl. ferias, férias, חופש). Multi-day all-day blocks. NOT regional holidays, 1:1s, or short focus blocks.

**Holidays (`holiday_dates`):** merge `regional_holidays` + company all-day events from forward scan.

Return:
```json
{ "section": "calendar", "ok": true,
  "recording_ids": [{ "recording_id", "title", "date", "event_id" }],
  "pto_dates": ["YYYY-MM-DD"],
  "holiday_dates": [{ "date", "name", "source": "regional"|"calendar" }],
  "cache_delta": { "calendar_events": { "<event_id>": { "title", "date", "recording_id", "processed_at" } } },
  "notes": [] }
```

Keep `recording_ids`, `pto_dates`, `holiday_dates` for Steps 5–6. Merge PTO/holidays with `regional_holidays`.

---

## Step 5 — Section sweep

For each section in `query_sections`, run the spec below. Inputs: identity from Step 3, `since` forms from run-plan, `slices`, `worklog` flag (Jira).

**Fathom:** `recording_ids` from Step 4 + `slices.fathom_unresolved`.
**Week ahead:** when `run_week_ahead`, run **Week Ahead** section below; set `week_ahead_render`.

Independent sections may run MCP in parallel; always one JSON object per section in `returns`.

---

## Step 6 — commit.mjs

```bash
node "{skill_dir}/scripts/commit.mjs" --profile <profile> --run-start <run_start_iso> --returns <file>
```

Before render. Before Fathom↔Jira prompts. Failed sections (`ok:false`) don't advance coverage.

---

## Step 7 — render-report.mjs

```bash
node "{skill_dir}/scripts/render-report.mjs" --runplan <runplan.json> --returns <returns.json>
```

Print stdout **verbatim**. No cache footer in report body.

---

## Step 8 — Fathom↔Jira (optional)

Skip when `fast_exit`. After report, if Fathom return has `potential_jira_matches`, ask yes/no/skip per match.
On yes: `node "{skill_dir}/scripts/patch-fathom-jira.mjs" --recording-id … --fathom-item "…" --jira-key … --fathom-url "…" --cache <cache_path>`

---

## Returns contract (all sections)

```json
{ "section": "<name>", "ok": true,
  "flagged": [{ "emoji": "🔴", "who": "…", "why": "…", "action": "…", "link": "…" }],
  "cache_delta": {},
  "week_ahead_render": null,
  "notes": [] }
```

`ok: false` → `notes` has reason; section shows ⚠️. Include `card` on new pending/open_card entries for free re-render.

---

# Section specs

### Jira

**Tool:** `searchJiraIssuesUsingJql` — **ToolSearch** `select:mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql` first.

**Inputs:** `accountId`, `today`, `since.jira.jql_relative`, `worklog`, `slices.jira_comments`.

**Always run:**
1. `assignee = currentUser() AND duedate <= now() AND status != Done ORDER BY duedate ASC`
2. `assignee = currentUser() AND priority in (High, Blocker) AND status not in (Done, Closed)`
3. Re-emit unanswered `open_card` from slice.

**Since-windowed:**
4. `assignee = currentUser() AND updatedDate >= "{since.jql_relative}"` — flag only if last comment NOT from you AND newer than `last_seen_comment_at`. Update `cache_delta.jira_comments` with `last_seen_comment_at` + `open_card`; clear `open_card: null` when you replied last.
5. Blocking links (`issueLinkType = "blocks"`) — skip gracefully if unsupported.

**Links:** verbatim API URL (`https://getjones.atlassian.net/browse/{key}`) — never truncate.

**Worklog** (if `worklog`): `worklogAuthor = currentUser() AND worklogDate = "{today}"`, fields `summary,worklog`. Sum `worklog.worklogs` where author is you and `started` starts with today (NOT `fields.timespent`). ≥28800s → ✅ Full day; 0 → 🔴 No worklog; between → 🔴 Partial.

```json
{ "section": "jira", "ok": true,
  "worklog": "✅ Full day logged (8h) | 🔴 Partial — … | 🔴 No worklog entries for today",
  "worklog_breakdown": [{ "key": "JON-123", "logged": "2h 0m" }],
  "flagged": [...], "cache_delta": { "jira_comments": { ... } }, "notes": [] }
```

---

### Slack

**Tools:** `slack_search_public_and_private`, `slack_read_channel`, `slack_read_thread`.

**Inputs:** `user_id`, `since.slack.unix`.

**Always (not time-windowed):**
- `to:me is:dm is:unread` → **MUST `slack_read_channel` each DM** (never `read_thread` for DMs). Flag only if no message from you with `ts` > triggering msg. Search alone causes false positives.
- `is:starred` → flag for action.

**Since-windowed** (`after` = `since.unix` param):
- `@{user_id}` mentions → `read_thread`; flag only if you haven't replied after mention.
- `from:me ("I'll" OR "I will" OR "let me" OR "I can send" OR "will check" OR "I'll get back")` → flag open commitments with no follow-through.

Deduplicate overlaps. Include `ts` (unix int) on each flagged item; filter `ts >= since.unix` for windowed items. `cache_delta: {}`.

---

### Gmail

**Tools:** `search_threads`, `get_thread` (MCP only — no REST).

**Inputs:** `since.gmail.epoch`, your email, `slices.gmail_threads`.

**Gap:** `after:<since.epoch> -in:sent -in:draft`. Skip `recently_dismissed_ids`.

**Re-surface:** pending threads → re-flag unless gap search shows you as latest sender → then `cache_delta` clear (`null` or `actioned`).

**New flags** (all true): latest msg from someone else; you're in **To:** (not CC); question language (`?`, could you, please, let me know…); not noreply/automated.

New pending entries need `card` + `processed_at` in `cache_delta.gmail_threads`.

---

### Bitbucket

**Tool:** `bb_get`. **Inputs:** your `uuid`. Workspace **`mirudman`**. No `since` — always live current state.

**Repos (parallel):** `wjreactbackend`, `wjreact`, `node-backend`, `ai-tools`.

Per repo, parallel:
1. **Review queue:** `q=state="OPEN" AND reviewers.uuid="{uuid}"` — skip if your participant role is `approved`.
2. **Your PRs:** `q=state="OPEN" AND author.uuid="{uuid}"` — if `comment_count > 0`, fetch last 10 comments; flag unresolved reviewer comments newer than your last reply. Flag merge conflicts.

`cache_delta: {}`.

---

### Fathom

**Tool:** `get_meeting_summary`. **Inputs:** `recording_ids` (Step 4), `slices.fathom_unresolved`, your name/email.

**New recordings:** fetch summary; extract your action items as `{ text, status: pending|in_progress|done }`; `cache_delta.fathom_meetings` with `processed_at`.

**Jira match (new items):** keyword search `project = JON AND text ~ "…"` (limit 5); add to `potential_jira_matches` if high/medium confidence — don't force.

**Cached unresolved:** re-flag from `unresolved_items` without re-fetch.

---

# Week Ahead

When `run_week_ahead`. Skip pace block if `sprint.note` set.

**Sprint health JQL:** `assignee = currentUser() AND sprint in openSprints() AND status not in (Done, Closed) ORDER BY priority DESC`

Collect: key, summary, status, priority, story points (try `customfield_10016` — if absent, treat as unavailable), `timeoriginalestimate`, `timeestimate`, `duedate`.

**Capacity:** `sprint_work_days_remaining` × 8h (minus PTO/holiday days in window) from run-plan — **do not recompute**. Sum `timeestimate` → ratio vs capacity: ≤0.75 ✅, 0.75–1.0 🟡, >1.0 🔴, missing estimates → ⚠️ Pace unknown.

**Due this week JQL:** `assignee = currentUser() AND duedate >= now() AND duedate <= "{last work day or next_work_week_start}" AND status not in (Done, Closed)`

**Calendar:** `list_events` with `startTime=now`, `endTime` = last date in `week.work_days` (minus PTO/holidays) or `next_work_week_start`. Accepted/tentative only; exclude PTO/holidays; skip past Fathom meetings already cached.

**Today is mandatory:** if `today` is a work day, always render `**Today — {day}**` with meetings from now through EOD — clock times from `start.dateTime` in local TZ (`Title · 1:00 PM`). Never title-only when `dateTime` exists. Never write "nothing scheduled" unless API returned zero events that day. `endTime` must cover the full horizon.

**Horizon:** `week.work_days` minus PTO/holidays. If none left → "Today is your last work day"; shift to `next_work_week_start`.

**Urgency by work days until due:** 0 🔴 bold, 1 🟡 bold, 2 🟡, 3 plain, 4+ subtle (only if High/Blocker, duedate, or owned meeting). PTO due dates: note *you're off that day*.

**Output** → `week_ahead_render` (markdown string):

```
### Week Ahead
#### Sprint Health — {name}, ends {end}
{sprint_work_days_remaining} of {sprint_work_days_total} work days left
{pace signal + open tickets + hours}
**Tickets to finish this sprint** (In Progress first, then priority × remaining estimate)
**Today — {day}** (required on work days)
**Tomorrow — {day}**
**{next work day}**
**Later this week** (omit if ≤1 work day left)
**Next Work Week** (when today is last work day or cross-week items)
```

If nothing ahead: `✅ Nothing on the horizon — clear week ahead.`

```json
{ "section": "week_ahead", "ok": true, "flagged": [],
  "week_ahead_render": "<full ### Week Ahead block>",
  "cache_delta": {}, "notes": [] }
```

---

## Failures

Any section `ok: false` or MCP error → ⚠️ for that section only; continue sweep. Commit succeeded sections.
