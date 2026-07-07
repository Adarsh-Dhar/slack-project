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

export function register(app) {
  app.message(async ({ message, logger }) => {
    if (message.subtype !== undefined || !message.user) return; // skip edits/deletes/bot posts

    const sourceType = config.SIGNAL_SOURCE_CHANNELS[message.channel];
    if (!sourceType) return; // not a configured signal-source channel — ignore

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
