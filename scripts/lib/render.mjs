/**
 * work-radar — report rendering (pure functions, no I/O).
 */

import {
  SECTION_LABELS, SECTION_ORDER, LOG_OFF_HOUR,
} from './shared.mjs';

const EMOJI_RANK = { '🔴': 0, '🟡': 1, '⚠️': 2, '✅': 3 };
const SOURCE_RANK = Object.fromEntries(SECTION_ORDER.map((s, i) => [s, i]));

const NON_ACTIONABLE_WHY = /\b(no response needed|resolved|already replied|thread resolved|does not need|no action needed)\b/i;

/** flagged[] must only contain items needing action — drop ✅ and "resolved" noise from section returns. */
export function isActionableFlag(item) {
  if (!item || typeof item !== 'object') return false;
  const emoji = item.emoji || '🔴';
  if (emoji === '✅') return false;
  const text = `${item.why || ''} ${item.action || ''}`;
  if (NON_ACTIONABLE_WHY.test(text)) return false;
  return emoji === '🔴' || emoji === '🟡' || emoji === '⚠️';
}

export function actionableFlags(flagged) {
  return (flagged || []).filter(isActionableFlag);
}

export function normalizeReturns(returns) {
  const bySection = {};
  if (!Array.isArray(returns)) return bySection;
  for (const r of returns) {
    if (!r || typeof r !== 'object' || !r.section) continue;
    bySection[r.section] = r;
  }
  return bySection;
}

export function formatFlaggedItem(item, source, origin = 'live') {
  const emoji = item.emoji || '🔴';
  const who = item.who || '';
  const why = item.why || '';
  const action = item.action || '';
  const link = item.link || '';
  const parts = [who, why].filter(Boolean).join(' — ');
  const tail = [action, link].filter(Boolean).join(' · ');
  const line = tail ? `${parts} · ${tail}` : parts;
  return {
    emoji,
    line: `${emoji} ${line}`,
    source,
    origin,
    stub: truncateStub(`${emoji} ${who || why}`.replace(/^🔴\s*/, '🔴 '), 60),
  };
}

