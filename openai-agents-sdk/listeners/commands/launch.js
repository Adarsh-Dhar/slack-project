// listeners/commands/launch.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { config } from '../../config.js';
import { parseLaunchCommand } from '../../utils/parseCommand.js';
import { resolvePlainMentions, resolvePlainChannelMentions } from '../../utils/resolveMentions.js';
import { createLaunchChannels, buildChannelSummaryMessage } from '../../services/channelManager.js';
import { DEFAULT_CHECKLIST } from '../../services/canvasBuilder.js';
import { notifyItemOwner } from '../../services/ownership.js';
import { addDays, format } from 'date-fns';

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
      const { featureName, launchDate, tier, githubRepo, mentionedUsers, mentionedChannels } =
        parseLaunchCommand(command.text);

      console.log('[DEBUG] raw command.text:', JSON.stringify(command.text));
      console.log('[DEBUG] mentionedUsers parsed:', mentionedUsers);

      // Catch any plain @username that wasn't auto-converted to <@U...>
      const fallbackUserIds = await resolvePlainMentions(client, command.text, mentionedUsers);
      const allMentionedUsers = [...mentionedUsers, ...fallbackUserIds];

      // Same problem as plain @usernames, but for #channel-name: catch
      // channels typed without using Slack's autocomplete dropdown.
      const fallbackChannelIds = await resolvePlainChannelMentions(client, command.text, mentionedChannels);
      const allMentionedChannels = [...mentionedChannels, ...fallbackChannelIds];

      // 2–4. Create main + sub-channels based on tier
      const allUsers = [...new Set([pmUserId, ...allMentionedUsers])];

      const { mainChannelId, subChannels } = await createLaunchChannels(
        client,
        featureName,
        tier,
        allUsers
      );
      const launchChannelId = mainChannelId;

      // 5. Resolve + join mentioned stakeholder channels *before* building
      // the welcome message, so it can actually list them. Moved up from
      // its old spot after DB save (was step 7).
      const linkedChannels = [];
      for (const chanId of allMentionedChannels) {
        const info = await client.conversations.info({ channel: chanId }).catch(() => null);
        const chanName = info?.channel?.name ?? chanId;
        const team = inferTeam(chanName);
        const joinResult = await client.conversations.join({ channel: chanId }).catch(err => {
          const reason = err?.data?.error;
          console.warn(`[/launch] Could not auto-join #${chanName}: ${reason || err.message}` +
            (reason === 'method_not_supported_for_channel_type' || reason === 'channel_not_found'
              ? ' (likely private — ask a member to /invite @LaunchBot instead)'
              : ''));
          return null;
        });
        // Only list it as "linked" if the join actually succeeded (or the
        // bot was already in it) — don't claim success on a silent failure.
        if (joinResult !== null) {
          linkedChannels.push({ channelId: chanId, team, name: chanName });
        }
      }

      // 6. Welcome message — now includes linked stakeholder channels
      const welcomeMsg = buildChannelSummaryMessage(
        featureName, tier, launchChannelId, subChannels, linkedChannels
      );
      await client.chat.postMessage({ channel: launchChannelId, text: welcomeMsg });

      // 7. Save launch to DB
      const launchId = db.createLaunch({
        name: featureName,
        channelId: launchChannelId,
        launchDate,
        pmUserId,
        tier,
        githubRepo,
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

      // 7b. Register the already-joined stakeholder channels in the DB now
      // that launchId exists (join + name/team resolution already happened
      // above in step 5).
      for (const { channelId, team } of linkedChannels) {
        db.addStakeholderChannel({ launchId, channelId, team });
      }

      // 8. Build checklist items
      const launchDateObj = new Date(launchDate);
      for (const [team, defaults] of Object.entries(DEFAULT_CHECKLIST)) {
        for (const item of defaults) {
          const dueDate = format(addDays(launchDateObj, item.dueOffsetDays), 'yyyy-MM-dd');
          db.createItem({ launchId, team, title: item.title, dueDate, status: 'not_started' });
        }
      }

      // 9. Round-robin assign items to mentioned users, DM each owner
      const items = db.getItemsByLaunch(launchId);
      const TEAMS = ['engineering', 'marketing', 'docs', 'legal', 'sales'];
      const teamToUser = {};
      TEAMS.forEach((team, i) => {
        if (allMentionedUsers.length > 0) teamToUser[team] = allMentionedUsers[i % allMentionedUsers.length];
      });
      for (const item of items) {
        const ownerId = teamToUser[item.team];
        if (!ownerId) continue;
        db.updateItemOwner(item.id, ownerId);
        await notifyItemOwner(client, {
          ownerId, itemTitle: item.title, launchName: featureName, launchDate, dueDate: item.due_date,
        });
      }

      await respond({ text: `✅ Launch "${featureName}" created! Check <#${launchChannelId}>` });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/launch] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}
