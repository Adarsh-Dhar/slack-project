// services/ownership.js
// @ts-nocheck

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
