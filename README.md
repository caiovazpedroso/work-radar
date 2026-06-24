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

2. That's it. The scripts pick up your timezone automatically from the OS clock.

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
