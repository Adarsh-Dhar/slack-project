// scripts/cleanupChannels.js
//
// Archives specified channels and marks #general clearly as a test environment.
//
// IMPORTANT — read before running:
//   - Slack's bot API can only ARCHIVE channels, not permanently delete them.
//     Archived channels vanish from the sidebar/search and can't be posted
//     in, but a workspace owner can still find & unarchive them later from
//     Settings & administration -> Manage channels. True permanent deletion
//     has to be done by a workspace owner in the Slack UI (or via
//     admin.conversations.delete on Enterprise Grid with an admin token).
//   - This is DESTRUCTIVE. Run with DRY_RUN=true first to see what would happen.
//   - Required bot token scopes: channels:read, channels:manage
//
// Usage:
//   DRY_RUN=true node scripts/cleanupChannels.js                              # discover and preview all channels
//   node scripts/cleanupChannels.js                                           # actually archive all discovered channels
//   CHANNEL_IDS=C0123,C0456 DRY_RUN=true node scripts/cleanupChannels.js      # specific channels only
//
import 'dotenv/config';
import { WebClient } from '@slack/web-api';

// Try Slack CLI token first for broader permissions, fall back to bot token
const client = new WebClient(process.env.SLACK_CLI_TOKEN || process.env.SLACK_BOT_TOKEN);

const DRY_RUN = process.env.DRY_RUN === 'true';
const CHANNEL_IDS = (process.env.CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const TEST_ENV_NOTE = '⚠️ TEST ENVIRONMENT — channels here were bulk-archived by cleanupChannels.js';

// Never touch these even if present (add any channel names/IDs you want to protect)
const PROTECTED = new Set(['general']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discoverAllChannels() {
  const channels = [];
  let cursor;

  console.log('[cleanup] Discovering all channels...');
  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      exclude_archived: true,
      cursor,
    });
    channels.push(...(result.channels ?? []));
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return channels;
}

async function getChannelInfo(channelId) {
  try {
    return await client.conversations.info({ channel: channelId });
  } catch (err) {
    console.error(`[cleanup] Failed to get info for ${channelId}:`, err.data?.error || err.message);
    return null;
  }
}

async function markGeneralAsTestEnv(generalChannel) {
  if (!generalChannel) return;

  console.log(`[cleanup] Flagging #${generalChannel.name} as test environment`);
  if (DRY_RUN) return;

  try {
    await client.conversations.setTopic({
      channel: generalChannel.id,
      topic: TEST_ENV_NOTE,
    });
    await client.conversations.setPurpose({
      channel: generalChannel.id,
      purpose: TEST_ENV_NOTE,
    });
    await client.chat.postMessage({
      channel: generalChannel.id,
      text: TEST_ENV_NOTE,
    });
  } catch (err) {
    console.error(`[cleanup] Failed to flag #${generalChannel.name}:`, err.data?.error || err.message);
  }
}

async function archiveChannel(channel) {
  console.log(`[cleanup] Archiving #${channel.name} (${channel.id})`);
  if (DRY_RUN) return;

  try {
    // Bot must be a member of a channel to archive it (for public channels
    // it doesn't already belong to, join first).
    if (!channel.is_member) {
      await client.conversations.join({ channel: channel.id });
    }
    await client.conversations.archive({ channel: channel.id });
  } catch (err) {
    console.error(`[cleanup] Failed to archive #${channel.name}:`, err.data?.error || err.message);
  }
}

(async () => {
  console.log(`[cleanup] Mode: ${DRY_RUN ? 'DRY RUN (no changes will be made)' : 'LIVE — channels will be archived'}`);

  let channels;
  if (CHANNEL_IDS.length > 0) {
    console.log(`[cleanup] Processing ${CHANNEL_IDS.length} specified channel(s)`);
    channels = [];
    for (const channelId of CHANNEL_IDS) {
      const info = await getChannelInfo(channelId);
      if (info && info.channel) {
        channels.push(info.channel);
      }
    }
  } else {
    channels = await discoverAllChannels();
  }

  console.log(`[cleanup] Found ${channels.length} non-archived channel(s)`);

  const generalChannel = channels.find((c) => c.name === 'general');
  const toArchive = channels.filter((c) => !PROTECTED.has(c.name));

  console.log(`[cleanup] Will archive ${toArchive.length} channel(s), skip ${channels.length - toArchive.length} protected channel(s)`);

  for (const channel of toArchive) {
    await archiveChannel(channel);
    await sleep(1200); // stay well under Slack's tier-2 rate limits
  }

  await markGeneralAsTestEnv(generalChannel);

  console.log('[cleanup] Done.');
  if (DRY_RUN) {
    console.log('[cleanup] This was a dry run — nothing was actually changed. Re-run without DRY_RUN=true to apply.');
  }
})();
