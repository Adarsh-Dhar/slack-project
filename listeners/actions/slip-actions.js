// listeners/actions/slip-actions.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { buildSlipResolutionBlocks } from '../../utils/blocks.js';

async function updateAlertMessage({ client, body, resolutionText }) {
  const channelId = body.channel?.id;
  const ts = body.message?.ts;
  if (!channelId || !ts) return;

  await client.chat.update({
    channel: channelId,
    ts,
    text: resolutionText,
    blocks: buildSlipResolutionBlocks({ baseBlocks: body.message?.blocks ?? [], resolutionText }),
  }).catch(err => console.error('[slip-actions] Failed to update alert message:', err.message));
}

export function register(app) {
  // ─── Slip: Yes, we slip ──────────────────────────────────────────────────
  app.action('slip_yes', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const { launchId, slipEventId } = JSON.parse(action.value ?? '{}');
    const responder = body.user.id;

    if (slipEventId) db.resolveSlipEvent(slipEventId, 'confirmed', responder);

    const resolutionText = `🔴 <@${responder}> confirmed this *does* affect the launch date.`;
    await updateAlertMessage({ client, body, resolutionText });

    const launch = db.getLaunchById(launchId);
    if (launch?.pm_user_id) {
      await client.chat.postMessage({
        channel: launch.pm_user_id,
        text:
          `🔴 *Confirmed slip risk on ${launch.name}*\n` +
          `<@${responder}> confirmed a message in <#${launch.channel_id}> affects the *${launch.launch_date}* date.\n` +
          `Consider running \`/launch-phase set\` or adjusting the timeline, and let stakeholders know.`,
      }).catch(err => console.error('[slip-actions] Failed to DM PM:', err.message));
    }
  });

  // ─── Slip: No, we're fine ────────────────────────────────────────────────
  app.action('slip_no', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const { slipEventId } = JSON.parse(action.value ?? '{}');
    const responder = body.user.id;

    if (slipEventId) db.resolveSlipEvent(slipEventId, 'dismissed', responder);

    const resolutionText = `🟢 <@${responder}> confirmed this does *not* affect the launch date.`;
    await updateAlertMessage({ client, body, resolutionText });
  });

  // ─── Slip: Explain in thread ─────────────────────────────────────────────
  app.action('slip_explain', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const { slipEventId } = JSON.parse(action.value ?? '{}');
    const responder = body.user.id;

    if (slipEventId) db.resolveSlipEvent(slipEventId, 'explaining', responder);

    const resolutionText = `💬 <@${responder}> is explaining in thread — reply below with details.`;
    await updateAlertMessage({ client, body, resolutionText });

    const ts = body.message?.ts;
    const channelId = body.channel?.id;
    if (ts && channelId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: ts,
        text: `<@${responder}>, go ahead and explain what's going on here — the PM will see it in this thread.`,
      }).catch(err => console.error('[slip-actions] Failed to post thread prompt:', err.message));
    }
  });
}