function truncateStub(text, maxLen) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1)}…`;
}

export function fathomCardsToItems(fathomMeetings) {
  return (fathomMeetings || []).flatMap((m) =>
    (m.unresolved_items || []).map((it) => {
      const text = typeof it === 'string' ? it : it.text;
      return formatFlaggedItem(
        { emoji: '🔴', who: `${m.title} (${m.date})`, why: text, action: '', link: m.url || '' },
        'fathom',
        'cache',
      );
    }));
}

export function cardStringToItem(card, source) {
  return {
    emoji: card.startsWith('🟡') ? '🟡' : card.startsWith('⚠️') ? '⚠️' : '🔴',
    line: card,
    source,
    origin: 'cache',
    stub: truncateStub(card, 60),
  };
}

export function buildRadarInbox(bySection, runplan) {
  const sections = runplan.sections || SECTION_ORDER;
  const items = [];

  if (runplan.fast_exit) {
    const oc = runplan.open_cards || {};
    for (const card of oc.gmail || []) items.push(cardStringToItem(card, 'gmail'));
    for (const card of oc.jira || []) items.push(cardStringToItem(card, 'jira'));
    items.push(...fathomCardsToItems(oc.fathom));
  }

  for (const section of sections) {
    const ret = bySection[section];
    if (!ret?.flagged?.length) continue;
    for (const f of actionableFlags(ret.flagged)) {
      items.push(formatFlaggedItem(f, section, 'live'));
    }
  }
  return dedupeInbox(sortInbox(items));
}

export function buildLightInbox(runplan, bySection) {
  const liveSections = runplan.sections || ['jira', 'slack', 'bitbucket'];
  const items = [];

  for (const section of liveSections) {
    const ret = bySection[section];
    if (!ret?.flagged?.length) continue;
    for (const f of actionableFlags(ret.flagged)) {
      items.push(formatFlaggedItem(f, section, 'live'));
    }
  }

  const oc = runplan.open_cards || {};
  for (const card of oc.gmail || []) {
    items.push(cardStringToItem(card, 'gmail'));
  }
  for (const card of oc.jira || []) {
    items.push(cardStringToItem(card, 'jira'));
  }
  items.push(...fathomCardsToItems(oc.fathom));

  return dedupeInbox(sortInbox(items));
}

function dedupeInbox(items) {
  const seen = new Set();
  return items.filter((it) => {
    const key = it.line;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortInbox(items) {
  return [...items].sort((a, b) => {
    const er = (EMOJI_RANK[a.emoji] ?? 9) - (EMOJI_RANK[b.emoji] ?? 9);
    if (er !== 0) return er;
    return (SOURCE_RANK[a.source] ?? 9) - (SOURCE_RANK[b.source] ?? 9);
  });
}

export function sectionStatus(section, bySection, runplan, profile) {
  const ret = bySection[section];
  const oc = runplan.open_cards || {};
  const cacheOnly = (profile === 'light' && !runplan.sections?.includes(section))
    || (profile === 'radar' && runplan.fast_exit && !ret?.flagged?.length);

  if (cacheOnly) {
    const hasGmail = section === 'gmail' && oc.gmail?.length;
    const hasJira = section === 'jira' && oc.jira?.length;
    const hasFathom = section === 'fathom' && oc.fathom?.length;
    if (hasGmail || hasJira || hasFathom) return '🔴';
    if (profile === 'light' && (section === 'gmail' || section === 'fathom')) {
      if (!runplan.cache_exists) return '—';
    }
    if (ret?.ok === false) return '⚠️';
    return '✅';
  }

  if (ret && ret.ok === false) return '⚠️';
  if (!ret) return '✅';
  const actionable = actionableFlags(ret.flagged);
  if (!actionable.length) return '✅';
  const hasRed = actionable.some((f) => (f.emoji || '🔴') === '🔴');
  return hasRed ? '🔴' : '🟡';
}

export function buildRollup(sections, bySection, runplan, profile) {
  return sections
    .map((s) => {
      const label = SECTION_LABELS[s] || s;
      const status = sectionStatus(s, bySection, runplan, profile);
      const suffix = profile === 'light' && !runplan.sections?.includes(s) && status !== '—'
        ? ' (cache)' : '';
      return `${label} ${status}${suffix}`;
    })
    .join(' · ');
}

export function buildSectionDetail(section, bySection, inbox) {
  const ret = bySection[section];
  const sectionItems = inbox.filter((it) => it.source === section);
  if (ret?.ok === false) {
    const reason = ret.notes?.[0] || 'unknown error';
    return [`### ${SECTION_LABELS[section] || section} ⚠️`, `⚠️ Could not check — ${reason}`];
  }
  if (!sectionItems.length) return [];
  const lines = [`#### ${SECTION_LABELS[section] || section} ${sectionItems[0].emoji === '🟡' ? '🟡' : '🔴'}`];
  for (const it of sectionItems) {
    lines.push(`- ${it.line}${it.origin === 'cache' ? ' (cache)' : ''}`);
  }
  return lines;
}

export function buildCachedDetail(runplan, inbox) {
  const cached = inbox.filter((it) => it.origin === 'cache' && it.source !== 'week_ahead');
  if (!cached.length) return [];
  const lines = ['#### From cache'];
  for (const it of cached) {
    const tag = SECTION_LABELS[it.source] || it.source;
    lines.push(`- [${tag}] ${it.line}`);
  }
  return lines;
}

export function digestWeekAheadUrgent(weekAheadRender) {
  if (!weekAheadRender || typeof weekAheadRender !== 'string') return [];
  const lines = weekAheadRender.split('\n');
  const out = [];
  let inUrgentBlock = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith('### Week Ahead')) continue;
    if (line.startsWith('#### Sprint Health')) {
      inUrgentBlock = true;
      out.push(line);
      continue;
    }
    if (line.includes('🔴 Over capacity') || line.includes('⚠️ Pace unknown')) {
      out.push(line);
      continue;
    }
    if (/^\*\*(Today|Tomorrow|Next Work Day)/i.test(line)) {
      inUrgentBlock = true;
      out.push(line);
      continue;
    }
    if (line.startsWith('**Later this week') || line.startsWith('**Tickets to finish')) {
      inUrgentBlock = false;
      continue;
    }
    if (line.startsWith('**') && !line.includes('Today') && !line.includes('Tomorrow') && !line.includes('Next Work Day')) {
      inUrgentBlock = false;
      continue;
    }
    if (inUrgentBlock && (line.includes('🔴') || line.includes('🟡') || line.includes('⚠️'))) {
      out.push(line);
    } else if (line.includes('🔴 Over capacity') || line.includes('⚠️')) {
      out.push(line);
    }
  }
  return out;
}

