// listeners/actions/standup-actions.js
// @ts-nocheck
import * as db from '../../db/index.js';

export function register(app) {
  // ─── Standup: Done ───────────────────────────────────────────────────────
  app.action('standup_done', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = action.value ?? '{}';
    const { itemId, launchId } = JSON.parse(value);
    db.updateItemStatus(itemId, 'done');

    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    const channelId = body.channel?.id;
    const ts = body.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `✅ Marked as done!`,
        blocks: [],
      });
    }

    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `✅ <@${body.user.id}> marked an item as done.`,
    });
  });

  // ─── Standup: Blocked ────────────────────────────────────────────────────
  app.action('standup_blocked', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = action.value ?? '{}';
    const { itemId, launchId } = JSON.parse(value);
    db.updateItemStatus(itemId, 'blocked');

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: `blocked_modal_${itemId}_${launchId}`,
        title: { type: 'plain_text', text: "What's blocking you?" },
        submit: { type: 'plain_text', text: 'Submit' },
        blocks: [
          {
            type: 'input',
            block_id: 'blocker_input',
            label: { type: 'plain_text', text: 'Describe the blocker' },
            element: {
              type: 'plain_text_input',
              action_id: 'blocker_text',
              multiline: true,
              placeholder: { type: 'plain_text', text: 'What do you need to unblock?' },
            },
          },
        ],
      },
    });
  });

  // ─── Standup: Still working ──────────────────────────────────────────────
  app.action('standup_in_progress', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = action.value ?? '{}';
    const { itemId } = JSON.parse(value);
    db.updateItemStatus(itemId, 'in_progress');

    const channelId = body.channel?.id;
    const ts = body.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `🔄 Got it, still in progress.`,
        blocks: [],
      });
    }
  });

  // ─── Blocked modal submission ────────────────────────────────────────────
  app.view(/^blocked_modal_/, async ({ ack, body, view, client }) => {
    await ack();

    // callback_id is "blocked_modal_{itemId}_{launchId}"
    const parts = view.callback_id.split('_');
    const launchId = Number(parts[parts.length - 1]);

    const blockerText =
      view.state.values['blocker_input']?.['blocker_text']?.value ?? '(no description)';

    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `🚫 *Blocker reported* by <@${body.user.id}>:\n\n> ${blockerText}`,
    });
  });
}
