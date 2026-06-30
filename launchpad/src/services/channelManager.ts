// src/services/channelManager.ts
//
// Responsible for creating all channels (main + sub) for a launch.

import type { WebClient } from '@slack/web-api';
import { config } from '../config';
import type { LaunchTier, SubChannel } from '../types';

export interface CreatedChannels {
  mainChannelId: string;
  subChannels: Array<{ channelId: string; sub: SubChannel }>;
}

/**
 * Slugify a feature name for use in a Slack channel name.
 * Slack channel names: lowercase, max 80 chars, only a-z 0-9 hyphens.
 */
function slugify(name: string): string {
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
async function createChannel(
  client: WebClient,
  name: string,
  purpose: string
): Promise<string | null> {
  try {
    const result = await client.conversations.create({ name });
    const channelId = result.channel?.id;
    if (!channelId) return null;

    // Set purpose (non-fatal if it fails)
    await client.conversations.setPurpose({ channel: channelId, purpose }).catch(() => undefined);

    return channelId;
  } catch (err: unknown) {
    const slackErr = err as { data?: { error?: string } };
    // 'name_taken' means the channel already exists — surface clearly
    if (slackErr.data?.error === 'name_taken') {
      console.warn(`[channelManager] Channel #${name} already exists, skipping creation.`);
      return null;
    }
    throw err;
  }
}

/**
 * Invite a list of users to a channel (best-effort — skips invalid IDs).
 */
async function inviteUsers(
  client: WebClient,
  channelId: string,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) return;
  await client.conversations
    .invite({ channel: channelId, users: userIds.join(',') })
    .catch((err: unknown) => {
      const slackErr = err as { data?: { error?: string } };
      // 'already_in_channel' is fine; other errors should surface
      if (slackErr.data?.error !== 'already_in_channel') {
        console.error('[channelManager] invite error:', slackErr.data?.error);
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
 * (launch.ts) after the launch row is created with the real launchId.
 */
export async function createLaunchChannels(
  client: WebClient,
  featureName: string,
  tier: LaunchTier,
  initialUserIds: string[]   // PM + any @mentioned users
): Promise<CreatedChannels> {
  const slug = slugify(featureName);
  const subChannelDefs: SubChannel[] = config.TIER_CHANNELS[tier];

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
    topic: `🚀 ${featureName} — Launch: TBD | Managed by LaunchPad | Tier: ${tier.toUpperCase()}`,
  });

  await inviteUsers(client, mainChannelId, initialUserIds);

  // ── 2. Sub-channels based on tier ─────────────────────────────────────────
  const created: Array<{ channelId: string; sub: SubChannel }> = [];

  for (const sub of subChannelDefs) {
    const subName = `${slug}-${sub.suffix}`;
    const subChannelId = await createChannel(client, subName, sub.purpose);

    if (!subChannelId) {
      // Log and continue — don't fail the whole launch for one sub-channel
      console.warn(`[channelManager] Skipped sub-channel #${subName}`);
      continue;
    }

    // Invite PM (first user) to all sub-channels so they have visibility
    const pmId = initialUserIds[0];
    if (pmId) await inviteUsers(client, subChannelId, [pmId]);

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
 */
export function buildChannelSummaryMessage(
  featureName: string,
  tier: LaunchTier,
  mainChannelId: string,
  subChannels: Array<{ channelId: string; sub: SubChannel }>
): string {
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

  msg += `\nLaunchPad is scanning stakeholder channels and building the readiness canvas. Stand by...`;
  return msg;
}
