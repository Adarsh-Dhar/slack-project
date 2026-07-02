// listeners/actions/comms-actions.js
// @ts-nocheck
import { triggerComms } from '../../services/comms.js';

export function register(app) {
  app.action('trigger_comms_confirm', async ({ ack, body, respond }) => {
    await ack();
    try {
      const { launchId, channel, message, requester } = JSON.parse(body.actions[0].value);
      await triggerComms({ launchId, channel, message, triggeredBy: requester });
      await respond({ text: `✅ Sent ${channel} comms.` });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await respond({ text: `❌ Error sending comms: ${message}` });
    }
  });
}
