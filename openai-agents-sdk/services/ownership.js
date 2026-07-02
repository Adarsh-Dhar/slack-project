// services/ownership.js
// @ts-nocheck

import * as db from '../db/index.js';

export async function notifyItemOwner(client, input) {
  const { ownerId, itemTitle, launchName, launchDate, dueDate } = input;
  const due = dueDate ? ` by *${dueDate}*` : '';
  await client.chat.postMessage({
    channel: ownerId,
    text:
      `👋 You've been assigned a launch item for *${launchName}* (${launchDate}):\n\n` +
      `> *${itemTitle}*${due}\n\n` +
      `Check the launch channel for the full readiness canvas.`,
  });
}

export async function postOwnershipSummary(client, launchChannelId, items) {
  const byOwner = new Map();

  for (const item of items) {
    if (!item.owner_id) continue;
    const existing = byOwner.get(item.owner_id) ?? [];
    byOwner.set(item.owner_id, [...existing, item.title]);
  }

  if (byOwner.size === 0) return;

  const lines = [...byOwner.entries()].map(
    ([userId, titles]) => `<@${userId}> owns: ${titles.join(' · ')}`
  );

  await client.chat.postMessage({
    channel: launchChannelId,
    text: `📋 *Ownership assignments:*\n\n${lines.join('\n')}`,
  });
}

/**
 * Immediately DM an item owner as a targeted nudge (not the 24h SLA batch).
 */
export async function nudgeOwnerNow(client, { item, launch }) {
  await client.chat.postMessage({
    channel: item.owner_id,
    text: `👋 Nudge from <@${launch.pm_user_id}>: *${item.title}* for *${launch.name}* still needs an update.`,
  });
  db.markItemNotified(item.id);
}

/**
 * Post an immediate escalation to the launch channel tagging the PM.
 */
export async function escalateItemNow(client, { item, launch, escalatedBy }) {
  await client.chat.postMessage({
    channel: launch.channel_id,
    text: `🔁 <@${launch.pm_user_id}> — escalated by <@${escalatedBy}>: <@${item.owner_id}> hasn't completed *${item.title}*.`,
  });
}
