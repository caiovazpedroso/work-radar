---
name: work-radar
description: >
  Personal work-surface sweep across Jira, Slack, Bitbucket, Fathom, Google Calendar,
  and Gmail — surfaces what needs your attention and what's coming up, in whichever
  mode fits the moment. Run it whenever the user signals a check-in on their work,
  even without naming a tool. Triggers include: "work radar"; end-of-day / log-off
  ("EOD check", "am I clear to log off?", "wrapping up", "done for today", "heading out");
  morning / start-of-day ("what's on my plate", "morning check", "start of day", "standup prep");
  mid-day ("what needs me right now?", "anything urgent?", "quick check"); week
  planning ("what's my week look like?", "week ahead", "sprint check"); and catch-up
  ("catch me up", "what did I miss", "back from PTO/vacation"). When in doubt, run it.
compatibility: >
  Claude Code only. Requires Node 16+, Haiku subagent support (`Agent`, model haiku),
  and MCP integrations for Atlassian, Slack, Gmail, Google Calendar, Bitbucket, and
  Fathom. Personalized for Jones Engineering (JON project, mirudman workspace).
---

# Work Radar

A structured sweep of every work surface. The engine is always the same — a Node script
resolves dates + cache + scan windows, per-section Haiku subagents fan out, a Node script
commits the results, then you synthesize the checklist as the final user-visible output. A
**mode** tunes the window, which sections run, the framing, and whether the forward-looking
Week Ahead is included.

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

**Locale (Jones offices):** Work-week and regional holidays are per-user via
`~/.claude/cache/work-radar-user.json` — LATAM default Mon–Fri with US federal holidays;
Tel Aviv Sun–Thu with Israel holidays. Personal PTO always comes from the user's own Google Calendar.

---

## Modes

Pick the mode from the user's phrasing, in this order:

1. **User named a mode explicitly** ("work-radar week") → use it (even on first run).
2. **First run** → `catchup`. Before calling `prep.mjs`, check whether
   `~/.claude/cache/work-radar-cache.json` exists (same path as `DEFAULT_CACHE` in
   `scripts/lib/shared.mjs`). If the file is missing, use `catchup` — never default to `now`
   on first run. If `prep.mjs` later sets `first_run: true` in the run-plan, note it in the
   opening line.
3. **Otherwise, ambiguous phrasing** → infer from local time of day (morning hours → `morning`,
   late afternoon/evening → `eod`, otherwise → `now`).

**Always state which mode you ran** in the first line of output. (You do not need to compute
the window — `prep.mjs` does, using the mode below as a fallback **cap**; the real window is
the coverage high-water mark.)

| Mode | Window cap | Sections | Week Ahead | Worklog | Framing |
|------|------------|----------|-----------|---------|---------|
| `eod` | last 3d | all | yes (heads-up) | yes (did I log ~8h?) | "clear to log off?" |
| `morning` | last 3d | all, framed "needs you today" | today + tomorrow only | today's target | "here's your day" |
| `now` | last 1d | Slack DMs/mentions, Bitbucket review queue, urgent Jira (light) | none | no | "what needs you right now" |
| `week` | this week → sprint end | Jira due/urgent only | yes (primary, full detail) | no | "plan the week" |
| `catchup` | last 14d | all, wider window | yes | no | "what happened while you were out" |

---

## Step 0 — Resolve active sprint from Jira (inline, before prep.mjs)

Call `mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql` (do NOT delegate to a subagent):

```
jql: "project = JON AND sprint in openSprints()"
cloudId: "<cloudId>"
maxResults: 1
fields: ["customfield_10010"]
```

Extract `issues[0].fields.customfield_10010[0]` → `name`, `startDate`, `endDate`.
Trim dates to `YYYY-MM-DD`. If the call fails or returns no issues, proceed without sprint args.

> **Why:** The Agile board REST endpoint (`/rest/agile/1.0/board/…`) is not accessible via the available MCP tools (they only accept ARI identifiers). Sprint data is reliably available on any issue via `customfield_10010`.

