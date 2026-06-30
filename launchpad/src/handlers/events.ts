// src/handlers/events.ts
import type { App } from '@slack/bolt';
import type { GenericMessageEvent } from '@slack/types';
import * as db from '../db';
import { checkForSlip } from '../services/slipDetector';

// Cache channel ID → name to avoid repeated API calls (and duplicate-delivery
// from Socket Mode retries when the handler is slow).
const channelNameCache = new Map<string, string>();

async function resolveChannelName(
  client: Parameters<Parameters<App['message']>[0]>['0']['client'],
  channelId: string,
): Promise<string> {
  if (channelNameCache.has(channelId)) {
    return channelNameCache.get(channelId)!;
  }
  try {
    const info = await client.conversations.info({ channel: channelId });
    const name = (info.channel as { name?: string })?.name ?? channelId;
    channelNameCache.set(channelId, name);
    return name;
  } catch {
    channelNameCache.set(channelId, channelId);
    return channelId;
  }
}

export function registerEvents(app: App): void {

  // ─── Message logger: print every user message to the terminal ────────────
  app.message(async ({ message, client }) => {
    if (message.subtype !== undefined) return; // skip edits, joins, bot posts
    const msg = message as GenericMessageEvent;
    if (!msg.user) return;

    const channelName = await resolveChannelName(client, msg.channel);
    const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();

    console.log(`[${timestamp}] #${channelName} | <${msg.user}> ${msg.text ?? '(no text)'}`);
  });

  // ─── Message event: slip detection ──────────────────────────────────────
  app.message(async ({ message, client }) => {
    // Only process plain user messages (no subtypes, no bots)
    if (message.subtype !== undefined) return;
    // After the subtype guard, message is GenericMessageEvent
    const msg = message as GenericMessageEvent;
    if (!msg.user) return;

    const launch = db.getLaunchByStakeholderChannel(msg.channel);
    if (!launch || launch.status !== 'active') return;

    const channelName = await resolveChannelName(client, msg.channel);

    await checkForSlip(client, { message: msg, launch, channelName });
  });

  // ─── Member joined: late-joiner onboarding ───────────────────────────────
  app.event('member_joined_channel', async ({ event, client }) => {
    const { user: userId, channel: channelId } = event;

    const launch = db.getLaunchByChannel(channelId);
    if (!launch) return;

    // Don't DM the bot itself
    const botInfo = await client.auth.test();
    if (userId === botInfo.user_id) return;

    const items = db.getItemsByLaunch(launch.id);
    const completedCount = items.filter(i => i.status === 'done').length;
    const totalCount = items.length;

    await client.chat.postMessage({
      channel: userId,
      text:
        `👋 Welcome to the *${launch.name}* launch!\n\n` +
        `*Launch date:* ${launch.launch_date}\n` +
        `*Progress:* ${completedCount}/${totalCount} items complete\n\n` +
        `Check the canvas in <#${channelId}> for the full readiness snapshot.`,
    });
  });
}
