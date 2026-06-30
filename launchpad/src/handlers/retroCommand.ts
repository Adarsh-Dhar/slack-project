// src/handlers/retroCommand.ts
import type { App } from '@slack/bolt';
import * as db from '../db';
import { postRetroPrompt } from '../services/retro';

export function registerRetroCommand(app: App): void {
  app.command('/retro', async ({ command, ack, client, respond }) => {
    await ack();

    const launch = db.getLaunchByChannel(command.channel_id);
    if (!launch) {
      await respond({
        text: '❌ This command must be run inside a launch channel created by LaunchPad.',
      });
      return;
    }

    if (launch.status === 'archived') {
      await respond({ text: '⚠️ This launch has already been archived.' });
      return;
    }

    await postRetroPrompt(client, launch);
    await respond({ text: '📋 Retro prompt posted above.' });
  });
}
