---
name: work-check
description: >
  Personal work-surface sweep across Jira, Slack, Bitbucket, Fathom, Google Calendar,
  and Gmail — surfaces what needs your attention and what's coming up, in whichever
  mode fits the moment. Run it whenever the user signals a check-in on their work,
  even without naming a tool. Triggers include: end-of-day / log-off ("EOD check",
  "am I clear to log off?", "wrapping up", "done for today", "heading out"); morning /
  start-of-day ("what's on my plate", "morning check", "start of day", "standup prep");
  mid-day ("what needs me right now?", "anything urgent?", "quick check"); week
  planning ("what's my week look like?", "week ahead", "sprint check"); and catch-up
  ("catch me up", "what did I miss", "back from PTO/vacation"). When in doubt, run it.
---

# Work Check

A structured sweep of every work surface. The engine is always the same — a Node script
resolves dates + cache + scan windows, per-section Haiku subagents fan out, a Node script
commits the results, and you synthesize a checklist. A **mode** tunes the window, which
sections run, the framing, and whether the forward-looking Week Ahead is included.

**The design that keeps this fast, cheap, and reliable on any model (incl. Sonnet):**

1. **You never do date or JSON math.** Two Node scripts own all of it
   (`scripts/prep.mjs`, `scripts/commit.mjs`). You call them and read their JSON. A wrong
   day-of-week or window would silently break everything — so it is never computed by hand.
2. **Raw tool output never enters this conversation.** Each section runs in a cheap (Haiku)
   subagent that returns only a small **structured JSON** object (flagged items + cache
   delta). You synthesize from those, never from raw Jira/Bitbucket/Gmail JSON.
3. **Already-covered time is never re-fetched.** `prep.mjs` computes a per-source `since`
   cutoff from the cache's coverage high-water marks, so each subagent scans only the *new*
   slice. Still-open items re-render from cached "cards" for free.

---

## Modes

Pick the mode from the user's phrasing. If the user named one explicitly ("work-check week"),
use it. If ambiguous, infer from local time of day (morning hours → `morning`, late
afternoon/evening → `eod`, otherwise → `now`). **Always state which mode you ran** in the
first line of output. (You do not need to compute the window — `prep.mjs` does, using the mode
below as a fallback **cap**; the real window is the coverage high-water mark.)

| Mode | Window cap | Sections | Week Ahead | Worklog | Framing |
|------|------------|----------|-----------|---------|---------|
| `eod` | last 3d | all | yes (heads-up) | yes (did I log ~8h?) | "clear to log off?" |
| `morning` | last 3d | all, framed "needs you today" | today + tomorrow only | today's target | "here's your day" |
| `now` | last 1d | Slack DMs/mentions, Bitbucket review queue, urgent Jira (light) | none | no | "what needs you right now" |
| `week` | this week → sprint end | Jira due/urgent only | yes (primary, full detail) | no | "plan the week" |
| `catchup` | last 14d | all, wider window | yes | no | "what happened while you were out" |

---

## Step 0 — Resolve active sprint from Jira (inline, before prep.mjs)

Call `mcp__plugin_atlassian_atlassian__fetch` twice (these are cheap — do NOT delegate to a subagent):

1. `GET /rest/agile/1.0/board?projectKeyOrId=JON` → extract `values[0].id` (the board ID)
2. `GET /rest/agile/1.0/board/{boardId}/sprint?state=active` → extract `values[0].name`, `values[0].startDate`, `values[0].endDate`

Dates are `YYYY-MM-DD`. If either call fails or returns no active sprint, proceed without sprint args.

---

## Step 1 — Run prep.mjs (replaces all date/cache/window math)

Run based on your OS, passing the sprint data from Step 0:
- **Mac/Linux:** `node ~/.claude/skills/work-check/scripts/prep.mjs --mode <mode> --sprint-start <YYYY-MM-DD> --sprint-end <YYYY-MM-DD> --sprint-name "<name>"`
- **Windows (PowerShell):** `node "$env:USERPROFILE/.claude/skills/work-check/scripts/prep.mjs" --mode <mode> --sprint-start <YYYY-MM-DD> --sprint-end <YYYY-MM-DD> --sprint-name "<name>"`

Omit the `--sprint-*` args if Step 0 failed.

It prints ONE **run-plan JSON** object. Read it — it gives you, with zero math on your part:

