// src/services/slipDetector.ts
import type { WebClient } from '@slack/web-api';
import type { GenericMessageEvent } from '@slack/types';
import { config } from '../config';
import { buildSlipAlertBlocks } from '../utils/blocks';
import type { LaunchRow } from '../types';

interface CheckForSlipInput {
  message: GenericMessageEvent;
  launch: LaunchRow;
  channelName: string;
}

export async function checkForSlip(
  client: WebClient,
  input: CheckForSlipInput
): Promise<boolean> {
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