---

## Step 1 — Run prep.mjs (replaces all date/cache/window math)

Run based on your OS, passing the sprint data from Step 0:
- **Mac/Linux:** `node ~/.claude/skills/work-radar/scripts/prep.mjs --mode <mode> --sprint-start <YYYY-MM-DD> --sprint-end <YYYY-MM-DD> --sprint-name "<name>"`
- **Windows (PowerShell):** `node "$env:USERPROFILE/.claude/skills/work-radar/scripts/prep.mjs" --mode <mode> --sprint-start <YYYY-MM-DD> --sprint-end <YYYY-MM-DD> --sprint-name "<name>"`

Omit the `--sprint-*` args if Step 0 failed.

It prints ONE **run-plan JSON** object. Read it — it gives you, with zero math on your part:

- `today`, `day_of_week`, `week` (`work_days`, `week_start`, `week_end`, `work_week_label`).
- `work_week`, `holiday_region`, `regional_holidays`, `next_work_week_start`.
- `sections`, `worklog`, `week_ahead` (`full` / `trim` / `none`).
- `fast_exit` (+ `fast_exit_reason`, `minutes_since_last_run`, `fast_exit_live_sections`).
- `query_sections`: which section subagents to spawn in Step 5 (all mode sections on a full run; live-only sections on fast-exit).
- `sprint_work_days_remaining`, `sprint_work_days_total`: work-day counts for the user's work-week pattern — never recompute in subagents.
- `since`: the per-source cutoff already formatted for each API:
  - `since.jira.jql_relative` → e.g. `"-885m"` (use in JQL `updatedDate >= "-885m"` — relative,
    so it is timezone-safe).
  - `since.gmail.epoch` → Unix seconds for Gmail `after:<epoch>` (works at sub-day resolution).
  - `since.slack.unix` → Unix seconds for the Slack search **`after` parameter**.
  - `since.calendar.start_time` → ISO 8601 for `list_events` **`startTime`**.
- `slices`: the lean cache slices to hand subagents (only OPEN items — see Step 5).
- `open_cards`, `week_ahead_render`: used by the fast-exit path.
- `run_start_iso`, `cache_path`: pass these to `commit.mjs` later.
- `skill_dir`, `user_config_path`, `cache_exists`, `first_run`: used by Step 1.5 (first-run setup).

If `prep.mjs` exits non-zero or prints no JSON, **stop** — report the error and point to README
install paths (`~/.claude/skills/work-radar/`). A successful run proves Node can reach the scripts.

Announce the window: *"Running {mode} check — scanning since {since.*.iso}…"* (or note a
first-time/wider scan if `first_run` is true or `since` equals the window cap).

---

## Step 1.5 — First-run setup (before Step 2)

Run this when **either** flag is true in the run-plan:

- `user_config_using_defaults` — no `work-radar-user.json` yet
- `first_run` — no cache file yet, or cache has never completed a run

**Do not skip silently.** The user should see a short setup beat before the full sweep continues.

### A. Preflight (always on first-run)

Confirm `prep.mjs` succeeded and report these paths back to the user (proves scripts + cache dir are reachable):

| Check | Source |
|-------|--------|
| Skill scripts | `run_plan.skill_dir` (must contain `scripts/prep.mjs`) |
| User config | `run_plan.user_config_path` |
| Runtime cache | `run_plan.cache_path` (created automatically at Step 6 — no manual file needed) |

If `cache_exists` is false, say: *"No cache yet — first full scan, then `commit.mjs` will create it."*

### B. Locale setup (when `user_config_using_defaults` is true)

**Pause the sweep** and ask:

> *"First-time work-radar setup — which office pattern?*
> *1. **LATAM** — Mon–Fri, US federal holidays*
> *2. **Tel Aviv** — Sun–Thu, Israel public holidays*
> *Reply 1 or 2 (or tell me if both defaults are fine for now)."*

