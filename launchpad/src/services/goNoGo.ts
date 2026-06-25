// src/services/goNoGo.ts
import type { WebClient } from '@slack/web-api';
import * as db from '../db';
import { buildGoNoGoBlocks } from '../utils/blocks';

export async function runGoNoGo(client: WebClient, launchId: number): Promise<void> {
  const launch = db.getLaunchById(launchId);
  if (!launch) return;

  const items = db.getItemsByLaunch(launchId);
  const completedCount = items.filter(i => i.status === 'done').length;
  const totalCount = items.length;
  const outstanding = items.filter(i => i.status !== 'done');

  // DM each owner with outstanding items
  const ownerIds = [...new Set(outstanding.filter(i => i.owner_id).map(i => i.owner_id!))];
  for (const ownerId of ownerIds) {
    const theirItems = outstanding.filter(i => i.owner_id === ownerId);
    await client.chat.postMessage({
      channel: ownerId,
      text:
        `⏰ *Go/No-Go in 48 hours* for *${launch.name}*.\n\n` +
        `You have ${theirItems.length} outstanding item(s):\n` +
        theirItems.map(i => `• ${i.title}`).join('\n'),
    });
  }

  const blocks = buildGoNoGoBlocks({ launch, items, completedCount, totalCount });
  await client.chat.postMessage({
    channel: launch.channel_id,
    text: `🚦 Go/No-Go — ${completedCount}/${totalCount} items complete`,
    blocks,
  });
}
