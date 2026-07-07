// listeners/commands/kpi.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { parseKpiCommand, defineKpi, updateKpiValue, buildKpiListBlocks } from '../../services/kpi.js';

export function register(app) {
  app.command('/launch-kpi', async ({ command, ack, respond }) => {
    await ack();

    try {
      const launch = db.getLaunchByChannel(command.channel_id);
      if (!launch) {
        await respond({ text: '❌ No active launch found in this channel.' });
        return;
      }

      const parsed = parseKpiCommand(command.text);

      if (parsed.action === 'list') {
        const blocks = buildKpiListBlocks(launch.id, launch.name);
        await respond({ text: `Success metrics for ${launch.name}`, blocks });
        return;
      }

      if (parsed.action === 'set') {
        defineKpi({
          launchId: launch.id,
          name: parsed.name,
          targetValue: parsed.targetValue,
          unit: parsed.unit,
          updatedBy: command.user_id,
        });
        await respond({ text: `✅ Tracking *${parsed.name}*${parsed.targetValue ? ` (target: ${parsed.targetValue}${parsed.unit ?? ''})` : ''}.` });
        return;
      }

      if (parsed.action === 'update') {
        updateKpiValue({
          launchId: launch.id,
          name: parsed.name,
          currentValue: parsed.currentValue,
          updatedBy: command.user_id,
        });
        await respond({ text: `✅ *${parsed.name}* updated to ${parsed.currentValue}.` });
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/launch-kpi] Error:', message);
      await respond({ text: `❌ ${message}` });
    }
  });
}
