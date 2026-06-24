/**
 * work-check — regional holiday calendars for Jones offices.
 * PTO is per-user and comes from Google Calendar (calendar subagent), not here.
 */

import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadRegionalHolidays(region, fromDate, toDate) {
  const path = join(SKILL_DIR, 'references', 'holidays', `${region}.json`);
  if (!fs.existsSync(path)) return [];
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return [];
  }
  return (data.holidays || [])
    .filter((h) => h.date >= fromDate && h.date <= toDate)
    .map((h) => ({ date: h.date, name: h.name, source: 'regional' }));
}
