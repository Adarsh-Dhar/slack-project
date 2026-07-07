// services/risk.js
// @ts-nocheck

import * as db from '../db/index.js';

export function setRiskItem({ launchId, category, level, note, updatedBy }) {
  db.upsertRiskItem({ launchId, category, level, note, updatedBy });
}

export function buildRiskBlocks(launchId, launchName) {
  const items = db.getRiskItemsForLaunch(launchId);
  if (items.length === 0) {
    return [{ type: 'section', text: { type: 'mrkdwn', text: `No risks logged for *${launchName}* yet.` } }];
  }
  const emoji = { low: '🟢', medium: '🟡', high: '🔴' };
  const lines = items
    .map(r => `${emoji[r.level] ?? '⚪'} *${r.category}:* ${r.note ?? '(no note)'}`)
    .join('\n');
  return [{ type: 'section', text: { type: 'mrkdwn', text: `*Risk assessment — ${launchName}*\n${lines}` } }];
}
