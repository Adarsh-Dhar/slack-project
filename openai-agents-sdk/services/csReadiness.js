// services/csReadiness.js
// @ts-nocheck

import * as db from '../db/index.js';

export function setCsReadinessItem({ launchId, item, link, status, updatedBy }) {
  db.upsertCsReadinessItem({ launchId, item, link, status, updatedBy });
}

export function buildCsReadinessBlocks(launchId, launchName) {
  const items = db.getCsReadinessForLaunch(launchId);
  if (items.length === 0) {
    return [{
      type: 'section',
      text: { type: 'mrkdwn', text: `No CS readiness items tracked for *${launchName}* yet.` },
    }];
  }
  const emoji = { not_started: '⚪', in_progress: '🟡', done: '🟢' };
  const lines = items
    .map(i => `${emoji[i.status] ?? '⚪'} *${i.item}*${i.link ? ` — <${i.link}|link>` : ''}`)
    .join('\n');
  return [{ type: 'section', text: { type: 'mrkdwn', text: `*CS Readiness — ${launchName}*\n${lines}` } }];
}
