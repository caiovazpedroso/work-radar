# work-radar

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

1. Copy this folder to `~/.claude/skills/work-radar/`
   - Mac/Linux: `~/.claude/skills/work-radar/`
   - Windows: `%USERPROFILE%\.claude\skills\work-radar\`

2. Configure your locale (one-time):

   ```bash
   mkdir -p ~/.claude/cache
   cp ~/.claude/skills/work-radar/references/user-config.example.json ~/.claude/cache/work-radar-user.json
   ```

   Edit `~/.claude/cache/work-radar-user.json`:

   | Field | Values | Who |
   |-------|--------|-----|
   | `work_week` | `mon_fri` (default) or `sun_thu` | LATAM → Mon–Fri; Tel Aviv → Sun–Thu |
   | `holiday_region` | `latam` or `il` | Office holidays (LATAM uses US federal calendar) |

   **PTO is personal** — detected from your own Google Calendar, not this file.

3. The scripts pick up your timezone automatically from the OS clock.

## Usage

In any Claude Code conversation, trigger with natural phrasing — or invoke `/work-radar` with no
mode (see **Default mode** below).

### Trigger phrases

| You say | Mode |
|---------|------|
| "EOD check", "am I clear to log off?", "wrapping up" | `eod` |
| "morning check", "what's on my plate?", "standup prep" | `morning` |
| "anything urgent?", "what needs me right now?" | `now` |
| "what's my week look like?", "week ahead", "sprint check" | `week` |
| "catch me up", "back from PTO", "what did I miss" | `catchup` |

### Modes

Each mode tunes the scan window, which sources are checked, and how the report is framed.
See [SKILL.md](SKILL.md) for the full agent workflow.

| Mode | Window cap | Sections | Week Ahead | Worklog | Framing |
|------|------------|----------|-----------|---------|---------|
| `eod` | last 3d | all | yes (heads-up) | yes (did I log ~8h?) | "clear to log off?" |
| `morning` | last 3d | all, framed "needs you today" | today + tomorrow only | today's target | "here's your day" |
| `now` | last 1d | Slack DMs/mentions, Bitbucket review queue, urgent Jira (light) | none | no | "what needs you right now" |
| `week` | this week → sprint end | Jira due/urgent only | yes (primary, full detail) | no | "plan the week" |
| `catchup` | last 14d | all, wider window | yes | no | "what happened while you were out" |

### Default mode

When you do not name a mode explicitly:

1. **First run** (no `~/.claude/cache/work-radar-cache.json` yet) → always `catchup` — a full
   14-day sweep across every source, regardless of time of day.
2. **After that** → time of day: morning hours → `morning`, late afternoon/evening → `eod`,
   otherwise → `now`.

### Fast-exit

Re-running the **same mode** within 30 minutes replays Jira, Gmail, and Fathom from the local
cache and only live-queries Slack and Bitbucket. Use `now` mode to force a lighter full refresh.

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
