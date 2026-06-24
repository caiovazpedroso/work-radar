#!/usr/bin/env node
/**
 * work-radar — render-report.mjs
 * ==============================
 * Unified report renderer for radar and light profiles.
 *
 * Usage:
 *   node render-report.mjs --runplan <plan.json> --returns <returns.json>
 */

import fs from 'node:fs';
import { parseArgs } from './lib/shared.mjs';
import { renderReport } from './lib/render.mjs';

function fail(msg) {
  console.error(`render-report.mjs: ${msg}`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`cannot read ${label}: ${e.message}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runplanPath = args.runplan || fail('--runplan required');
  const returnsPath = args.returns || fail('--returns required');

  const runplan = readJson(runplanPath, 'run-plan');
  const returns = readJson(returnsPath, 'returns');
  if (!Array.isArray(returns)) fail('--returns must be a JSON array');

  process.stdout.write(`${renderReport(runplan, returns)}\n`);
}

main();
