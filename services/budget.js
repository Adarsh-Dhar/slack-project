// services/budget.js
// @ts-nocheck

import * as db from '../db/index.js';

export function defineBudgetItem({ launchId, category, approvedAmount, approver, updatedBy }) {
  db.upsertBudgetItem({ launchId, category, approvedAmount, approver, updatedBy });
}

export function updateSpend({ launchId, category, spentAmount, updatedBy }) {
  const existing = db.getBudgetForLaunch(launchId).find(b => b.category === category);
  if (!existing) {
    throw new Error(`No budget category "${category}" on this launch yet. Define it first.`);
  }
  db.recordSpend({ launchId, category, spentAmount, updatedBy });
}

export function buildBudgetListBlocks(launchId, launchName) {
  const items = db.getBudgetForLaunch(launchId);
  if (items.length === 0) {
    return [{
      type: 'section',
      text: { type: 'mrkdwn', text: `No budget items defined for *${launchName}* yet. Add one with the budget tool.` },
    }];
  }
  const lines = items
    .map(b =>
      `• *${b.category}:* ${b.spent_amount ?? '—'} / ${b.approved_amount ?? 'no approved amount'}` +
      (b.approver ? ` (approved by <@${b.approver}>)` : '')
    )
    .join('\n');
  return [{ type: 'section', text: { type: 'mrkdwn', text: `*Budget — ${launchName}*\n${lines}` } }];
}