export function worklogLine(bySection) {
  const jira = bySection.jira;
  if (!jira?.worklog || jira.worklog === 'SKIPPED') return null;
  const wl = jira.worklog;
  if (wl.startsWith('✅') || wl.startsWith('🔴')) return `Worklog: ${wl}`;
  if (wl.includes('Full day')) return `Worklog: ✅ ${wl}`;
  if (wl.includes('Partial') || wl.includes('No worklog')) return `Worklog: 🔴 ${wl}`;
  return `Worklog: ${wl}`;
}

export function isWorklogIncomplete(bySection) {
  const jira = bySection.jira;
  if (!jira?.worklog) return false;
  const wl = jira.worklog;
  return wl.includes('Partial') || wl.includes('No worklog');
}

export function buildStubLine(inbox, maxItems = 3) {
  const picks = inbox.slice(0, maxItems);
  if (!picks.length) return null;
  return picks.map((it) => it.stub || truncateStub(it.line, 60)).join(' · ');
}

export function worklogAnchorSuffix(bySection) {
  const jira = bySection.jira;
  if (!jira?.worklog || jira.worklog === 'SKIPPED') return '';
  const wl = jira.worklog;
  if (wl.includes('Full day') || (wl.startsWith('✅') && !wl.includes('Partial'))) {
    return ' · ✅ worklog ok';
  }
  if (wl.includes('Partial')) return ' · 🔴 worklog partial';
  if (wl.includes('No worklog')) return ' · 🔴 no worklog today';
  return '';
}

export function buildAnchor(profile, inbox, bySection, runplan) {
  const count = inbox.length;
  const hour = runplan.local_hour ?? 12;
  const afterLogOffHour = hour >= LOG_OFF_HOUR;
  const worklogSuffix = profile === 'radar' ? worklogAnchorSuffix(bySection) : '';
  const sources = [...new Set(inbox.map((it) => SECTION_LABELS[it.source] || it.source))];
  const weekDigest = digestWeekAheadUrgent(runplan.week_ahead_render);
  const hasWeekUrgent = weekDigest.some((l) => l.includes('🔴') || l.includes('🟡'));

  if (profile === 'light') {
    const anchorSources = [...sources];
    if (hasWeekUrgent && !anchorSources.includes('Week Ahead')) anchorSources.push('Week Ahead');
    const src = anchorSources.slice(0, 5).join(', ');
    if (count === 0 && !hasWeekUrgent) {
      const coldCache = !runplan.cache_exists
        || (!runplan.week_ahead_render
          && !(runplan.open_cards?.gmail?.length)
          && !(runplan.open_cards?.fathom?.length));
      if (coldCache) {
        return '✅ Nothing urgent · run radar for Gmail/Fathom/week outlook';
      }
      return '✅ Nothing urgent';
    }
    const displayCount = count || 1;
    return `🔴 ${displayCount} item${displayCount === 1 ? '' : 's'} need attention — ${src}`;
  }

  if (count === 0) {
    if (afterLogOffHour && isWorklogIncomplete(bySection)) {
      return `🔴 Not clear to log off${worklogSuffix}`;
    }
    if (afterLogOffHour) return `✅ All clear — good to log off${worklogSuffix}`;
    return `✅ All clear${worklogSuffix}`;
  }

  if (afterLogOffHour) {
    return `🔴 ${count} item${count === 1 ? '' : 's'} — not clear to log off${worklogSuffix}`;
  }
  return `🔴 ${count} item${count === 1 ? '' : 's'} need attention${worklogSuffix}`;
}

