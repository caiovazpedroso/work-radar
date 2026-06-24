# Section brief: Calendar (scope pass)

You are the **Calendar** section of a personal work-surface sweep. You discover new Fathom
recordings, detect **personal PTO** from the user's Google Calendar, and return a distilled
scope object. Your final message **is** structured JSON — no prose. Do not dump raw calendar JSON.

**Tool:** `mcp__claude_ai_Google_Calendar__list_events`

**Inputs handed to you:**

| Input | Source |
|-------|--------|
| `since.calendar.start_time` | run-plan — ISO 8601 for backward scan `startTime` |
| `sprint.end` | run-plan — forward scan `endTime` for PTO/holiday discovery |
| `today` | run-plan — YYYY-MM-DD |
| `work_week` | run-plan — `mon_fri` or `sun_thu` |
| `holiday_region` | run-plan — `latam` or `il` |
| `regional_holidays` | run-plan — office holidays already loaded (do not re-fetch) |
| `slices` / cache | prior `calendar_events` entries (optional) |

**Regional holidays vs personal PTO:** `regional_holidays` from the run-plan are **office-wide**
(Jones LATAM follows US federal; Tel Aviv follows Israel public — per user config). **PTO is per-user** — detect
only from the user's own calendar events (see rules below). Never treat a colleague's calendar;
only the OAuth-bound primary calendar.

---

## Fetches (two calls)

Use **`startTime` / `endTime`** params — NOT `timeMin` / `timeMax`. There is no `singleEvents` param.

### 1. Backward scan (new meetings since last run)

- `startTime` = `since.calendar.start_time`
- `endTime` = now (ISO 8601)
- Purpose: find meetings that may have Fathom recordings to process in the Fathom section.

### 2. Forward scan (PTO + holidays through sprint end)

- `startTime` = now
- `endTime` = `sprint.end` at end of day, or +30 days if sprint unavailable
- Purpose: detect personal PTO blocks and confirm regional holidays appear on the user's calendar.

Run both in parallel.

---

## Fathom recording match

For each event in the **backward** scan that looks like a real meeting (not PTO/holiday):

- Title suggests a recorded meeting: contains "Fathom", has a video link, or is a normal
  scheduled meeting (has attendees, not all-day).
- Extract or infer a `recording_id` when present in description/location (Fathom URLs often
  contain it). If no ID is available, use a stable surrogate: `cal:{eventId}`.
- Only include events **not already** in cache `calendar_events` with `processed_at` set.
- Return as `recording_ids`: `[{ "recording_id", "title", "date" (YYYY-MM-DD), "event_id" }]`.

The Fathom section uses these IDs to fetch summaries.

---

## Personal PTO detection

Flag a date as **personal PTO** when the user's calendar shows:

1. **All-day event** with PTO/vacation language in the title: `PTO`, `OOO`, `out of office`,
   `vacation`, `holiday`, `time off`, `ferias`, `férias`, `folga`, `חופש` (or similar), OR
2. **Multi-day all-day block** spanning a work day, OR
3. Event the user created/marked as "busy" all-day with no meeting attendees.

**Do NOT** flag as personal PTO:

- Regional holidays from `regional_holidays` (already known — pass through in `holiday_dates`)
- Regular 1:1s or team meetings
- "Focus time" or "Lunch" blocks under 4 hours

Return personal PTO as `pto_dates`: `["YYYY-MM-DD", ...]` (deduplicated).

---

## Holiday dates

Merge into `holiday_dates`:

1. All `regional_holidays[].date` from the run-plan (office calendar for user's region)
2. Any additional all-day company-wide events from the forward scan whose title matches
   `Jones holiday`, `company holiday`, or matches a known regional holiday name

Each entry: `{ "date": "YYYY-MM-DD", "name": "...", "source": "regional" | "calendar" }`

---

## Work-week awareness

Use `work_week` from the run-plan when judging "this week" context in notes only — date math
is already done by `prep.mjs`. If today falls on a non-work day for the user's pattern
(`mon_fri` → Sat/Sun; `sun_thu` → Fri/Sat), add a note: `"today_is_non_work_day": true`.

---

## Cache delta

For each newly processed calendar event from the backward scan:

```json
"calendar_events": {
  "<event_id>": {
    "title": "...",
    "date": "YYYY-MM-DD",
    "recording_id": "...",
    "processed_at": "2026-06-24T06:40:41.664Z"
  }
}
```

Use UTC Zulu ISO for `processed_at` — no offset suffixes.

---

## Return contract (JSON only)

```json
{
  "section": "calendar",
  "ok": true,
  "recording_ids": [
    { "recording_id": "abc123", "title": "Sprint planning", "date": "2026-06-24", "event_id": "evt_1" }
  ],
  "pto_dates": ["2026-07-01", "2026-07-02"],
  "holiday_dates": [
    { "date": "2026-07-04", "name": "Independence Day", "source": "regional" }
  ],
  "cache_delta": {
    "calendar_events": {
      "evt_1": { "title": "Sprint planning", "date": "2026-06-24", "recording_id": "abc123", "processed_at": "2026-06-24T06:40:41.664Z" }
    }
  },
  "notes": []
}
```

On failure set `"ok": false` and put the reason in `notes`. Empty arrays are fine when nothing new.