When the user answers:

1. Ensure `~/.claude/cache/` exists (`mkdir -p` on Mac/Linux; `New-Item -ItemType Directory -Force` on Windows).
2. Write `run_plan.user_config_path` with:

   ```json
   { "work_week": "mon_fri", "holiday_region": "latam" }
   ```

   or Tel Aviv:

   ```json
   { "work_week": "sun_thu", "holiday_region": "il" }
   ```

3. **Re-run `prep.mjs`** with the same `--mode` and `--sprint-*` args from Step 1. Use the new run-plan for all following steps.

If the user says defaults are fine, continue without writing the file — but say they can add
`work-radar-user.json` later (see README).

### C. Continue

After setup (or user opt-out), proceed to Step 2. On `first_run`, the scan window is intentionally wide — that is expected.

---

## Step 2 — Fast-exit vs full run

```
fast_exit = true  → render-cache.mjs (save markdown) → Step 3 → Step 5 (query_sections only) → Step 6 (commit) → Step 7 (render) → Step 8
fast_exit = false → skip render-cache → Step 3 → Step 4 → Step 5 (all sections) → Step 6 (commit) → Step 7 (render) → Step 8
```

If `run_plan.fast_exit` is `true` (a re-run within 30 min of the same mode — never in `now`),
run `render-cache.mjs` now and **save** the markdown for Step 7 — then **continue** to Step 3
(do not stop, do not commit here):

```
node "{run_plan.skill_dir}/scripts/render-cache.mjs" --runplan <file with the prep.mjs output>
```

On fast-exit, Jira/Gmail/Fathom replay from cache; Slack and Bitbucket will be live-queried in
Step 5 via `run_plan.query_sections`. If `fast_exit` is false, skip this step.

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
distilled scope — keeps raw calendar JSON out of this conversation. **Skip when `run_plan.fast_exit`
is true** (Fathom discovery and PTO detection already ran on the prior full run; Week Ahead replays
from cache). Also skip in `now` mode.

Point it at `{run_plan.skill_dir}/references/sections/calendar.md` and pass:
`since.calendar`, `sprint`, `today`, `work_week`, `holiday_region`, `regional_holidays`, and
any `slices` from the run-plan.

It returns: `recording_ids` (new, with titles/dates), `pto_dates`, `holiday_dates`, and a
`calendar_events` cache delta, in the structured JSON contract (section `"calendar"`).

Merge `pto_dates` + `holiday_dates` from the calendar return with `run_plan.regional_holidays`
when handing PTO/holiday context to Week Ahead and Fathom subagents.

Note: sprint work-day counts are in `run_plan.sprint_work_days_remaining` — computed by
prep.mjs, never by a subagent.

---

## Step 5 — Section fan-out (Haiku subagents, parallel)

For each section in `run_plan.query_sections`, spawn a Haiku subagent (`Agent`, `model: haiku`) in a
**single message** so they run concurrently. Give each:

- The path to its brief:
  `{run_plan.skill_dir}/references/sections/{section}.md` (tell it to read and execute that brief).
- Its `since` value **in the right form** from `run_plan.since` (jql_relative for Jira, epoch for
  Gmail, unix for Slack), identity values, `today`, the `worklog` flag (Jira), and its **lean
  cache slice** from `run_plan.slices` (e.g. `slices.gmail`, `slices.jira_comments`).
- For Fathom: the new `recording_id`s from Step 4 plus `slices.fathom_unresolved` (structured
  `{ text, status }` items — prep already filtered to non-done).

Sections narrow only their **time-windowed** queries to `since`; each keeps its cheap
**current-state** query at full breadth (the briefs spell out which is which) so still-open items
are never dropped.

