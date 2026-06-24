# Week Ahead — Sprint Health + Proximity Rendering

This file holds the forward-looking sprint and week logic. Load it only in modes that render Week Ahead (`eod`, `week`, `catchup`; `morning` uses a trimmed today+tomorrow view).

Inputs you need before using this file (produced by the engine in SKILL.md): `sprint_work_days_remaining` and `sprint_work_days_total` from `run_plan`, PTO dates (personal, from calendar subagent) and holiday dates (regional + calendar), `work_week`, `next_work_week_start`, the resolved sprint window, and the user's accountId. Calendar/Jira fetching for this section runs in the Week-Ahead subagent — see "Subagent brief" at the bottom.

---

## Sprint Health

The active sprint window comes from `run_plan.sprint` (`start`, `end`, `name`) — resolved from Jira in Step 0 and emitted by prep.mjs. **Do not compute sprint dates here.**

If `run_plan.sprint.note` is set (sprint data unavailable), skip the pace/capacity block and note it.

Build the sprint picture:

- JQL: `assignee = currentUser() AND sprint in openSprints() AND status not in (Done, Closed) ORDER BY priority DESC`
- For each ticket collect: key, summary, status, priority, story points, `timeoriginalestimate` and `timeestimate` (remaining), and `duedate` if set.
  - **Story points field guard:** the story points custom field is commonly `customfield_10016`, but DO NOT assume it. Request it and, if the field is absent or empty on the returned issues, treat story points as unavailable rather than reading a wrong field. The pace signal already has a `⚠️ Pace unknown` fallback for missing estimates — use it.
