/**
 * work-radar — shared constants and pure utilities.
 * Imported by prep.mjs, commit.mjs, and render-report.mjs.
 * No side effects; no filesystem access.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_CACHE = join(homedir(), '.claude', 'cache', 'work-radar-cache.json');

/** @deprecated legacy mode keys — used only for last_run migration */
export const LEGACY_MODES = {
  eod:     { sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'] },
  morning: { sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'] },
  now:     { sections: ['slack', 'bitbucket', 'jira'] },
  week:    { sections: ['jira'] },
  catchup: { sections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'] },
};

export const PROFILES = {
  radar: {
    liveSections: ['jira', 'slack', 'bitbucket', 'fathom', 'gmail'],
    windowDaysMax: 14,
    windowDaysMin: 1,
    firstRunWindowDays: 14,
    worklog: true,
    weekAhead: 'full',
    fastExit: true,
    runCalendarScope: true,
  },
  light: {
    liveSections: ['jira', 'slack', 'bitbucket'],
    windowDaysMax: 1,
    windowDaysMin: 1,
    firstRunWindowDays: 1,
    worklog: false,
    weekAhead: 'none',
    fastExit: false,
    runCalendarScope: false,
  },
};

export const SECTION_LABELS = {
  jira: 'Jira',
  slack: 'Slack',
  bitbucket: 'Bitbucket',
  gmail: 'Gmail',
  fathom: 'Fathom',
};

export const SECTION_ORDER = ['jira', 'slack', 'bitbucket', 'gmail', 'fathom'];

export const SECTION_COVERAGE = {
  gmail: 'gmail_through',
  jira: 'jira_updates_through',
  slack: 'slack_through',
  calendar: 'calendar_scanned_through',
};

export const TTL_DAYS = { gmail_threads: 7, jira_comments: 14, calendar_events: 7 };

export const OPEN_CARD_SECTIONS = new Set(['gmail', 'jira', 'fathom']);

export const LOG_OFF_HOUR = 15;

export function parseStamp(s) {
  if (!s) return null;
  const fixed = String(s).replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const d = new Date(fixed);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function utcIso(d) {
  return d.toISOString();
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

export function resolveProfile(args) {
  const profile = args.profile || args.mode;
  if (!profile || !PROFILES[profile]) return null;
  return profile;
}
