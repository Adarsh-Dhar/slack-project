// listeners/commands/phase.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { syncMembersForPhaseChange, announcePhaseChange } from '../../services/phaseManager.js';

const PHASE_ORDER = ['discovery', 'build', 'prelaunch', 'gonogo', 'launchday'];

export function register(app) {
  app.command('/launch-phase', async ({ command, ack, client, respond }) => {
    await ack();

    try {
      const args = command.text.trim().split(/\s+/);
      const action = args[0];
      const phaseArg = args[1]?.toLowerCase();

      // Get launch from current channel
      const launch = db.getLaunchByChannel(command.channel_id);
      if (!launch) {
        await respond({ text: '❌ No active launch found in this channel.' });
        return;
      }

      if (action === 'status') {
        // Show current phase status
        await respond({
          text: `📊 *${launch.name}* Phase Status\n\n` +
                `Current Phase: ${launch.current_phase}\n` +
                `Launch Date: ${launch.launch_date}\n` +
                `Tier: ${launch.tier}`,
        });
        return;
      }

      if (action === 'set' && phaseArg) {
        // Force phase change
        if (!PHASE_ORDER.includes(phaseArg)) {
          await respond({
            text: `❌ Invalid phase. Valid phases: ${PHASE_ORDER.join(', ')}`,
          });
          return;
        }

        const oldPhase = launch.current_phase;
        const { added, removed } = await syncMembersForPhaseChange(
          client, launch, oldPhase, phaseArg
        );

        db.updateLaunchPhase(launch.id, phaseArg);
        await announcePhaseChange(client, launch, phaseArg, added, removed);

        await respond({
          text: `✅ Phase updated from ${oldPhase} to ${phaseArg}`,
        });
        return;
      }

      // Show usage
      await respond({
        text: `Usage:\n` +
              `/launch-phase status — show current phase\n` +
              `/launch-phase set <phase> — force phase change (discovery, build, prelaunch, gonogo, launchday)`,
      });

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/launch-phase] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}
