// listeners/events/slip-check.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { checkForSlip } from '../../services/slipDetector.js';

export function register(app) {
  app.message(async ({ message, client }) => {
    if (message.subtype !== undefined || !message.user) return;
    const launch = db.getLaunchByStakeholderChannel(message.channel);
    if (!launch || launch.status !== 'active') return;
    const info = await client.conversations.info({ channel: message.channel }).catch(() => null);
    const channelName = info?.channel?.name ?? message.channel;
    await checkForSlip(client, { message, launch, channelName });
  });
}