export function renderReport(runplan, returns) {
  const profile = runplan.profile || 'radar';
  const bySection = normalizeReturns(returns);
  const allSections = profile === 'light'
    ? ['jira', 'slack', 'bitbucket', 'gmail', 'fathom']
    : SECTION_ORDER;

  const inbox = profile === 'light'
    ? buildLightInbox(runplan, bySection)
    : buildRadarInbox(bySection, runplan);

  const out = [];

  if (profile === 'light') {
    out.push(`## Work Radar — ${runplan.today}, ${runplan.day_of_week}`);
    const cacheNote = runplan.cache_exists
      ? 'live Jira/Slack/Bitbucket · Gmail/Fathom/Week Ahead from cache'
      : 'live Jira/Slack/Bitbucket · cache empty for Gmail/Fathom/Week Ahead';
    out.push(`Quick check · ${cacheNote}`);
  } else {
    out.push(`## Work Radar — ${runplan.today}, ${runplan.day_of_week}`);
    if (runplan.fast_exit) {
      const mins = runplan.minutes_since_last_run;
      out.push(`⏱️ Re-run · ${mins} min ago · Jira/Gmail/Fathom from cache; Slack/Bitbucket live`);
    } else {
      const sinceIso = runplan.since?.jira?.iso || runplan.since?.slack?.iso || '';
      const ww = runplan.work_week_label ? ` · Work week: ${runplan.work_week_label}` : '';
      out.push(`Scanning since ${sinceIso}${ww}`);
    }
  }
  out.push('');

  if (inbox.length === 0) {
    out.push(profile === 'light' ? '### ✅ Nothing urgent' : '### ✅ All clear');
    out.push(profile === 'light'
      ? 'No flagged items from live checks or cache.'
      : 'No items need attention.');
  } else {
    const heading = profile === 'light' ? '### 🔴 Needs attention' : '### 🔴 Needs you';
    out.push(`${heading} (${inbox.length})`);
    for (const it of inbox) {
      const tag = SECTION_LABELS[it.source] || it.source;
      const origin = it.origin === 'cache' ? ' (cache)' : ' (live)';
      const body = it.line.replace(/^[🔴🟡⚠️]\s*/, '');
      out.push(`- ${it.emoji} [${tag}] ${body}${origin}`);
    }
  }
  out.push('');
  out.push(`Sources: ${buildRollup(allSections, bySection, runplan, profile)}`);
  out.push('');

  const detailSections = profile === 'light'
    ? (runplan.sections || ['jira', 'slack', 'bitbucket'])
    : allSections;
  const detailLines = [];
  for (const section of detailSections) {
    const status = sectionStatus(section, bySection, runplan, profile);
    if (status === '✅' || status === '—') continue;
    detailLines.push(...buildSectionDetail(section, bySection, inbox));
    if (detailLines.length) detailLines.push('');
  }
  if (profile === 'light') {
    const cached = buildCachedDetail(runplan, inbox);
    if (cached.length) {
      detailLines.push(...cached, '');
    }
  }
  if (detailLines.length) {
    out.push(...detailLines.slice(0, -1));
    out.push('');
  }

  const weekAheadFull = bySection.week_ahead?.week_ahead_render || runplan.week_ahead_render;
  if (profile === 'radar' && weekAheadFull) {
    out.push('---');
    out.push(runplan.fast_exit ? '### Week Ahead *(cached)*' : '### Week Ahead');
    out.push(weekAheadFull.replace(/^### Week Ahead\s*\n?/, ''));
    out.push('');
  } else if (profile === 'light') {
    const digest = digestWeekAheadUrgent(runplan.week_ahead_render);
    if (digest.length) {
      out.push('---');
      out.push('### Week Ahead *(urgent only)*');
      out.push(...digest);
      out.push('');
    }
  }

  if (profile === 'light' && !runplan.cache_exists && inbox.length === 0) {
    out.push('Note: Gmail, Fathom, and Week Ahead need a full radar run first.');
    out.push('');
  }

  out.push('---');
  const stub = buildStubLine(inbox);
  if (stub) out.push(stub);
  out.push(buildAnchor(profile, inbox, bySection, runplan));

  return out.join('\n');
}
