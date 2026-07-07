// listeners/commands/report.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { config } from '../../config.js';
import { buildLaunchReport, buildLaunchReportBlocks } from '../../services/report.js';

export function register(app) {
  app.command('/launch-report', async ({ command, ack, client, respond }) => {
    await ack();

    try {
      const launch = db.getLaunchByChannel(command.channel_id);
      if (!launch) {
        await respond({ text: '❌ No active launch found in this channel. Run this from a launch channel.' });
        return;
      }

      const report = buildLaunchReport(launch.id);
      const blocks = buildLaunchReportBlocks(report);

      // Post the report in the launch channel...
      await client.chat.postMessage({
        channel: launch.channel_id,
        text: `📊 Status report for ${launch.name}`,
        blocks,
      });

      // ...and mirror it to a leadership channel if one is configured.
      const shareArg = command.text.trim();
      const shouldShare = /^share$/i.test(shareArg);
      if (shouldShare) {
        if (!config.LEADERSHIP_CHANNEL_ID) {
          await respond({
            text: '⚠️ Report posted here, but no leadership channel is configured. Set LEADERSHIP_CHANNEL_ID to enable `/launch-report share`.',
          });
          return;
        }
        await client.chat.postMessage({
          channel: config.LEADERSHIP_CHANNEL_ID,
          text: `📊 Status report for ${launch.name}`,
          blocks,
        }).catch(err => console.error('[/launch-report] Failed to post to leadership channel:', err.message));
      }

      await respond({ text: shouldShare ? '✅ Report posted here and shared to leadership.' : '✅ Report posted. Add `share` to also send it to the leadership channel.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/launch-report] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}
