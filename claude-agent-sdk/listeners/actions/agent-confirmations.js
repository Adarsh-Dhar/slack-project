// listeners/actions/agent-confirmations.js
//
// Handle confirmation buttons posted by agent tools for launch management actions.
// @ts-nocheck

import * as db from '../../db/index.js';
import { createLaunchChannels, buildChannelSummaryMessage } from '../../services/channelManager.js';
import { config } from '../../config.js';
import { resolvePlainMentions } from '../../utils/resolveMentions.js';
import { syncMembersForPhaseChange, announcePhaseChange } from '../../services/phaseManager.js';
import { postRetroPrompt } from '../../services/retro.js';

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
  // Handle create_launch_confirm button click
  app.action('create_launch_confirm', async ({ ack, body, client, respond }) => {
    await ack();

    try {
      const data = JSON.parse(body.actions[0].value);
      const { feature_name, launch_date, tier, requester } = data;

      const pmUserId = requester;
      const channelId = body.channel.id;

      // Create channels
      const allUsers = [pmUserId];
      const { mainChannelId, subChannels } = await createLaunchChannels(
        client,
        feature_name,
        tier,
        allUsers
      );

      // Welcome message
      const welcomeMsg = buildChannelSummaryMessage(
        feature_name, tier, mainChannelId, subChannels
      );
      await client.chat.postMessage({ channel: mainChannelId, text: welcomeMsg });

      // Save to DB
      const launchId = db.createLaunch({
        name: feature_name,
        channelId: mainChannelId,
        launchDate: launch_date,
        pmUserId,
        tier,
      });

      // Register sub-channels
      for (const { channelId: subId, sub } of subChannels) {
        db.addStakeholderChannel({ launchId, channelId: subId, team: sub.team });
      }

      // Register team rosters
      const teamsInTier = [...new Set(subChannels.map(s => s.sub.team))];
      for (const team of teamsInTier) {
        const usergroupId = config.TEAM_USERGROUP_MAP[team] || null;
        db.setTeamRoster(launchId, team, usergroupId, []);
      }

      await respond({ text: `✅ Launch "${feature_name}" created! Check <#${mainChannelId}>` });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[create_launch_confirm] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });

  // Handle trigger_retro_confirm button click
  app.action('trigger_retro_confirm', async ({ ack, body, client, respond }) => {
    await ack();

    try {
      const launchId = parseInt(body.actions[0].value, 10);
      const launch = db.getLaunchById(launchId);

      if (!launch) {
        await respond({ text: '❌ Launch not found.' });
        return;
      }

      await postRetroPrompt(client, launch);
      await respond({ text: '✅ Retro prompt posted! Click "Start Retro" to begin.' });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[trigger_retro_confirm] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });

  // Handle sync_phase_confirm button click
  app.action('sync_phase_confirm', async ({ ack, body, client, respond }) => {
    await ack();

    try {
      const data = JSON.parse(body.actions[0].value);
      const { launch_id, new_phase } = data;

      const launch = db.getLaunchById(launch_id);
      if (!launch) {
        await respond({ text: '❌ Launch not found.' });
        return;
      }

      const oldPhase = launch.current_phase;
      const { added, removed } = await syncMembersForPhaseChange(
        client, launch, oldPhase, new_phase
      );

      db.updateLaunchPhase(launch_id, new_phase);
      await announcePhaseChange(client, launch, new_phase, added, removed);

      await respond({
        text: `✅ Phase updated from ${oldPhase} to ${new_phase}`,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[sync_phase_confirm] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}
