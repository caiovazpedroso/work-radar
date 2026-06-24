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

In any Claude Code conversation, trigger with natural phrasing — or invoke `/work-radar`.

### Trigger phrases

| You say | Profile |
|---------|---------|
| "work radar", "what's on my plate?", "am I clear to log off?", "week ahead" | `radar` |
| "quick check", "anything urgent?", "what needs me right now?" | `light` |

### Profiles

| Profile | What it does |
|---------|----------------|
| `radar` (default) | Full live sweep: Jira, Slack, Bitbucket, Gmail, Fathom, calendar scope, Week Ahead. Worklog checked; anchor can say "good to log off" after 15:00 local. |
| `light` | Live Jira/Slack/Bitbucket only; Gmail, Fathom, and Week Ahead read from cache (urgent digest). |

**Scan window:** driven by cache — frequent runs only fetch since your last check (up to 14-day cap on first run or long gap). You don't pick a window.

**Report:** `render-report.mjs` prints markdown with status emoji (🔴 🟡 ✅ ⚠️). The **last line** is the actionable anchor; scroll up for inbox detail and Week Ahead. Cache commit status is stderr only (not repeated in the report).

See [SKILL.md](SKILL.md) for the full workflow — one file, one agent, inline MCP passes; scripts handle prep/commit/render.

### Default profile

When you do not name a profile:

1. **First run** (no `~/.claude/cache/work-radar-cache.json`) → `radar`
2. **Otherwise** → `radar`, unless phrasing matches light triggers above

### Fast-exit

Re-running **`radar`** within 30 minutes replays Jira, Gmail, and Fathom from cache and only live-queries Slack and Bitbucket. Use a full `radar` run to refresh everything.

### Scripts

```bash
node scripts/prep.mjs --profile radar
node scripts/commit.mjs --profile radar --run-start <iso> --returns returns.json
node scripts/render-report.mjs --runplan runplan.json --returns returns.json
```

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
