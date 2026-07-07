// listeners/actions/gonogo-actions.js
// @ts-nocheck
import { recordResponse, requestOverride, resolveOverride } from '../../services/gonogo.js';

export function register(app) {
  // ─── Checklist item: Green ───────────────────────────────────────────────
  app.action('gonogo_item_green', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const { itemId, launchId } = JSON.parse(action.value ?? '{}');
    await recordResponse(client, {
      itemId, launchId, status: 'green', respondedBy: body.user.id,
    });
  });

  // ─── Checklist item: Red ─────────────────────────────────────────────────
  app.action('gonogo_item_red', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const { itemId, launchId } = JSON.parse(action.value ?? '{}');
    await recordResponse(client, {
      itemId, launchId, status: 'red', respondedBy: body.user.id,
    });
  });

  // ─── Owner requests an override on a red item ────────────────────────────
  app.action('gonogo_request_override', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const { itemId, launchId } = JSON.parse(action.value ?? '{}');
    await requestOverride(client, {
      itemId, launchId, requestedBy: body.user.id, reason: null,
    });

    const channelId = body.channel?.id;
    const ts = body.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `📨 Override request sent to the PM for review.`,
        blocks: [],
      }).catch(() => {});
    }
  });

  // ─── PM approves an override ─────────────────────────────────────────────
  app.action('gonogo_override_approve', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const overrideId = Number(action.value);
    await resolveOverride(client, { overrideId, decision: 'approved', resolvedBy: body.user.id });

    const channelId = body.channel?.id;
    const ts = body.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `✅ Override approved.`,
        blocks: [],
      }).catch(() => {});
    }
  });

  // ─── PM denies an override ───────────────────────────────────────────────
  app.action('gonogo_override_deny', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const overrideId = Number(action.value);
    await resolveOverride(client, { overrideId, decision: 'denied', resolvedBy: body.user.id });

    const channelId = body.channel?.id;
    const ts = body.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `❌ Override denied.`,
        blocks: [],
      }).catch(() => {});
    }
  });
}