- Use `sprint_work_days_remaining` from `run_plan.sprint_work_days_remaining` — **do not recompute it**. prep.mjs counts work days (per user's `work_week`: Mon–Fri or Sun–Thu) from today through sprint end. Subtract any PTO/holiday dates that fall in that window from capacity (adjust down by 1 per day off).
- Use `sprint_work_days_total` from `run_plan.sprint_work_days_total` — **do not recompute it**. prep.mjs counts work days across the full sprint window using the same pattern.
- Compute `sprint_capacity_hours` = `sprint_work_days_remaining` × 8 (one full day = 8 h, adjusting down for any PTO/holiday days).
- Sum `timeestimate` (in seconds) across open tickets → `total_remaining_seconds`. If estimates are missing for some tickets, note the gap.
- Derive pace signal:
  - `total_remaining_seconds / sprint_capacity_hours / 3600` → a ratio.
  - ≤ 0.75 → ✅ On track — capacity to spare
  - 0.75–1.0 → 🟡 Tight but doable
  - > 1.0 → 🔴 Over capacity — {X}h of work, {Y}h of capacity left
  - If estimates are missing for most tickets, flag: `⚠️ Pace unknown — most tickets have no time estimate`

For the week-ahead boundary: use `run_plan.week.work_days` (this week's work days per the user's work-week pattern). If none remain in the current week (e.g. last work day is today), query through `run_plan.next_work_week_start`. Tickets beyond this week but before sprint end are noted in the sprint section, not the day-by-day view.

For each ticket, `work_days_until_sprint_end` = `sprint_work_days_remaining` count (same for all tickets — how many work days are left total in the sprint).

Also still run: `assignee = currentUser() AND duedate >= now() AND duedate <= "{last work day this week or next_work_week_start}" AND status not in (Done, Closed) ORDER BY duedate ASC` for tickets with explicit due dates this week.

**Calendar — upcoming events:**
- Fetch Google Calendar events with `mcp__claude_ai_Google_Calendar__list_events` using **`startTime` = now** and **`endTime` = the last date in effective work days this week (`run_plan.week.work_days` minus PTO/holidays), or `run_plan.next_work_week_start` if none remain**. (The tool params are `startTime`/`endTime` — NOT `timeMin`/`timeMax`, and there is no `singleEvents` param.)
- Include only events where RSVP status is `accepted` or `tentative` (not declined).
- Exclude all-day events already identified as PTO/holiday in scoping.
- Skip meetings whose Fathom `recording_id` is already in cache (they're past).
- For each upcoming event note: title, day, time, whether it's a 1:1 or group meeting.

---

## Proximity Rendering Rules

**First: determine the effective work horizon.**

Use `run_plan.week.work_days` (this week's dates) minus any PTO/holiday dates to get the effective work days remaining this week.

- If dates remain after removing PTO/holidays → horizon is the last date in that list ("this week ends {day}").
- If none remain → today is the last work day this week. State this clearly: *"Today is your last work day this week."* The horizon shifts to `run_plan.next_work_week_start`, and items group under "Next Work Week" instead of day labels.

**Urgency tiers** (based on `work_days_until`, not raw calendar days):

| `work_days_until` | Display weight | Always show? |
|-------------------|---------------|--------------|
| 0 (today) | 🔴 bold | Yes |
| 1 (next work day) | 🟡 bold | Yes |
| 2 | 🟡 normal | Yes |
| 3 | plain bullet | Yes |
| 4+ | subtle indent, no emoji | Only if High/Blocker, explicit `duedate`, or meeting you own |

**Work-week scaling** — based on the count of effective work days remaining this week:

- **0 remaining (today is last work day)**: Don't show "later this week" — there is no later this week. Only show "Next Work Week — from {next_work_week_start day name}" for anything due on or after that date. Keep brief; it's a heads-up.
- **1 remaining**: Tomorrow is the last day. Show it prominently (🟡). Collapse anything beyond into "Next Work Week."
- **2 remaining**: Show both days normally. No "later this week" collapse needed.
- **3+ remaining**: Apply the full urgency tier table. Collapse the far end (4+ work days) if nothing urgent.

**Never show a PTO or holiday day as a work day.** If an item is due on a PTO/holiday day, note it: `· ISSUE-123 due {date} *(you're off that day — may need to handle before then)*`

**Calendar events** always use day-of-week labels ("Tomorrow — Wednesday", "Next Sunday" for Sun–Thu weeks, etc.), never raw dates alone.

**Week Ahead output format:**
```
### Week Ahead
{If today is the last work day: "📅 Today is your last work day this week (PTO: {dates}, Holiday: {dates})."}

#### Sprint Health — {Sprint name}, ends {endDate}
{sprint_work_days_remaining} of {sprint_work_days_total} work days left in sprint
{✅ On track | 🟡 Tight but doable | 🔴 Over capacity | ⚠️ Pace unknown}
  · {total open tickets} open · {Xh estimated remaining} · {Yh capacity left}
  {If over capacity: "🔴 {Xh} of work vs {Yh} available — consider moving {N} ticket(s) to next sprint"}
  {If estimates missing: "⚠️ {N} tickets have no estimate — pace may be worse than shown"}

**Tickets to finish this sprint** *(ordered: finish-first = highest priority + least remaining work)*
  · ISSUE-123 — {title} [{status}] · ~{Xh remaining} · [link]
  · ISSUE-456 — {title} [{status}] · ~{Xh remaining} · [link]
  ...
  {If a ticket is due on a PTO/holiday day: append "*(due {date} — you're off, finish before then)*"}

---

**Tomorrow — {day name}**  *(or "Next Work Day — {day name}" if today is last)*
🟡 ISSUE-123 due — {ticket title} · [link]
🟡 {Meeting title} at {time}

**{Next work day after that}**
· ISSUE-456 due — {ticket title} · [link]
· {Meeting title} at {time}

**Later this week** *(omit if effective work days remaining this week ≤ 1)*
∙ {N} sprint tickets in flight, sprint ends {date}
∙ {N} meetings — {day}: {title}, {day}: {title}

**Next Work Week** *(only shown if today is last work day, or for cross-week items)*
∙ {Items due next week}
```

If there's nothing due or scheduled beyond today: `✅ Nothing on the horizon — clear week ahead.`

**Sprint ordering rule:** When listing "Tickets to finish this sprint," order them to help finish just in time — not by priority alone. Suggested order: tickets already In Progress first, then by a combined score of (priority weight × remaining estimate / sprint days left). The goal is to finish the highest-value work while leaving enough time for everything else. If the sprint is over capacity, suggest the lowest-priority / highest-estimate ticket(s) as candidates to defer — don't make that call unilaterally, just flag them.

---

## Subagent brief (Week Ahead)

You are the Week-Ahead section of a work-surface sweep. Run the Sprint Health JQL + due-date JQL above via `mcp__plugin_atlassian_atlassian__searchJiraIssuesUsingJql`, and the upcoming-events fetch via `mcp__claude_ai_Google_Calendar__list_events`. Apply all the computation and rendering rules in this file using the inputs handed to you (sprint window, `sprint_work_days_remaining`, `sprint_work_days_total`, `work_week`, `next_work_week_start`, PTO/holiday dates, accountId). Work-day counts come from `run_plan` — do not recompute them.

Return ONLY this structured JSON — your final message IS the data, not prose. Put the fully
rendered "### Week Ahead" block (per the output format above) into **`week_ahead_render`** so the
fast-exit path can replay it next time without re-querying:

```json
{ "section": "week_ahead", "ok": true,
  "flagged": [],
  "week_ahead_render": "<the fully rendered '### Week Ahead' block, or empty string>",
  "cache_delta": {},
  "notes": [] }
```

On failure set `"ok": false` and put the reason in `notes`. (`commit.mjs` reads `week_ahead_render`
and stores it as a top-level cache key with a timestamp.)
