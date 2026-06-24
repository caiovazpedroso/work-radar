#!/usr/bin/env node
/**
 * work-radar — commit.mjs  (engine back-half, zero model involvement)
 * =================================================================
 * Merges the section subagents' structured returns into the cache, advances
 * each source's coverage high-water mark (only for sections that SUCCEEDED —
 * failed sections keep their old mark so the next run self-heals the gap),
 * stamps last_run, preserves unknown top-level keys, and writes atomically.
 *
 * Usage:
 *   node commit.mjs --mode <mode> --run-start <iso> --returns <returns.json> [--cache <path>]
 *
 *   commit.mjs only reads cache_delta, ok, and week_ahead_render from each return.
 *   flagged items are never persisted here — they are synthesized by the orchestrator directly.
 *
 *   <returns.json> is a JSON array of section returns, each shaped:
 *     { "section": "gmail", "ok": true,
 *       "cache_delta": { "gmail_threads": { "<id>": {...} }, ... },
 *       "week_ahead_render": "..."   // optional, from the week-ahead section
 *     }
 *
 * Requirements: Node 16+ (ESM), no external dependencies.
 */

import fs from 'node:fs';
import { SECTION_COVERAGE, DEFAULT_CACHE, parseArgs, isPlainObject } from './lib/shared.mjs';
import { loadCacheStrict } from './lib/cache.mjs';

function fail(msg) {
  console.error(`commit.mjs: ${msg}`);
  process.exit(1);
}

/** Deep-merge src into dst: plain objects merge recursively; everything else
 *  (arrays, scalars, null) replaces. A null VALUE deletes the key (lets a
 *  subagent clear an open_card / resolve a pending thread). */
function deepMerge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v === null) { delete dst[k]; continue; }
    if (isPlainObject(v)) {
      if (!isPlainObject(dst[k])) dst[k] = {};
      deepMerge(dst[k], v);
    } else {
      dst[k] = v;
    }
  }
  return dst;
}

/** Merge jira_comments deltas with special handling for fathom_links:
 *  append new URLs to any existing array rather than replacing it. */
function mergeJiraComments(dstComments, srcComments) {
  for (const [key, incoming] of Object.entries(srcComments)) {
    if (incoming === null) { delete dstComments[key]; continue; }
    if (!isPlainObject(incoming)) { dstComments[key] = incoming; continue; }
    if (!isPlainObject(dstComments[key])) dstComments[key] = {};
    const existing = dstComments[key];
    for (const [field, val] of Object.entries(incoming)) {
      if (field === 'fathom_links' && Array.isArray(val)) {
        // Append new URLs; preserve existing ones.
        const current = Array.isArray(existing.fathom_links) ? existing.fathom_links : [];
        const merged = [...current];
        for (const url of val) {
          if (!merged.includes(url)) merged.push(url);
        }
        existing.fathom_links = merged;
      } else if (val === null) {
        delete existing[field];
      } else {
        existing[field] = val;
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || fail('--mode required');
  const runStart = args['run-start'] || fail('--run-start required');
  const returnsPath = args.returns || fail('--returns required');
  const cachePath = args.cache || DEFAULT_CACHE;

  let cache;
  try {
    cache = loadCacheStrict(cachePath);
  } catch (e) {
    fail(e.message);
  }

  let returns;
  try { returns = JSON.parse(fs.readFileSync(returnsPath, 'utf8')); }
  catch (e) { fail(`could not read/parse --returns: ${e.message}`); }
  if (!Array.isArray(returns)) fail('--returns must be a JSON array of section returns');

  const advanced = [];
  for (const r of returns) {
    if (!r || typeof r !== 'object') continue;

    if (r.cache_delta && isPlainObject(r.cache_delta)) {
      // Handle jira_comments separately so fathom_links arrays are appended, not replaced.
      const { jira_comments: jiraDelta, ...restDelta } = r.cache_delta;
      deepMerge(cache, restDelta);
      if (jiraDelta && isPlainObject(jiraDelta)) {
        mergeJiraComments(cache.jira_comments, jiraDelta);
      }
    }
    if (typeof r.week_ahead_render === 'string') {
      cache.week_ahead_render = r.week_ahead_render;
      cache.week_ahead_render_at = runStart;
    }
    // Advance coverage only for sources whose section succeeded.
    if (r.ok === true && SECTION_COVERAGE[r.section]) {
      cache.coverage[SECTION_COVERAGE[r.section]] = runStart;
      advanced.push(r.section);
    }
  }

  cache.last_run[mode] = runStart;

  // Atomic write: temp file in the same dir, then rename.
  const tmp = cachePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, cachePath);

  console.error(`commit.mjs: wrote ${cachePath}; coverage advanced for [${advanced.join(', ') || 'none'}]; last_run[${mode}]=${runStart}`);
}

main();
