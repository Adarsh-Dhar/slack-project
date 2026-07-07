// listeners/events/signal-intake.js
// @ts-nocheck
//
// Mirrors the registration pattern in listeners/events/slip-check.js: a
// standalone app.message() listener, independent of the AI-assistant
// message handler in message.js. Generic by design — adding a sixth signal
// source later means adding one line to config.SIGNAL_SOURCE_CHANNELS,
// not writing a sixth listener.

import { config } from '../../config.js';
import { ingestMessage } from '../../services/signalIntake.js';
import { classifyChannel } from '../../services/channelClassification.js';

export function register(app) {
  app.message(async ({ message, logger, client }) => {
    if (message.subtype !== undefined || !message.user) return; // skip edits/deletes/bot posts

    // First try static mapping (fallback for explicit config)
    let sourceType = config.SIGNAL_SOURCE_CHANNELS[message.channel];
    
    // If no static mapping, try classification by channel name
    if (!sourceType) {
      try {
        const channelInfo = await client.conversations.info({ channel: message.channel });
        const channelName = channelInfo.channel?.name || '';
        sourceType = classifyChannel(channelName);
        if (sourceType) {
          logger.debug(`[signal-intake] Classified #${channelName} as "${sourceType}"`);
        }
      } catch (err) {
        logger.debug(`[signal-intake] Could not fetch channel info for ${message.channel}: ${err.message}`);
      }
    }
    
    if (!sourceType) return; // not a signal-source channel — ignore

    const text = message.text || '';
    if (!text.trim()) return;

    try {
      const eventId = ingestMessage({
        sourceType,
        channelId: message.channel,
        messageTs: message.ts,
        rawText: text,
      });
      logger.debug(`[signal-intake] Captured ${sourceType} event #${eventId} from ${message.channel}`);
    } catch (e) {
      logger.error(`[signal-intake] Failed to ingest message: ${e.message}`);
    }
  });
}
