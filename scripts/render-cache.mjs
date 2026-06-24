#!/usr/bin/env node
/**
 * work-check — render-cache.mjs  (fast-exit renderer, zero model involvement)
 * ==========================================================================
 * When prep.mjs sets fast_exit:true (a re-run within 30 min of the same mode),
 * no MCP/subagent work happens. This script renders the still-open items
 * straight from the cached cards in the run-plan, so the model just prints it.
 *
 * Usage:
 *   node render-cache.mjs --runplan <runplan.json>
 *     (runplan.json = the stdout of prep.mjs)
 *
 * Requirements: Node 16+ (ESM), no external dependencies.
 */

import fs from 'node:fs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function section(title, cards, emptyMsg) {
  const has = cards && cards.length;
  const head = `### ${title} ${has ? '🔴' : '✅'}`;
  const body = has ? cards.map((c) => `- ${c}`).join('\n') : emptyMsg;
  return `${head}\n${body}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const runplanPath = args.runplan;
  if (!runplanPath) { console.error('render-cache.mjs: --runplan required'); process.exit(1); }

  let plan;
  try { plan = JSON.parse(fs.readFileSync(runplanPath, 'utf8')); }
  catch (e) { console.error(`render-cache.mjs: cannot read run-plan: ${e.message}`); process.exit(1); }

  const oc = plan.open_cards || {};
  const fathomCards = (oc.fathom || []).flatMap((m) =>
    (m.unresolved_items || []).map((it) => `🔴 ${m.title} (${m.date}) — ${it} · ${m.url}`));

  const totalOpen = (oc.gmail?.length || 0) + (oc.jira?.length || 0) + fathomCards.length;
  const mins = plan.minutes_since_last_run;

  const out = [];
  out.push(`## Work Check (${plan.mode}) — ${plan.today}, ${plan.day_of_week}`);
  out.push(`⏱️ Ran ${plan.mode} ${mins} min ago — nothing re-fetched. ${totalOpen} item(s) still open (as of last run).`);
  out.push('');
  out.push(section('Jira', oc.jira, '✅ No open tickets carried from the last run.'));
  out.push('');
  out.push(section('Gmail', oc.gmail, '✅ No emails carried from the last run.'));
  out.push('');
  out.push(section('Meetings / Fathom', fathomCards, '✅ No unresolved action items carried from the last run.'));
  out.push('');
  out.push('---');
  out.push(totalOpen ? `🔴 ${totalOpen} item(s) still open from the last run.` : '✅ All clear from the last run.');

  if (plan.week_ahead_render) {
    out.push('');
    out.push('---');
    out.push('');
    out.push('### Week Ahead *(cached from last run)*');
    out.push(plan.week_ahead_render);
  }

  out.push('');
  out.push('*Fast-exit: re-run is recent, so sources were not re-queried. Run again later, or use `now` mode to force a live check.*');

  process.stdout.write(out.join('\n') + '\n');
}

main();
