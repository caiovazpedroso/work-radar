#!/usr/bin/env node
/**
 * work-radar — patch-fathom-jira.mjs
 * ==================================
 * Applies a user-confirmed Fathom action item → Jira ticket link to the cache.
 * Marks the action item done and appends the Fathom URL to the Jira issue entry.
 * Does not touch coverage or last_run (unlike commit.mjs).
 *
 * Usage:
 *   node patch-fathom-jira.mjs \
 *     --recording-id <id> \
 *     --fathom-item "<exact action item text>" \
 *     --jira-key JON-123 \
 *     --fathom-url "<meeting URL>" \
 *     [--cache <path>]
 *
 * Requirements: Node 16+ (ESM), no external dependencies.
 */

import fs from 'node:fs';
import { DEFAULT_CACHE, parseArgs, isPlainObject } from './lib/shared.mjs';
import { loadCacheStrict } from './lib/cache.mjs';

function fail(msg) {
  console.error(`patch-fathom-jira.mjs: ${msg}`);
  process.exit(1);
}

function appendFathomLink(jiraComments, jiraKey, url) {
  if (!isPlainObject(jiraComments[jiraKey])) jiraComments[jiraKey] = {};
  const existing = jiraComments[jiraKey];
  const current = Array.isArray(existing.fathom_links) ? existing.fathom_links : [];
  if (!current.includes(url)) {
    existing.fathom_links = [...current, url];
  }
}

function writeCacheAtomic(cachePath, cache) {
  const tmp = cachePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, cachePath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const recordingId = args['recording-id'] || fail('--recording-id required');
  const fathomItem = args['fathom-item'] || fail('--fathom-item required');
  const jiraKey = args['jira-key'] || fail('--jira-key required');
  const fathomUrl = args['fathom-url'] || fail('--fathom-url required');
  const cachePath = args.cache || DEFAULT_CACHE;

  let cache;
  try {
    cache = loadCacheStrict(cachePath);
  } catch (e) {
    fail(e.message);
  }

  const meeting = cache.fathom_meetings?.[recordingId];
  if (!meeting) {
    fail(`no fathom_meetings entry for recording-id "${recordingId}"`);
  }

  const items = meeting.action_items_for_me;
  if (!Array.isArray(items) || !items.length) {
    fail(`recording "${recordingId}" has no action_items_for_me`);
  }

  const item = items.find((entry) => entry?.text === fathomItem);
  if (!item) {
    fail(`no action item with text matching --fathom-item (check exact wording)`);
  }

  item.status = 'done';
  appendFathomLink(cache.jira_comments, jiraKey, fathomUrl);
  writeCacheAtomic(cachePath, cache);

  console.error(
    `patch-fathom-jira.mjs: marked item done on ${recordingId}; appended Fathom link to ${jiraKey}`,
  );
}

main();
