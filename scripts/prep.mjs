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
 *   1. Resolve dates/day-of-week, this week's Mon–Fri, and the 2-week sprint
 *      window anchored Monday 2026-06-08 — all in the system's local timezone.
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
import { homedir } from 'node:os';

const SKILL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ── Constants ────────────────────────────────────────────────────────────────
const LOCAL_OFFSET_MIN = -new Date().getTimezoneOffset(); // system timezone, DST-aware
const OVERLAP_MIN = 15;                // safety re-scan before the high-water mark
const FAST_EXIT_MIN = 30;              // re-run within this window → fast-exit (not in `now`)
const DEFAULT_CACHE = path.join(homedir(), '.claude', 'cache', 'work-check-cache.json');

const MODES = {
  eod:     { windowDays: 3,  sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'], worklog: true,  weekAhead: 'full', fastExit: true },
  morning: { windowDays: 3,  sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'], worklog: true,  weekAhead: 'trim', fastExit: true },
  now:     { windowDays: 1,  sections: ['slack', 'bitbucket', 'jira'],                    worklog: false, weekAhead: 'none', fastExit: false },
  week:    { windowDays: 7,  sections: ['jira'],                                          worklog: false, weekAhead: 'full', fastExit: true },
  catchup: { windowDays: 14, sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'], worklog: false, weekAhead: 'full', fastExit: true },
};

// Which coverage key each section advances (sections absent here are
// cache-based or pure-state and own no coverage high-water mark).
const SECTION_COVERAGE = {
  gmail: 'gmail_through',
  jira: 'jira_updates_through',
  slack: 'slack_through',
  calendar: 'calendar_scanned_through',
};

const TTL_DAYS = { gmail_threads: 7, jira_comments: 14, calendar_events: 7 };

// ── Small date helpers (all explicit; no mental math anywhere) ────────────────

/** Parse any timestamp we store: plain date, ISO+Z, ISO+offset, or Jira "+0300". */
function parseStamp(s) {
  if (!s) return null;
  // Normalise a trailing "+HHMM"/"-HHMM" (no colon) into "+HH:MM" for Date().
  const fixed = String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as the YYYY-MM-DD calendar date in the system's local timezone. */
function localDateString(d) {
  const local = new Date(d.getTime() + LOCAL_OFFSET_MIN * 60000);
  return local.toISOString().slice(0, 10);
}

/** Day of week (Mon..Sun) for an SP calendar date string. */
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayOfWeek(dateStr) {
  // Treat the date as noon UTC to avoid any boundary ambiguity.
  return DOW[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
}

/** Add days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Format a Date as a UTC Zulu ISO string (e.g. 2026-06-24T06:40:41.664Z). */
function utcIso(d) {
  return d.toISOString(); // already produces Z suffix
}


// ── Args ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function fail(msg) {
  console.error(`prep.mjs: ${msg}`);
  process.exit(1);
}

// ── Cache load / migrate / prune ───────────────────────────────────────────────
function loadCache(cachePath) {
  let raw = null;
  if (fs.existsSync(cachePath)) {
    raw = fs.readFileSync(cachePath, 'utf8');
  }
  const base = {
    fathom_meetings: {}, calendar_events: {}, gmail_threads: {},
    jira_comments: {}, last_run: {}, coverage: {},
  };
  if (!raw) return base;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return base; }
  // Ensure required containers exist without dropping unknown keys.
  for (const k of Object.keys(base)) if (!(k in parsed)) parsed[k] = base[k];
  return parsed;
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

/** Backfill any MISSING coverage key from the most recent last_run, so a source
 *  that has never recorded coverage (first run, or one that failed last time)
 *  still narrows from the last run instead of re-scanning the whole window.
 *  eod/morning cover every source, so last_run is a safe high-water mark. */
function seedCoverage(cache) {
  if (!cache.coverage) cache.coverage = {};
  const runs = Object.values(cache.last_run || {})
    .map(parseStamp).filter(Boolean).map((d) => d.getTime());
  if (!runs.length) return;
  const seed = utcIso(new Date(Math.max(...runs)));
  for (const k of Object.values(SECTION_COVERAGE)) {
    if (!cache.coverage[k]) cache.coverage[k] = seed; // backfill only missing
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
  // Items carry a trailing status: "- DONE", "- DONE (…)", "- IN PROGRESS",
  // "- PENDING". Anything marked DONE is resolved; everything else is open.
  return !/\bDONE\b/i.test(item);
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
    const items = (m.action_items_for_me || m.action_items || []).filter(isFathomItemOpen);
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

  // 1. Dates / week / sprint
  const today = localDateString(nowDate);
  const dow = dayOfWeek(today);
  const todayIdx = DOW.indexOf(dow);              // 0=Sun..6=Sat
  const mondayOffset = todayIdx === 0 ? -6 : 1 - todayIdx; // Mon of current week
  const monday = addDays(today, mondayOffset);
  const week = {
    monday,
    friday: addDays(monday, 4),
    work_days: [0, 1, 2, 3, 4].map((n) => addDays(monday, n)),
  };
  const sprint = (args['sprint-start'] && args['sprint-end'])
    ? { name: args['sprint-name'] || null, start: args['sprint-start'], end: args['sprint-end'] }
    : { note: 'sprint data unavailable' };

  // 2. Cache
  const cache = loadCache(cachePath);
  pruneByTtl(cache, nowMs);
  seedCoverage(cache);

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

  // 5. Sprint work days remaining (today inclusive, through sprint end, Mon–Fri only)
  const sprintWorkDaysRemaining = (() => {
    if (!sprint?.end) return null;
    let count = 0;
    let cursor = today;
    while (cursor <= sprint.end) {
      const dow = new Date(cursor + 'T12:00:00Z').getUTCDay(); // 0=Sun,6=Sat
      if (dow >= 1 && dow <= 5) count++;
      cursor = addDays(cursor, 1);
    }
    return count;
  })();

  // 6. slices + open cards
  const slices = buildSlices(cache, sinceMap);
  const openCards = buildOpenCards(cache, slices);

  const runPlan = {
    skill_dir: SKILL_DIR,
    mode,
    now_iso: utcIso(nowDate),
    run_start_iso: utcIso(nowDate),
    today, day_of_week: dow, week, sprint,
    sprint_work_days_remaining: sprintWorkDaysRemaining,
    sections: cfg.sections,
    worklog: cfg.worklog,
    week_ahead: cfg.weekAhead,
    fast_exit: fastExit,
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