- `today`, `day_of_week`, `week` (Mon–Fri dates), `sprint` (`name`, `start`, `end`).
- `sections`, `worklog`, `week_ahead` (`full` / `trim` / `none`).
- `fast_exit` (+ `fast_exit_reason`, `minutes_since_last_run`).
- `since`: the per-source cutoff already formatted for each API:
  - `since.jira.jql_relative` → e.g. `"-885m"` (use in JQL `updatedDate >= "-885m"` — relative,
    so it is timezone-safe).
  - `since.gmail.epoch` → Unix seconds for Gmail `after:<epoch>` (works at sub-day resolution).
  - `since.slack.unix` → Unix seconds for the Slack search **`after` parameter**.
  - `since.calendar.start_time` → ISO 8601 for `list_events` **`startTime`**.
- `slices`: the lean cache slices to hand subagents (only OPEN items — see Step 5).
- `open_cards`, `week_ahead_render`: used by the fast-exit path.
- `run_start_iso`, `cache_path`: pass these to `commit.mjs` later.

Announce the window: *"Running {mode} check — scanning since {since.*.iso}…"* (or note a
first-time/wider scan if `since` equals the window cap).

---

## Step 2 — Fast-exit check

If `run_plan.fast_exit` is `true` (a re-run within 30 min of the same mode — never in `now`),
do NOT spawn subagents or call any MCP. Just render the cached open items:

```
node "{run_plan.skill_dir}/scripts/render-cache.mjs" --runplan <file with the prep.mjs output>
```

Print its markdown and **stop**. (Save the prep output to a temp file to pass it in.)
Otherwise continue.

---

## Step 3 — Identity (inline, parallel)

Small payloads — resolve inline (do NOT delegate). Run in parallel:

