// src/handlers/launch.ts
import type { App } from '@slack/bolt';
import { addDays, format } from 'date-fns';
import * as db from '../db';
import { parseLaunchCommand } from '../utils/parseCommand';
import { scanAllStakeholderChannels } from '../services/channelScanner';
import { createLaunchCanvas, DEFAULT_CHECKLIST } from '../services/canvasBuilder';
import { notifyItemOwner, postOwnershipSummary } from '../services/ownership';
import type { TeamName } from '../types';

export function registerLaunchCommand(app: App): void {
  app.command('/launch', async ({ command, ack, client, respond }) => {
    await ack(); // Must ack within 3 seconds

    const pmUserId = command.user_id;

    try {
      // 1. Parse command text
      const { featureName, launchDate, mentionedUsers, mentionedChannels } =
        parseLaunchCommand(command.text);

      // 2. Create launch channel
      const channelName = `launch-${featureName
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 75)}`;

      const channelResult = await client.conversations.create({ name: channelName });
      const launchChannelId = channelResult.channel?.id;
      if (!launchChannelId) throw new Error('Failed to create launch channel');

      // 3. Invite users
      const allUsers = [...new Set([pmUserId, ...mentionedUsers])];
      await client.conversations.invite({
        channel: launchChannelId,
        users: allUsers.join(','),
      });

      // 4. Set topic
      await client.conversations.setTopic({
        channel: launchChannelId,
        topic: `🚀 ${featureName} — Launch: ${launchDate} | Managed by LaunchPad`,
      });

      // 5. Welcome message
      await client.chat.postMessage({
        channel: launchChannelId,
        text: `👋 Welcome to *${featureName}* launch coordination!\n\nLaunchPad is scanning stakeholder channels and building the readiness canvas. Stand by...`,
      });

      // 6. Save launch to DB
      const launchId = db.createLaunch({
        name: featureName,
        channelId: launchChannelId,
        launchDate,
        pmUserId,
      });

      // 7. Register stakeholder channels
      for (const chanId of mentionedChannels) {
        const info = await client.conversations.info({ channel: chanId });
        const chanName = (info.channel as { name?: string })?.name ?? '';
        const team = inferTeam(chanName);
        db.addStakeholderChannel({ launchId, channelId: chanId, team });
        // Join the channel so the bot can read messages
        await client.conversations.join({ channel: chanId }).catch(() => undefined);
      }

      // 8. Scan stakeholder channels
      const stakeholderChannels = db.getStakeholderChannels(launchId);
      const scanResults = await scanAllStakeholderChannels(client, stakeholderChannels, featureName);

      // 9. Build checklist items in DB
      const launchDateObj = new Date(launchDate);

      for (const [team, defaults] of Object.entries(DEFAULT_CHECKLIST) as [TeamName, typeof DEFAULT_CHECKLIST[TeamName]][]) {
        const scan = scanResults[team];
        for (const item of defaults) {
          const dueDate = format(addDays(launchDateObj, item.dueOffsetDays), 'yyyy-MM-dd');
          const status = scan?.hasCompletion ? 'in_progress' : 'not_started';
          db.createItem({ launchId, team, title: item.title, dueDate, status });
        }
      }

      // 10. Assign items to mentioned users
      const items = db.getItemsByLaunch(launchId);
      const TEAMS: TeamName[] = ['engineering', 'marketing', 'docs', 'legal', 'sales'];

      const teamToUser: Partial<Record<TeamName, string>> = {};
      TEAMS.forEach((team, i) => {
        if (mentionedUsers.length > 0) {
          teamToUser[team] = mentionedUsers[i % mentionedUsers.length];
        }
      });

      for (const item of items) {
        const ownerId = teamToUser[item.team];
        if (!ownerId) continue;

        db.updateItemOwner(item.id, ownerId);
        await notifyItemOwner(client, {
          ownerId,
          itemTitle: item.title,
          launchName: featureName,
          launchDate,
          dueDate: item.due_date,
        });
      }

      // 11. Create the canvas
      const freshLaunch = db.getLaunchById(launchId)!;
      const freshItems = db.getItemsByLaunch(launchId);
      const canvasId = await createLaunchCanvas(client, freshLaunch, freshItems);
      db.updateLaunchCanvas(launchId, canvasId);

      // 12. Post ownership summary
      await postOwnershipSummary(client, launchChannelId, freshItems);

      await client.chat.postMessage({
        channel: launchChannelId,
        text: `✅ Launch readiness canvas is ready! I'll send daily check-ins to each owner and alert this channel if any slips are detected.`,
      });

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/launch] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}

function inferTeam(channelName: string): TeamName {
  const name = channelName.toLowerCase();
  if (name.includes('eng') || name.includes('dev')) return 'engineering';
  if (name.includes('market')) return 'marketing';
  if (name.includes('doc')) return 'docs';
  if (name.includes('legal') || name.includes('compliance')) return 'legal';
  if (name.includes('sales') || name.includes('revenue')) return 'sales';
  return 'other';
}
