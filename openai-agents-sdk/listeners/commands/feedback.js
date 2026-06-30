// listeners/commands/feedback.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { buildFeedbackModal } from '../../services/feedback.js';

export function register(app) {
  app.command('/feedback', async ({ command, ack, client, respond }) => {
    await ack();

    try {
      const launch = db.getLaunchByChannel(command.channel_id);
      if (!launch) {
        await respond({ text: '❌ No active launch found in this channel.' });
        return;
      }

      const modal = buildFeedbackModal(launch.id, launch.name);
      await client.views.open({ trigger_id: command.trigger_id, view: modal });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/feedback] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}