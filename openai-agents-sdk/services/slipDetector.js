// services/slipDetector.js
// @ts-nocheck
import { config } from '../config.js';
import { buildSlipAlertBlocks } from '../utils/blocks.js';

export async function checkForSlip(client, input) {
  const { message, launch, channelName } = input;
  const text = (message.text ?? '').toLowerCase();

  const triggered = config.SLIP_KEYWORDS.some(kw => text.includes(kw));
  if (!triggered) return false;

  // Ignore bot messages
  if (message.bot_id) return false;

  const blocks = buildSlipAlertBlocks({
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
