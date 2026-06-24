#!/usr/bin/env node
/**
 * work-radar — prep.mjs  (engine front-half, zero model involvement)
 * =================================================================
 * Resolves everything deterministic so the orchestrating model never does
 * date or JSON math. Emits ONE run-plan JSON object on stdout.
 *
 * Usage:
 *   node prep.mjs --profile <radar|light> [--cache <path>] [--now <iso>]
 *
 *   --profile defaults to radar. Legacy --mode accepted as alias.
 *   --now is for testing only (pins "current time"); omit in real runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROFILES, SECTION_COVERAGE, TTL_DAYS, OPEN_CARD_SECTIONS,
  DEFAULT_CACHE, parseArgs, parseStamp, utcIso, resolveProfile,
} from './lib/shared.mjs';
import { loadCache } from './lib/cache.mjs';
import { loadUserConfig } from './lib/userConfig.mjs';
import { loadRegionalHolidays } from './lib/holidays.mjs';
import {
  getWorkWeekPreset, buildWorkWeek, countWorkDaysInRange,
  nextWorkWeekStart, dayOfWeek, addDays,
} from './lib/workWeek.mjs';

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const LOCAL_OFFSET_MIN = -new Date().getTimezoneOffset();
const OVERLAP_MIN = 15;
const FAST_EXIT_MIN = 30;

function localDateString(d) {
  const local = new Date(d.getTime() + LOCAL_OFFSET_MIN * 60000);
  return local.toISOString().slice(0, 10);
}

function localHour(d) {
  const local = new Date(d.getTime() + LOCAL_OFFSET_MIN * 60000);
  return local.getUTCHours();
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
      if (stamp && stamp.getTime() < cutoff) delete slice[id];
    }
  }
}

function seedCoverage(cache) {
  if (!cache.coverage) cache.coverage = {};
  const allRuns = Object.values(cache.last_run || {})
    .map(parseStamp)
    .filter(Boolean)
    .map((d) => d.getTime());
  const maxRun = allRuns.length ? Math.max(...allRuns) : null;
  if (!maxRun) return;
  for (const covKey of Object.values(SECTION_COVERAGE)) {
    if (cache.coverage[covKey]) continue;
    cache.coverage[covKey] = utcIso(new Date(maxRun));
  }
}

function computeWindowDays(cache, nowMs, firstRun, profile) {
  const cfg = PROFILES[profile];
  if (firstRun) return cfg.firstRunWindowDays;
  if (profile === 'light') return cfg.windowDaysMax;

  const candidates = [
    ...Object.values(cache.coverage || {}).map(parseStamp),
    parseStamp(cache.last_run?.radar),
  ].filter(Boolean).map((d) => d.getTime());

  if (!candidates.length) return cfg.firstRunWindowDays;
  const oldest = Math.min(...candidates);
  const gapDays = (nowMs - oldest) / 86400000;
  return Math.min(cfg.windowDaysMax, Math.max(cfg.windowDaysMin, Math.ceil(gapDays)));
}

function sinceInstant(cache, coverageKey, nowMs, windowDays) {
  const cov = parseStamp(cache.coverage?.[coverageKey]);
  const floor = nowMs - windowDays * 86400000;
  const fromCov = cov ? cov.getTime() - OVERLAP_MIN * 60000 : -Infinity;
  return new Date(Math.max(fromCov, floor));
}

function isFathomItemOpen(item) {
  return item.status !== 'done';
}

function buildSlices(cache, sinceMap) {
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

  const fathomUnresolved = {};
  for (const [rid, m] of Object.entries(cache.fathom_meetings || {})) {
    const items = (m.action_items_for_me || []).filter(isFathomItemOpen);
    if (items.length) {
      fathomUnresolved[rid] = { title: m.title, date: m.date, url: m.url, unresolved_items: items };
    }
  }

  return {
    gmail: { pending: gmailPending, recently_dismissed_ids: recentlyDismissed },
    jira_comments: cache.jira_comments || {},
    fathom_unresolved: fathomUnresolved,
  };
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const profile = resolveProfile(args);
  if (!profile) fail(`--profile must be one of ${Object.keys(PROFILES).join(', ')}`);
  const cfg = PROFILES[profile];
  const cachePath = args.cache || DEFAULT_CACHE;

  const nowDate = args.now ? parseStamp(args.now) : new Date();
  if (!nowDate) fail('--now is not a parseable timestamp');
  const nowMs = nowDate.getTime();

  const userConfig = loadUserConfig(args['user-config']);
  const workWeekPreset = getWorkWeekPreset(userConfig.work_week);
  const today = localDateString(nowDate);
  const dow = dayOfWeek(today);
  const week = buildWorkWeek(today, workWeekPreset);
  const sprint = (args['sprint-start'] && args['sprint-end'])
    ? { name: args['sprint-name'] || null, start: args['sprint-start'], end: args['sprint-end'] }
    : { note: 'sprint data unavailable' };

  const cacheExists = fs.existsSync(cachePath);
  const cache = loadCache(cachePath);
  pruneByTtl(cache, nowMs);
  seedCoverage(cache);
  const hasPriorRun = Object.keys(cache.last_run || {}).length > 0
    || Object.values(cache.coverage || {}).some(Boolean);
  const firstRun = !cacheExists || !hasPriorRun;
  const effectiveWindowDays = computeWindowDays(cache, nowMs, firstRun, profile);

  const holidayRangeEnd = sprint?.end || addDays(today, effectiveWindowDays + 14);
  const holidayRangeStart = sprint?.start || addDays(today, -effectiveWindowDays);
  const regionalHolidays = loadRegionalHolidays(
    userConfig.holiday_region,
    holidayRangeStart,
    holidayRangeEnd,
  );

  if (userConfig.using_defaults) {
    console.error(
      `prep.mjs: ${userConfig.config_path} not found — using LATAM Mon–Fri defaults; create user config before relying on Week Ahead holidays`,
    );
  }
  if (firstRun) {
    console.error(`prep.mjs: first run — cache will be created at commit (${cachePath})`);
    if (profile === 'light') {
      console.error(
        'prep.mjs: warning — first run with profile "light" has empty Gmail/Fathom/Week Ahead cache; run radar first for full coverage',
      );
    }
  }

  const sinceMap = {
    gmail: sinceInstant(cache, 'gmail_through', nowMs, effectiveWindowDays),
    jira: sinceInstant(cache, 'jira_updates_through', nowMs, effectiveWindowDays),
    slack: sinceInstant(cache, 'slack_through', nowMs, effectiveWindowDays),
    calendar: sinceInstant(cache, 'calendar_scanned_through', nowMs, effectiveWindowDays),
  };
  const jiraMinutesAgo = Math.max(1, Math.round((nowMs - sinceMap.jira.getTime()) / 60000));
  const since = {
    jira: { jql_relative: `-${jiraMinutesAgo}m`, iso: utcIso(sinceMap.jira) },
    gmail: { epoch: Math.floor(sinceMap.gmail.getTime() / 1000), iso: utcIso(sinceMap.gmail) },
    slack: { unix: Math.floor(sinceMap.slack.getTime() / 1000), iso: utcIso(sinceMap.slack) },
    calendar: { start_time: utcIso(sinceMap.calendar), iso: utcIso(sinceMap.calendar) },
  };

  const lastRun = parseStamp(cache.last_run?.radar);
  const minutesSinceLastRun = lastRun ? Math.round((nowMs - lastRun.getTime()) / 60000) : null;
  const fastExit = profile === 'radar'
    && cfg.fastExit
    && minutesSinceLastRun !== null
    && minutesSinceLastRun < FAST_EXIT_MIN;
  const fastExitLiveSections = fastExit
    ? cfg.liveSections.filter((s) => !OPEN_CARD_SECTIONS.has(s))
    : [];
  const querySections = fastExit ? fastExitLiveSections : cfg.liveSections;
  const runCalendarScope = cfg.runCalendarScope && !fastExit;
  const runWeekAhead = cfg.weekAhead !== 'none' && !fastExit;

  const sprintWorkDaysRemaining = sprint?.end
    ? countWorkDaysInRange(today, sprint.end, workWeekPreset.workDows)
    : null;
  const sprintWorkDaysTotal = (sprint?.start && sprint?.end)
    ? countWorkDaysInRange(sprint.start, sprint.end, workWeekPreset.workDows)
    : null;

  const slices = buildSlices(cache, sinceMap);
  const openCards = buildOpenCards(cache, slices);

  const runPlan = {
    skill_dir: SKILL_DIR,
    profile,
    now_iso: utcIso(nowDate),
    run_start_iso: utcIso(nowDate),
    local_hour: localHour(nowDate),
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
    sections: cfg.liveSections,
    query_sections: querySections,
    run_calendar_scope: runCalendarScope,
    run_week_ahead: runWeekAhead,
    worklog: cfg.worklog,
    week_ahead: cfg.weekAhead,
    fast_exit: fastExit,
    fast_exit_live_sections: fastExitLiveSections,
    fast_exit_reason: fastExit ? `ran radar ${minutesSinceLastRun} min ago (<${FAST_EXIT_MIN})` : null,
    minutes_since_last_run: minutesSinceLastRun,
    window_days: effectiveWindowDays,
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
