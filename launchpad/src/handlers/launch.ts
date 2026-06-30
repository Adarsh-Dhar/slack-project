// src/handlers/launch.ts
import type { App } from '@slack/bolt';
import { addDays, format } from 'date-fns';
import * as db from '../db';
import { parseLaunchCommand } from '../utils/parseCommand';
import { scanAllStakeholderChannels } from '../services/channelScanner';
import { createLaunchCanvas, DEFAULT_CHECKLIST } from '../services/canvasBuilder';
import { notifyItemOwner, postOwnershipSummary } from '../services/ownership';
import { createLaunchChannels, buildChannelSummaryMessage } from '../services/channelManager';
import type { TeamName } from '../types';

export function registerLaunchCommand(app: App): void {
  app.command('/launch', async ({ command, ack, client, respond }) => {
    await ack(); // Must ack within 3 seconds

    const pmUserId = command.user_id;

    try {
      // 1. Parse command text
      const { featureName, launchDate, tier, mentionedUsers, mentionedChannels } =
        parseLaunchCommand(command.text);

      // 2–4. Create main + sub-channels based on tier
      const allUsers = [...new Set([pmUserId, ...mentionedUsers])];

      const { mainChannelId, subChannels } = await createLaunchChannels(
        client,
        featureName,
        tier,
        allUsers
      );
      const launchChannelId = mainChannelId;

      // 5. Welcome message
      const welcomeMsg = buildChannelSummaryMessage(
        featureName, tier, launchChannelId, subChannels
      );
      await client.chat.postMessage({ channel: launchChannelId, text: welcomeMsg });

      // 6. Save launch to DB
      const launchId = db.createLaunch({
        name: featureName,
        channelId: launchChannelId,
        launchDate,
        pmUserId,
        tier,
      });

      // 6b. Now register sub-channels with the real launchId
      for (const { channelId, sub } of subChannels) {
        db.addStakeholderChannel({ launchId, channelId, team: sub.team });
      }

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
