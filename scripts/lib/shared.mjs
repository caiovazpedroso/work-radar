/**
 * work-check — shared constants and pure utilities.
 * Imported by prep.mjs, commit.mjs, and render-cache.mjs.
 * No side effects; no filesystem access.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_CACHE = join(homedir(), '.claude', 'cache', 'work-check-cache.json');

export const MODES = {
  eod:     { windowDays: 3,  sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'], worklog: true,  weekAhead: 'full', fastExit: true },
  morning: { windowDays: 3,  sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'], worklog: true,  weekAhead: 'trim', fastExit: true },
  now:     { windowDays: 1,  sections: ['slack', 'bitbucket', 'jira'],                    worklog: false, weekAhead: 'none', fastExit: false },
  week:    { windowDays: 7,  sections: ['jira'],                                          worklog: false, weekAhead: 'full', fastExit: true },
  catchup: { windowDays: 14, sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'], worklog: false, weekAhead: 'full', fastExit: true },
};

// Which coverage key each section advances (sections absent here are
// cache-based or pure-state and own no coverage high-water mark).
export const SECTION_COVERAGE = {
  gmail: 'gmail_through',
  jira: 'jira_updates_through',
  slack: 'slack_through',
  calendar: 'calendar_scanned_through',
};

export const TTL_DAYS = { gmail_threads: 7, jira_comments: 14, calendar_events: 7 };

// Sections whose open items re-render from cached cards on fast-exit.
export const OPEN_CARD_SECTIONS = new Set(['gmail', 'jira', 'fathom']);

/** Parse any timestamp we store: plain date, ISO+Z, ISO+offset, or Jira "+0300". */
export function parseStamp(s) {
  if (!s) return null;
  // Normalise a trailing "+HHMM"/"-HHMM" (no colon) into "+HH:MM" for Date().
  const fixed = String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Format a Date as a UTC Zulu ISO string (e.g. 2026-06-24T06:40:41.664Z). */
export function utcIso(d) {
  return d.toISOString(); // already produces Z suffix
}

export function isPlainObject(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}
