#!/usr/bin/env node
/**
 * work-check — prep.mjs  (engine front-half, zero model involvement)
 * =================================================================
 * Resolves everything deterministic so the orchestrating model never does
 * date or JSON math. Emits ONE run-plan JSON object on stdout.
 *
 * Usage:
 *   node prep.mjs --mode <eod|morning|now|week|catchup> [--cache <path>] [--now <iso>]
 *
 *   --now is for testing only (pins "current time"); omit in real runs.
 *
 * Requirements: Node 16+ (ESM), no external dependencies.
 *
 * What it does:
 *   1. Resolve dates/day-of-week and this week's work days — per-user work-week
 *      (Mon–Fri for LATAM, Sun–Thu for Tel Aviv) in the system's local timezone.
 *      Regional holidays loaded from references/holidays/{region}.json.
 *      Sprint dates come from --sprint-start/--sprint-end args (resolved from Jira by Step 0).
 *   2. Load the cache, prune stale entries by TTL, and SEED `coverage` from `last_run` the
 *      first time so narrowing works on run #1. Unknown top-level keys
 *      (e.g. merged_prs) are read and passed through untouched.
 *   3. Compute a per-source `since` cutoff = coverage_through - 15min, floored
 *      at now - mode_window, formatted to each API's needs (see SINCE below).
 *   4. Decide the fast-exit (mode != now and last run < 30min ago).
 *   5. Emit lean cache slices (only OPEN items each subagent must re-render).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MODES, SECTION_COVERAGE, TTL_DAYS, OPEN_CARD_SECTIONS,
  DEFAULT_CACHE, parseArgs, parseStamp, utcIso,
} from './lib/shared.mjs';
import { loadCache } from './lib/cache.mjs';
import { loadUserConfig } from './lib/userConfig.mjs';
import { loadRegionalHolidays } from './lib/holidays.mjs';
import {
  getWorkWeekPreset, buildWorkWeek, countWorkDaysInRange,
  nextWorkWeekStart, dayOfWeek, addDays,
} from './lib/workWeek.mjs';

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ── Constants ────────────────────────────────────────────────────────────────
const LOCAL_OFFSET_MIN = -new Date().getTimezoneOffset(); // system timezone, DST-aware
const OVERLAP_MIN = 15;                // safety re-scan before the high-water mark
const FAST_EXIT_MIN = 30;              // re-run within this window → fast-exit (not in `now`)

// ── Small date helpers (all explicit; no mental math anywhere) ────────────────

/** Format a Date as the YYYY-MM-DD calendar date in the system's local timezone. */
function localDateString(d) {
  const local = new Date(d.getTime() + LOCAL_OFFSET_MIN * 60000);
  return local.toISOString().slice(0, 10);
}

function fail(msg) {
  console.error(`prep.mjs: ${msg}`);
  process.exit(1);
}

function pruneByTtl(cache, nowMs) {
  for (const [key, ttl] of Object.entries(TTL_DAYS)) {
    const slice = cache[key];
    if (!slice) continue;
    const cutoff = nowMs - ttl * 86400000;
    const stampField = key === 'jira_comments' ? 'last_seen_comment_at' : 'processed_at';
    for (const id of Object.keys(slice)) {
      const stamp = parseStamp(slice[id]?.[stampField]);
      // Null stamp → keep (age unknown); fathom_meetings is never pruned.
      if (stamp && stamp.getTime() < cutoff) delete slice[id];
    }
  }
}

/** Backfill any MISSING coverage key from the most recent last_run of a mode
 *  that actually scanned that section.  Seeding from an unrelated mode's run
 *  would set a false high-water mark and silently skip items in the gap on the
 *  next full run (e.g. a `week` run seeding gmail_through even though Gmail
 *  was never queried). */
function seedCoverage(cache) {
  if (!cache.coverage) cache.coverage = {};
  for (const [section, covKey] of Object.entries(SECTION_COVERAGE)) {
    if (cache.coverage[covKey]) continue; // already set — never overwrite
    const relevantRuns = Object.entries(cache.last_run || {})
      .filter(([m]) => MODES[m]?.sections?.includes(section))
      .map(([, ts]) => parseStamp(ts))
      .filter(Boolean)
      .map((d) => d.getTime());
    if (relevantRuns.length) {
      cache.coverage[covKey] = utcIso(new Date(Math.max(...relevantRuns)));
    }
  }
}