1. `mcp__plugin_atlassian_atlassian__atlassianUserInfo` → `accountId`, `email`
2. `mcp__claude_ai_Slack__slack_search_users` (user's email) → Slack `user_id`
3. `mcp__plugin_team-mcps_bitbucket__bb_get` `/2.0/user` → `uuid` (workspace is **`mirudman`**)
4. `mcp__claude_ai_Fathom__get_identity` → confirm name/email match

Google Calendar and Gmail are OAuth-bound — no separate identity step.

---

## Step 4 — Scope subagent (calendar pass)

Spawn ONE Haiku subagent (`Agent`, `model: haiku`) to run the calendar pass and return only a
distilled scope — keeps raw calendar JSON out of this conversation. Skip in `now` mode.

Tell it to use `mcp__claude_ai_Google_Calendar__list_events` with **`startTime` =
`since.calendar.start_time`** (NOT `timeMin`) and `endTime` = now, plus a forward fetch to
sprint end for PTO/holiday detection. Brief it per the original scope rules (match Fathom
recordings for new events; detect PTO/holidays). It returns: `recording_ids`
(new, with titles/dates), PTO dates, holiday dates, and a `calendar_events` cache delta, in the
**structured JSON** contract (section `"calendar"`).

Note: `work_days_remaining` (sprint-scoped) is now in `run_plan.sprint_work_days_remaining` —
computed by prep.mjs, never by a subagent.

---

## Step 5 — Section fan-out (Haiku subagents, parallel)

For each section in `run_plan.sections`, spawn a Haiku subagent (`Agent`, `model: haiku`) in a
**single message** so they run concurrently. Give each:

- The path to its brief:
  `{run_plan.skill_dir}/references/sections/{section}.md` (tell it to read and execute that brief).
- Its `since` value **in the right form** from `run_plan.since` (jql_relative for Jira, epoch for
  Gmail, unix for Slack), identity values, `today`, the `worklog` flag (Jira), and its **lean
  cache slice** from `run_plan.slices` (e.g. `slices.gmail`, `slices.jira_comments`).
- For Fathom: the new `recording_id`s from Step 4 plus `slices.fathom_unresolved`.

Sections narrow only their **time-windowed** queries to `since`; each keeps its cheap
**current-state** query at full breadth (the briefs spell out which is which) so still-open items
are never dropped.

For modes with Week Ahead (`week_ahead` ≠ `none`), also spawn the **Week-Ahead** subagent against
`{run_plan.skill_dir}/references/week-ahead.md`, passing `sprint`, `run_plan.sprint_work_days_remaining`,
PTO/holiday dates, and accountId. It returns its rendered block in `week_ahead_render` (so the
fast-exit can replay it).

### Structured return contract (every subagent returns ONLY this JSON)

```json
{ "section": "gmail", "ok": true,
  "flagged": [ { "emoji": "🔴", "who": "…", "why": "…", "action": "…", "link": "…" } ],
  "cache_delta": { "gmail_threads": { "<id>": { "status": "pending", "card": "🔴 … · <link>", "processed_at": "2026-06-24T06:40:41.664Z" } } },
  "week_ahead_render": null,
  "notes": [] }
```

**Timestamp rule:** ALL timestamps in `cache_delta` (e.g. `processed_at`, `last_seen_comment_at`) must use UTC Zulu ISO format: `2026-06-24T06:40:41.664Z`. Never emit offset suffixes like `-03:00`.

- `ok:false` (or a dead/empty subagent) → that section shows `⚠️ Could not check`, and
  `commit.mjs` will NOT advance that source's coverage (so the next run re-scans the gap).
- The `card` string on a flagged item is what lets it re-render for free next run — subagents
  must include it when they set a `pending`/`open_card` entry.

---

## Step 6 — Synthesize and output (you render this — it is NOT scripted)

Render the collected `flagged[]` arrays into the template below. Show all sections the mode
includes, even when green. Lead with the mode and date (from the run-plan). Adapt framing per the
mode table. Rendering stays here (not in a script) because the proximity tiers, framing, and
sprint ordering are judgment calls — and the distilled items are already tiny.

```
## Work Check ({mode}) — {today}, {day_of_week}
{window line, e.g. "Scanning since {since.*.iso}"}

### Jira {✅ or 🔴}
{WORKLOG line + per-issue breakdown — only if worklog ran}
{flagged ticket items, or "✅ No urgent tickets or unanswered comments."}

### Slack {✅ or 🔴}
{flagged items, or "✅ No unread messages, mentions, or open commitments."}

### Bitbucket {✅ or 🔴}
{flagged items, or "✅ No PRs waiting on you."}

### Gmail {✅ or 🔴}
{flagged items, or "✅ No emails waiting for a reply."}

### Meetings / Fathom {✅ or 🔴}
{flagged action items, or "✅ No unresolved action items from recent meetings."}

---
{summary: "✅ All clear — nothing needs you." OR "🔴 {N} items need attention."}

---

### Week Ahead
{rendered by the Week-Ahead subagent per references/week-ahead.md — include for modes with Week Ahead}
```

---

## Step 6b — Fathom match confirmation (interactive, only if matches exist)

After synthesis, check whether the Fathom subagent's return included any `potential_jira_matches` (non-empty array). If so, present each match to the user **one at a time**:

> *"Fathom action item: '[fathom_item]' — does this match [jira_key]: [jira_summary]? (yes / no / skip)"*

For each **confirmed** match (user answers "yes"):
1. In `cache_delta.fathom_meetings[fathom_recording_id].action_items_for_me`, find the matching action item string and mark it as DONE by appending ` - DONE (linked to [jira_key])` if not already done.
2. In `cache_delta.jira_comments[jira_key]`, append the `fathom_url` to a `fathom_links` array (create the key if absent).

For **denied** matches (user answers "no" or "skip"), do nothing — the action item stays unlinked.

Pass the updated `cache_delta` entries in the returns array written to the temp file before calling `commit.mjs` as normal.

---

## Step 7 — Commit the cache (replaces all merge/write math)

Collect every subagent's structured JSON into a single JSON array, write it to a temp file, then:

```
node "{run_plan.skill_dir}/scripts/commit.mjs" --mode <mode> --run-start <run_plan.run_start_iso> --returns <file> --since-slack-unix <run_plan.since.slack.unix>
```

It merges every `cache_delta`, advances `coverage` only for sections with `ok:true` (failed
sections self-heal next run), stamps `last_run[mode]`, preserves unknown keys (e.g. `merged_prs`),
and writes atomically. Single writer = no partial-write or concurrency problems.

---

## Handling failures gracefully

If any section's subagent fails (auth error, timeout, API limit, or empty/`ok:false` return):
- Show that section as `⚠️ Could not check — {brief reason from its notes}`.
- Continue with all other sections; never abort the whole sweep.
- `commit.mjs` still writes succeeded sections and leaves the failed source's coverage untouched.
