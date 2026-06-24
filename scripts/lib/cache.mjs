/**
 * work-radar — shared cache load and normalization.
 * Used by prep.mjs (read) and commit.mjs (read-before-write).
 */

import fs from 'node:fs';

const REQUIRED_CONTAINERS = {
  fathom_meetings: {},
  calendar_events: {},
  gmail_threads: {},
  jira_comments: {},
  last_run: {},
  coverage: {},
};

/** Ensure required top-level containers exist without dropping unknown keys. */
export function ensureCacheContainers(cache) {
  for (const [k, defaultVal] of Object.entries(REQUIRED_CONTAINERS)) {
    if (!(k in cache)) cache[k] = defaultVal;
  }
  return cache;
}

/** One-time upgrade: convert old string action items ("Fix it - PENDING") to
 *  structured objects ({ text, status }).  Runs on every load but is a no-op
 *  once all entries are already in the new shape. */
function migrateFathomItems(cache) {
  const STATUS_RE = /\s*-\s*(DONE|PENDING|IN[_\s]PROGRESS)(\s*\(.*?\))?$/i;
  for (const m of Object.values(cache.fathom_meetings || {})) {
    const items = m.action_items_for_me || m.action_items;
    if (!Array.isArray(items) || !items.length || typeof items[0] !== 'string') continue;
    m.action_items_for_me = items.map((s) => {
      const match = s.match(STATUS_RE);
      const rawStatus = match ? match[1].toLowerCase().replace(/[\s_]+/, '_') : 'pending';
      const status = rawStatus === 'done' ? 'done' : rawStatus === 'in_progress' ? 'in_progress' : 'pending';
      return { text: s.replace(STATUS_RE, '').trim(), status };
    });
    delete m.action_items;
  }
}

/** Normalize in-memory cache shape after load (migrations, etc.). */
export function normalizeCache(cache) {
  ensureCacheContainers(cache);
  migrateFathomItems(cache);
  return cache;
}

/** Load cache from disk; returns empty normalized base if missing or invalid. */
export function loadCache(cachePath) {
  let raw = null;
  if (fs.existsSync(cachePath)) {
    raw = fs.readFileSync(cachePath, 'utf8');
  }
  if (!raw) return normalizeCache({ ...REQUIRED_CONTAINERS });
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return normalizeCache({ ...REQUIRED_CONTAINERS });
  }
  return normalizeCache(parsed);
}

/** Load cache from disk; throws if file exists but is not valid JSON. */
export function loadCacheStrict(cachePath) {
  if (!fs.existsSync(cachePath)) {
    return normalizeCache({ ...REQUIRED_CONTAINERS });
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    throw new Error('existing cache is not valid JSON; refusing to overwrite');
  }
  return normalizeCache(parsed);
}