// ── since computation ──────────────────────────────────────────────────────────
/** Returns the since INSTANT (Date) for a coverage key, floored at now-window. */
function sinceInstant(cache, coverageKey, nowMs, windowDays) {
  const cov = parseStamp(cache.coverage?.[coverageKey]);
  const floor = nowMs - windowDays * 86400000;
  const fromCov = cov ? cov.getTime() - OVERLAP_MIN * 60000 : -Infinity;
  return new Date(Math.max(fromCov, floor));
}

// ── Lean slices (only OPEN items the subagents must re-render) ─────────────────
function isFathomItemOpen(item) {
  // item is { text: string, status: 'pending' | 'in_progress' | 'done' }
  return item.status !== 'done';
}

function buildSlices(cache, sinceMap) {
  // Gmail: only pending entries (+ recently-dismissed ids so the gap search
  // does not re-flag something dismissed after `since`).
  const gmailPending = {};
  const recentlyDismissed = [];
  const gmailSince = sinceMap.gmail.getTime();
  for (const [id, e] of Object.entries(cache.gmail_threads || {})) {
    const status = e.status || '';
    if (status.startsWith('pending')) {
      gmailPending[id] = { status, card: e.card || null, processed_at: e.processed_at || null };
    } else if (status.startsWith('dismissed')) {
      const p = parseStamp(e.processed_at);
      if (p && p.getTime() >= gmailSince) recentlyDismissed.push(id);
    }
  }

  // Fathom: meetings with any unresolved action item.
  const fathomUnresolved = {};
  for (const [rid, m] of Object.entries(cache.fathom_meetings || {})) {
    const items = (m.action_items_for_me || []).filter(isFathomItemOpen);
    if (items.length) {
      fathomUnresolved[rid] = { title: m.title, date: m.date, url: m.url, unresolved_items: items };
    }
  }

  return {
    gmail: { pending: gmailPending, recently_dismissed_ids: recentlyDismissed },
    jira_comments: cache.jira_comments || {}, // small; passed whole for comment dedup
    fathom_unresolved: fathomUnresolved,
  };
}

// ── Open cards (for fast-exit render + reference) ──────────────────────────────
function buildOpenCards(cache, slices) {
  const gmail = [];
  for (const [id, e] of Object.entries(slices.gmail.pending)) {
    gmail.push(e.card || `🔴 pending email (thread ${id}) — details in cache · re-check`);
  }
  const jira = [];
  for (const e of Object.values(cache.jira_comments || {})) {
    if (e.open_card) jira.push(e.open_card);
  }
  const fathom = Object.values(slices.fathom_unresolved);
  return { gmail, jira, fathom };
}

