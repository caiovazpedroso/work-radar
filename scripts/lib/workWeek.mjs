/**
 * work-radar — work-week presets and date helpers.
 * Jones teams use Mon–Fri (LATAM) or Sun–Thu (Tel Aviv).
 */

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const WORK_WEEKS = {
  mon_fri: { id: 'mon_fri', label: 'Mon–Fri', startDow: 1, workDows: [1, 2, 3, 4, 5] },
  sun_thu: { id: 'sun_thu', label: 'Sun–Thu', startDow: 0, workDows: [0, 1, 2, 3, 4] },
};

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(dateStr) {
  return DOW[new Date(dateStr + 'T12:00:00Z').getUTCDay()];
}

export function getWorkWeekPreset(id) {
  return WORK_WEEKS[id] || WORK_WEEKS.mon_fri;
}

/** First day of the work week that contains dateStr. */
export function weekStartDate(dateStr, preset) {
  const todayDow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  let offset = todayDow - preset.startDow;
  if (offset < 0) offset += 7;
  return addDays(dateStr, -offset);
}

/** The five work days of the week containing dateStr. */
export function buildWorkWeek(dateStr, preset) {
  const start = weekStartDate(dateStr, preset);
  const work_days = [0, 1, 2, 3, 4].map((n) => addDays(start, n));
  return {
    work_week: preset.id,
    work_week_label: preset.label,
    week_start: start,
    week_end: work_days[4],
    work_days,
  };
}

/** Count days in [from, to] that fall on the user's work-week pattern. */
export function countWorkDaysInRange(from, to, workDows) {
  let count = 0;
  let cursor = from;
  while (cursor <= to) {
    const dow = new Date(cursor + 'T12:00:00Z').getUTCDay();
    if (workDows.includes(dow)) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/** First day of the next work week after the current one's week_end. */
export function nextWorkWeekStart(dateStr, preset) {
  const week = buildWorkWeek(dateStr, preset);
  let cursor = addDays(week.week_end, 1);
  while (new Date(cursor + 'T12:00:00Z').getUTCDay() !== preset.startDow) {
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** True when dateStr falls on a day outside the user's work-week pattern. */
export function isWeekendDay(dateStr, preset) {
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  return !preset.workDows.includes(dow);
}
