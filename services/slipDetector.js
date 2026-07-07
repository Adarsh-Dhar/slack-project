// services/slipDetector.js
// @ts-nocheck
import { config } from '../config.js';
import * as db from '../db/index.js';
import { buildSlipAlertBlocks } from '../utils/blocks.js';

export async function checkForSlip(client, input) {
  const { message, launch, channelName } = input;
  const text = (message.text ?? '').toLowerCase();

  const triggered = config.SLIP_KEYWORDS.some(kw => text.includes(kw));
  if (!triggered) return false;

  // Ignore bot messages
  if (message.bot_id) return false;

  const slipEventId = db.createSlipEvent({
    launchId: launch.id,
    channelId: message.channel,
    detectedUserId: message.user,
    messageText: message.text ?? '',
  });

  const blocks = buildSlipAlertBlocks({
    slipEventId,
    detectedUserId: message.user,
    channelName,
    messageText: message.text ?? '',
    launchDate: launch.launch_date,
    launchId: launch.id,
  });

  await client.chat.postMessage({
    channel: launch.channel_id,
    text: `⚠️ Potential slip detected — see details below`,
    blocks,
  });

  return true;
}