// ── Main ───────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode;
  if (!mode || !MODES[mode]) fail(`--mode must be one of ${Object.keys(MODES).join(', ')}`);
  const cfg = MODES[mode];
  const cachePath = args.cache || DEFAULT_CACHE;

  const nowDate = args.now ? parseStamp(args.now) : new Date();
  if (!nowDate) fail('--now is not a parseable timestamp');
  const nowMs = nowDate.getTime();

  // 1. User locale + dates / week / sprint
  const userConfig = loadUserConfig(args['user-config']);
  const workWeekPreset = getWorkWeekPreset(userConfig.work_week);
  const today = localDateString(nowDate);
  const dow = dayOfWeek(today);
  const week = buildWorkWeek(today, workWeekPreset);
  const sprint = (args['sprint-start'] && args['sprint-end'])
    ? { name: args['sprint-name'] || null, start: args['sprint-start'], end: args['sprint-end'] }
    : { note: 'sprint data unavailable' };

  const holidayRangeEnd = sprint?.end || addDays(today, cfg.windowDays + 14);
  const holidayRangeStart = sprint?.start || addDays(today, -cfg.windowDays);
  const regionalHolidays = loadRegionalHolidays(
    userConfig.holiday_region,
    holidayRangeStart,
    holidayRangeEnd,
  );

  // 2. Cache
  const cacheExists = fs.existsSync(cachePath);
  const cache = loadCache(cachePath);
  pruneByTtl(cache, nowMs);
  seedCoverage(cache);
  const hasPriorRun = Object.keys(cache.last_run || {}).length > 0
    || Object.values(cache.coverage || {}).some(Boolean);
  const firstRun = !cacheExists || !hasPriorRun;
  if (userConfig.using_defaults) {
    console.error(
      `prep.mjs: ${userConfig.config_path} not found — using LATAM Mon–Fri defaults; create user config before relying on Week Ahead holidays`,
    );
  }
  if (firstRun) {
    console.error(`prep.mjs: first run — cache will be created at commit (${cachePath})`);
  }

  // 3. since per source
  const sinceMap = {
    gmail: sinceInstant(cache, 'gmail_through', nowMs, cfg.windowDays),
    jira: sinceInstant(cache, 'jira_updates_through', nowMs, cfg.windowDays),
    slack: sinceInstant(cache, 'slack_through', nowMs, cfg.windowDays),
    calendar: sinceInstant(cache, 'calendar_scanned_through', nowMs, cfg.windowDays),
  };
  const jiraMinutesAgo = Math.max(1, Math.round((nowMs - sinceMap.jira.getTime()) / 60000));
  const since = {
    jira: { jql_relative: `-${jiraMinutesAgo}m`, iso: utcIso(sinceMap.jira) },
    gmail: { epoch: Math.floor(sinceMap.gmail.getTime() / 1000), iso: utcIso(sinceMap.gmail) },
    slack: { unix: Math.floor(sinceMap.slack.getTime() / 1000), iso: utcIso(sinceMap.slack) },
    calendar: { start_time: utcIso(sinceMap.calendar), iso: utcIso(sinceMap.calendar) },
  };

  // 4. fast-exit
  const lastRun = parseStamp(cache.last_run?.[mode]);
  const minutesSinceLastRun = lastRun ? Math.round((nowMs - lastRun.getTime()) / 60000) : null;
  const fastExit = cfg.fastExit && minutesSinceLastRun !== null && minutesSinceLastRun < FAST_EXIT_MIN;
  const fastExitLiveSections = fastExit
    ? cfg.sections.filter((s) => !OPEN_CARD_SECTIONS.has(s))
    : [];
  const querySections = fastExit ? fastExitLiveSections : cfg.sections;

  // 5. Sprint work-day counts (user's work-week pattern)
  const sprintWorkDaysRemaining = sprint?.end
    ? countWorkDaysInRange(today, sprint.end, workWeekPreset.workDows)
    : null;
  const sprintWorkDaysTotal = (sprint?.start && sprint?.end)
    ? countWorkDaysInRange(sprint.start, sprint.end, workWeekPreset.workDows)
    : null;

  // 6. slices + open cards
  const slices = buildSlices(cache, sinceMap);
  const openCards = buildOpenCards(cache, slices);

  const runPlan = {
    skill_dir: SKILL_DIR,
    mode,
    now_iso: utcIso(nowDate),
    run_start_iso: utcIso(nowDate),
    today, day_of_week: dow, week, sprint,
    work_week: workWeekPreset.id,
    work_week_label: workWeekPreset.label,
    holiday_region: userConfig.holiday_region,
    regional_holidays: regionalHolidays,
    next_work_week_start: nextWorkWeekStart(today, workWeekPreset),
    user_config_path: userConfig.config_path,
    user_config_using_defaults: userConfig.using_defaults,
    cache_exists: cacheExists,
    first_run: firstRun,
    sprint_work_days_remaining: sprintWorkDaysRemaining,
    sprint_work_days_total: sprintWorkDaysTotal,
    sections: cfg.sections,
    query_sections: querySections,
    worklog: cfg.worklog,
    week_ahead: cfg.weekAhead,
    fast_exit: fastExit,
    fast_exit_live_sections: fastExitLiveSections,
    fast_exit_reason: fastExit ? `ran ${mode} ${minutesSinceLastRun} min ago (<${FAST_EXIT_MIN})` : null,
    minutes_since_last_run: minutesSinceLastRun,
    window_days: cfg.windowDays,
    overlap_min: OVERLAP_MIN,
    since,
    slices,
    open_cards: openCards,
    week_ahead_render: cache.week_ahead_render || null,
    cache_path: cachePath,
    coverage: cache.coverage,
  };

  process.stdout.write(JSON.stringify(runPlan, null, 2) + '\n');
}

main();
