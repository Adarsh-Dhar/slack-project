// src/services/ownership.ts
import type { WebClient } from '@slack/web-api';
import type { ItemRow } from '../types';

interface NotifyOwnerInput {
  ownerId: string;
  itemTitle: string;
  launchName: string;
  launchDate: string;
  dueDate: string | null;
}

export async function notifyItemOwner(
  client: WebClient,
  input: NotifyOwnerInput
): Promise<void> {
  const due = input.dueDate ? ` by *${input.dueDate}*` : '';
  await client.chat.postMessage({
    channel: input.ownerId,
    text:
      `👋 You've been assigned a launch item for *${input.launchName}* (${input.launchDate}):\n\n` +
      `> *${input.itemTitle}*${due}\n\n` +
      `Check the launch channel for the full readiness canvas.`,
  });
}

export async function postOwnershipSummary(
  client: WebClient,
  launchChannelId: string,
  items: ItemRow[]
): Promise<void> {
  const byOwner = new Map<string, string[]>();

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
