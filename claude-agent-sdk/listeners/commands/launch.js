// listeners/commands/launch.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { config } from '../../config.js';
import { parseLaunchCommand } from '../../utils/parseCommand.js';
import { resolvePlainMentions } from '../../utils/resolveMentions.js';
import { createLaunchChannels, buildChannelSummaryMessage } from '../../services/channelManager.js';

function inferTeam(channelName) {
  const name = channelName.toLowerCase();
  if (name.includes('eng') || name.includes('dev')) return 'engineering';
  if (name.includes('market')) return 'marketing';
  if (name.includes('doc')) return 'docs';
  if (name.includes('legal') || name.includes('compliance')) return 'legal';
  if (name.includes('sales') || name.includes('revenue')) return 'sales';
  return 'other';
}

export function register(app) {
  app.command('/launch', async ({ command, ack, client, respond }) => {
    await ack(); // Must ack within 3 seconds

    const pmUserId = command.user_id;

    try {
      // 1. Parse command text
      const { featureName, launchDate, tier, mentionedUsers, mentionedChannels } =
        parseLaunchCommand(command.text);

      console.log('[DEBUG] raw command.text:', JSON.stringify(command.text));
      console.log('[DEBUG] mentionedUsers parsed:', mentionedUsers);

      // Catch any plain @username that wasn't auto-converted to <@U...>
      const fallbackUserIds = await resolvePlainMentions(client, command.text, mentionedUsers);
      const allMentionedUsers = [...mentionedUsers, ...fallbackUserIds];

      // 2–4. Create main + sub-channels based on tier
      const allUsers = [...new Set([pmUserId, ...allMentionedUsers])];

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

      // 6c. Register team rosters — prefer User Group, fallback to mentioned users
      const teamsInTier = [...new Set(subChannels.map(s => s.sub.team))];
      for (const team of teamsInTier) {
        const usergroupId = config.TEAM_USERGROUP_MAP[team] || null;
        db.setTeamRoster(launchId, team, usergroupId, allMentionedUsers);
      }

      // 7. Register stakeholder channels from mentions
      for (const chanId of mentionedChannels) {
        const info = await client.conversations.info({ channel: chanId });
        const chanName = info.channel?.name ?? '';
        const team = inferTeam(chanName);
        db.addStakeholderChannel({ launchId, channelId: chanId, team });
        // Join the channel so the bot can read messages
        await client.conversations.join({ channel: chanId }).catch(() => undefined);
      }

      await respond({ text: `✅ Launch "${featureName}" created! Check <#${launchChannelId}>` });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/launch] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}