For modes with Week Ahead (`week_ahead` ≠ `none`), also spawn the **Week-Ahead** subagent against
`{run_plan.skill_dir}/references/week-ahead.md` — **unless `run_plan.fast_exit` is true** (use
`week_ahead_render` from the run-plan instead). When spawning, pass `sprint`, `run_plan.sprint_work_days_remaining`,
`run_plan.sprint_work_days_total`, `run_plan.week`, `run_plan.work_week`, `run_plan.next_work_week_start`,
merged PTO/holiday dates, and accountId. It returns its rendered block in `week_ahead_render`.

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

## Step 6 — Commit the cache (replaces all merge/write math)

Collect every subagent's structured JSON into a single JSON array, write it to a temp file, then:

```
node "{run_plan.skill_dir}/scripts/commit.mjs" --mode <mode> --run-start <run_plan.run_start_iso> --returns <file>
```

Run this **before** rendering the report (Step 7) so commit output appears in the terminal
immediately above the final checklist. Read the stderr line (`commit.mjs: wrote …; coverage
advanced for […]; last_run[…]=…`) — you will echo a summary of it at the bottom of the report.

Commit **before** asking about Fathom matches — unconfirmed matches stay `pending` in cache.
It merges every `cache_delta`, advances `coverage` only for sections with `ok:true` (failed
sections self-heal next run), stamps `last_run[mode]`, preserves unknown keys (e.g. `merged_prs`),
and writes atomically. Single writer = no partial-write or concurrency problems.

---

## Step 7 — Synthesize and output

**Fast-exit (`run_plan.fast_exit` is true):** Print the saved `render-cache.mjs` markdown block
first, then append live Slack and Bitbucket sections from the Step 5 subagent `flagged[]` arrays
using the same section heading format below. Week Ahead is already in the cache block if present.

**Full run:** Render all collected `flagged[]` arrays into the template below.

Show all sections the mode includes, even when green. Lead with the mode and date (from the
run-plan). Adapt framing per the mode table. This step is the **last** user-visible artifact —
deliver it after Step 6 so the report stays at the bottom of the conversation.

```
## Work Radar ({mode}) — {today}, {day_of_week}
{window line, e.g. "Scanning since {since.*.iso}"}
{optional: work week line, e.g. "Work week: Sun–Thu (Tel Aviv) · Holidays: IL"}

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

---
Cache saved — coverage advanced for [{sections from commit stderr}]; last_run[{mode}]={run_start_iso}
```

**Deliver the full report now** — do not wait for Fathom↔Jira confirmations before showing this.

---

## Step 8 — Fathom↔Jira confirmations (optional, non-blocking)

**Skip when `run_plan.fast_exit` is true** — the Fathom subagent did not run.

After Step 6 (cache committed) and Step 7 (report delivered), check whether the Fathom subagent
return included any `potential_jira_matches` (non-empty array). If so, append a short footer:

> *"{N} Fathom action item(s) may match Jira tickets — reply yes / no / skip on each when ready."*

Then present each match **one at a time** (user can respond now or later in the same conversation):

> *"Fathom action item: '[fathom_item]' — does this match [jira_key]: [jira_summary]? (yes / no / skip)"*

For each **confirmed** match (user answers "yes"), run the patch script — do not hand-edit cache JSON:

```
node "{run_plan.skill_dir}/scripts/patch-fathom-jira.mjs" \
  --recording-id <fathom_recording_id> \
  --fathom-item "<fathom_item>" \
  --jira-key <jira_key> \
  --fathom-url "<fathom_url>" \
  --cache <run_plan.cache_path>
```

It marks the action item `done` (text unchanged) and appends the Fathom URL to `jira_comments[jira_key].fathom_links`. It does not touch coverage or `last_run`.

For **denied** matches ("no" or "skip"), do nothing — the action item stays unlinked.

Never block the Work Radar report on these answers.

---

## Handling failures gracefully

If any section's subagent fails (auth error, timeout, API limit, or empty/`ok:false` return):
- Show that section as `⚠️ Could not check — {brief reason from its notes}`.
- Continue with all other sections; never abort the whole sweep.
- `commit.mjs` still writes succeeded sections and leaves the failed source's coverage untouched.
