// src/handlers/phaseCommand.ts
import type { App } from '@slack/bolt';
import * as db from '../db';
import { syncMembersForPhaseChange, announcePhaseChange } from '../services/phaseManager';
import type { LaunchPhase } from '../types';

const VALID_PHASES: LaunchPhase[] = ['discovery', 'build', 'prelaunch', 'gonogo', 'launchday'];

export function registerPhaseCommand(app: App): void {
  app.command('/launch-phase', async ({ command, ack, client, respond }) => {
    await ack();

    const launch = db.getLaunchByChannel(command.channel_id);
    if (!launch) {
      await respond({ text: 'Run this inside a launch channel created by LaunchPad.' });
      return;
    }

    const requestedPhase = command.text.trim().toLowerCase() as LaunchPhase;
    if (!VALID_PHASES.includes(requestedPhase)) {
      await respond({ text: `Invalid phase. Use one of: ${VALID_PHASES.join(', ')}` });
      return;
    }

    const { added, removed } = await syncMembersForPhaseChange(
      client, launch, launch.current_phase, requestedPhase
    );

    db.updateLaunchPhase(launch.id, requestedPhase);
    await announcePhaseChange(client, launch, requestedPhase, added, removed);

    await respond({ text: `Forced phase transition to ${requestedPhase}.` });
  });
}
