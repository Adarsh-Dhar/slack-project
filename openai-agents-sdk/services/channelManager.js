// services/channelManager.js
//
// Responsible for creating all channels (main + sub) for a launch.
// @ts-nocheck

import { config } from '../config.js';

/**
 * Slugify a feature name for use in a Slack channel name.
 * Slack channel names: lowercase, max 80 chars, only a-z 0-9 hyphens.
 */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60); // leave room for suffixes like '-legal-review'
}

/**
 * Create a single Slack channel and set its purpose.
 * Returns the channel ID, or null if creation fails (e.g. name conflict).
 */
async function createChannel(client, name, purpose) {
  try {
    const result = await client.conversations.create({ name });
    const channelId = result.channel?.id;
    if (!channelId) return null;

    // Set purpose (non-fatal if it fails)
    await client.conversations.setPurpose({ channel: channelId, purpose }).catch(() => undefined);

    return channelId;
  } catch (err) {
    const slackErr = err?.data;
    // 'name_taken' means the channel already exists — surface clearly
    if (slackErr?.error === 'name_taken') {
      console.warn(`[channelManager] Channel #${name} already exists, skipping creation.`);
      return null;
    }
    throw err;
  }
}

/**
 * Invite a list of users to a channel (best-effort — skips invalid IDs).
 */
async function inviteUsers(client, channelId, userIds) {
  if (userIds.length === 0) return;
  await client.conversations
    .invite({ channel: channelId, users: userIds.join(',') })
    .catch((err) => {
      const slackErr = err?.data;
      // 'already_in_channel' is fine; other errors should surface
      if (slackErr?.error !== 'already_in_channel') {
        console.error('[channelManager] invite error:', slackErr?.error);
      }
    });
}

/**
 * Main entry point.
 *
 * Creates:
 *   - #launch-{slug}           (always — the coordination hub)
 *   - #{slug}-eng              (major + moderate)
 *   - #{slug}-mktg             (major + moderate)
 *   - #{slug}-docs             (major + moderate)
 *   - #{slug}-legal-review     (major only)
 *   - #{slug}-cs-readiness     (major only)
 *
 * Note: DB registration of stakeholder channels is handled by the caller
 * after the launch row is created with the real launchId.
 */
export async function createLaunchChannels(client, featureName, tier, initialUserIds) {
  const slug = slugify(featureName);
  const subChannelDefs = config.TIER_CHANNELS[tier];

  // ── 1. Main launch channel ─────────────────────────────────────────────────
  const mainName = `launch-${slug}`;
  const mainChannelId = await createChannel(
    client,
    mainName,
    `🚀 ${featureName} — launch coordination hub`
  );

  if (!mainChannelId) {
    throw new Error(
      `Could not create main channel #${mainName}. It may already exist. ` +
      `Please rename your feature or archive the existing channel.`
    );
  }

  await client.conversations.setTopic({
    channel: mainChannelId,
    topic: `🚀 ${featureName} — Launch: TBD | Managed by LaunchBot | Tier: ${tier.toUpperCase()}`,
  });

  await inviteUsers(client, mainChannelId, initialUserIds);

  // ── 2. Sub-channels based on tier ─────────────────────────────────────────
  const created = [];

  for (const sub of subChannelDefs) {
    const subName = `${slug}-${sub.suffix}`;
    const subChannelId = await createChannel(client, subName, sub.purpose);

    if (!subChannelId) {
      // Log and continue — don't fail the whole launch for one sub-channel
      console.warn(`[channelManager] Skipped sub-channel #${subName}`);
      continue;
    }

    // Invite everyone mentioned on /launch to every sub-channel at creation
    // time, not just the PM. This is intentionally broad (no per-team
    // filtering) because /launch's mention syntax doesn't currently carry
    // team assignment — see the note below on tightening this later.
    await inviteUsers(client, subChannelId, initialUserIds);

    // Bot joins so it can read messages for slip detection
    await client.conversations.join({ channel: subChannelId }).catch(() => undefined);

    created.push({ channelId: subChannelId, sub });

    // Rate-limit courtesy delay
    await new Promise(r => setTimeout(r, 300));
  }

  return { mainChannelId, subChannels: created };
}

/**
 * Build a human-readable summary of all channels created.
 * Posted as the welcome message in the main launch channel.
 *
 * @param {Array<{channelId: string, team: string, name: string}>} linkedChannels
 *   Stakeholder channels resolved from # mentions in /launch (not created
 *   by the bot — pre-existing channels it joined to track for this launch).
 */
export function buildChannelSummaryMessage(featureName, tier, mainChannelId, subChannels, linkedChannels = []) {
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);

  let msg = `👋 *${featureName}* launch workspace is ready! _(${tierLabel} tier)_\n\n`;
  msg += `*Channels created:*\n`;
  msg += `• <#${mainChannelId}> — coordination hub (you're here)\n`;

  for (const { channelId, sub } of subChannels) {
    msg += `• <#${channelId}> — ${sub.purpose}\n`;
  }

  if (subChannels.length === 0) {
    msg += `_Minor tier: no sub-channels created. All coordination happens here._\n`;
  }

  if (linkedChannels.length > 0) {
    msg += `\n*Existing channels linked to this launch:*\n`;
    for (const { channelId, team } of linkedChannels) {
      msg += `• <#${channelId}> _(tracked as ${team})_\n`;
    }
  }

  msg += `\nLaunchBot is ready to manage your launch workflow. Use /launch-phase to manually advance phases.`;
  return msg;
}
