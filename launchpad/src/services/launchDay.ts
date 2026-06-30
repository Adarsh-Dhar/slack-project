// src/services/launchDay.ts
import type { WebClient } from '@slack/web-api';
import * as db from '../db';

export async function executeLaunch(
  client: WebClient,
  launchId: number,
  announcementChannels: string[] = []
): Promise<void> {
  const launch = db.getLaunchById(launchId);
  if (!launch) return;

  const items = db.getItemsByLaunch(launchId);
  const completedCount = items.filter(i => i.status === 'done').length;

  // 1. Post to announcement channels
  for (const channelId of announcementChannels) {
    await client.chat.postMessage({
      channel: channelId,
      text: `🚀 *${launch.name} is live!*\n\nLaunched on ${launch.launch_date}.`,
    });
  }

  // 2. Post summary to launch channel
  const allOwners = [
    ...new Set(items.filter(i => i.owner_id).map(i => `<@${i.owner_id}>`)),
  ];

  await client.chat.postMessage({
    channel: launch.channel_id,
    text:
      `🎉 *${launch.name} has launched!*\n\n` +
      `${completedCount}/${items.length} items completed.\n\n` +
      `Thanks to everyone involved: ${allOwners.join(', ')}`,
  });

  // 3. Update DB
  db.updateLaunchStatus(launchId, 'launched');
  // NOTE: channel archiving now happens after the retro (see retro.ts),
  // not immediately at launch. This keeps the channel open for monitoring
  // and post-launch coordination during the first week.
}
