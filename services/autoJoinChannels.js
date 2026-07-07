import { classifyChannel } from './channelClassification.js';
import { config } from '../config.js';

/**
 * Auto-join public channels that match signal source keywords
 * @param {import('@slack/web-api').WebClient} client
 * @param {string[]} denylist - Channel IDs or names to skip
 * @returns {Promise<{joined: number, channels: Array<{id: string, name: string, type: string}>}>}
 */
export async function autoJoinSignalChannels(client, denylist = []) {
  console.log('[auto-join] Starting channel discovery...');
  
  const denylistSet = new Set(denylist.map(d => d.toLowerCase()));
  const joined = [];
  
  try {
    // Fetch all public channels the bot can see
    // For enterprise installs, we need to pass the workspace team_id (not enterprise_id)
    const teamId = config.SLACK_TEAM_ID || (await client.auth.test()).team_id;
    const result = await client.conversations.list({
      types: 'public_channel',
      limit: 1000,
      team_id: teamId,
    });
    
    if (!result.channels) {
      console.log('[auto-join] No channels found or API error');
      return { joined: 0, channels: [] };
    }
    
    console.log(`[auto-join] Found ${result.channels.length} public channels`);
    
    for (const channel of result.channels) {
      // Skip if on denylist
      if (denylistSet.has(channel.id) || denylistSet.has(channel.name?.toLowerCase())) {
        console.log(`[auto-join] Skipping denied channel: #${channel.name}`);
        continue;
      }
      
      // Skip if already a member
      if (channel.is_member) {
        console.log(`[auto-join] Already member of: #${channel.name}`);
        continue;
      }
      
      // Classify channel
      const sourceType = classifyChannel(channel.name || '');
      if (!sourceType) {
        console.log(`[auto-join] No match for: #${channel.name}`);
        continue;
      }
      
      // Join the channel
      try {
        await client.conversations.join({ channel: channel.id });
        console.log(`[auto-join] Joined #${channel.name} (${channel.id}) as "${sourceType}"`);
        joined.push({ id: channel.id, name: channel.name, type: sourceType });
      } catch (err) {
        console.error(`[auto-join] Failed to join #${channel.name}:`, err.message);
      }
    }
    
    console.log(`[auto-join] Done — joined ${joined.length} new channel(s).`);
    return { joined: joined.length, channels: joined };
  } catch (err) {
    console.error('[auto-join] Error during channel discovery:', err.message);
    return { joined: 0, channels: [] };
  }
}
