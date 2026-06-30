// listeners/commands/retro.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { postRetroPrompt } from '../../services/retro.js';

export function register(app) {
  app.command('/retro', async ({ command, ack, client, respond }) => {
    await ack();

    try {
      const launch = db.getLaunchByChannel(command.channel_id);
      if (!launch) {
        await respond({ text: '❌ No active launch found in this channel.' });
        return;
      }

      if (launch.status === 'archived') {
        await respond({ text: '❌ This launch has already been archived.' });
        return;
      }

      if (launch.status === 'retro_pending') {
        await respond({ text: 'ℹ️ Retro has already been scheduled. Click the "Start Retro" button in the channel.' });
        return;
      }

      // Post retro prompt
      await postRetroPrompt(client, launch);
      await respond({ text: '✅ Retro prompt posted! Click "Start Retro" to begin.' });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/retro] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}
