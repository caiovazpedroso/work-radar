# work-check

A Claude Code skill that sweeps Jira, Slack, Gmail, Google Calendar, Bitbucket, and Fathom and surfaces what needs your attention. Built for Jones Engineering.

## Prerequisites

No `npm install` needed — the scripts use only Node.js built-ins. You need Node 16+ and the following MCP integrations active in Claude Code:

| Integration | Tool prefix |
|-------------|-------------|
| Atlassian Rovo | `mcp__plugin_atlassian_atlassian__*` |
| Slack | `mcp__claude_ai_Slack__*` |
| Gmail | `mcp__claude_ai_Gmail__*` |
| Google Calendar | `mcp__claude_ai_Google_Calendar__*` |
| Bitbucket | `mcp__plugin_team-mcps_bitbucket__*` |
| Fathom | `mcp__claude_ai_Fathom__*` |

## Install

1. Copy this folder to `~/.claude/skills/work-check/`
   - Mac/Linux: `~/.claude/skills/work-check/`
   - Windows: `%USERPROFILE%\.claude\skills\work-check\`

2. Configure your locale (one-time):

   ```bash
   mkdir -p ~/.claude/cache
   cp ~/.claude/skills/work-check/references/user-config.example.json ~/.claude/cache/work-check-user.json
   ```

   Edit `~/.claude/cache/work-check-user.json`:

   | Field | Values | Who |
   |-------|--------|-----|
   | `work_week` | `mon_fri` (default) or `sun_thu` | LATAM → Mon–Fri; Tel Aviv → Sun–Thu |
   | `holiday_region` | `latam` or `il` | Office holidays (LATAM uses US federal calendar) |

   **PTO is personal** — detected from your own Google Calendar, not this file.

3. The scripts pick up your timezone automatically from the OS clock.

## Usage

In any Claude Code conversation, trigger with natural phrasing:

| You say | Mode |
|---------|------|
| "EOD check", "am I clear to log off?" | `eod` — all sources, did I log hours? |
| "morning check", "what's on my plate?" | `morning` — all sources, what needs me today? |
| "anything urgent?" | `now` — Slack, Bitbucket, Jira (light) |
| "what's my week look like?" | `week` — Jira + full Week Ahead |
| "catch me up", "back from PTO" | `catchup` — all sources, 14-day window |

Or invoke explicitly: `/work-check` (defaults to mode based on time of day).

## Locale examples

**LATAM engineer** (Mon–Fri, US federal holidays):
```json
{ "work_week": "mon_fri", "holiday_region": "latam" }
```

**Tel Aviv engineer** (Sun–Thu, Israel public holidays):
```json
{ "work_week": "sun_thu", "holiday_region": "il" }
```

Holiday lists live in `references/holidays/` and are updated annually.
