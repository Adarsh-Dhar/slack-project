// src/handlers/actions.ts
import type { App, BlockAction, ButtonAction } from '@slack/bolt';
import * as db from '../db';
import { updateLaunchCanvas } from '../services/canvasBuilder';
import { executeLaunch } from '../services/launchDay';
import { buildOutcomeModal, finalizeRetroAndArchive } from '../services/retro';
import { refreshGoNoGoChecklist } from '../services/goNoGoCanvas';
import type { OutcomeFormInput } from '../types';

interface StandupActionValue {
  itemId: number;
  launchId: number;
}

interface GoNoGoItemActionValue {
  itemId: number;
  launchId: number;
}

interface SlipActionValue {
  launchId: number;
  detectedUserId?: string;
}

// Bolt v4: body in action handlers is BlockAction; channel/message live on the payload
type BlockActionBody = BlockAction<ButtonAction>;

export function registerActions(app: App): void {

  // ─── Standup: Done ───────────────────────────────────────────────────────
  app.action('standup_done', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = (action as ButtonAction).value ?? '{}';
    const { itemId, launchId } = JSON.parse(value) as StandupActionValue;
    db.updateItemStatus(itemId, 'done');
    db.markStandupAcked(itemId);

    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    const items = db.getItemsByLaunch(launchId);
    await updateLaunchCanvas(client, launch, items);

    const b = body as BlockActionBody;
    const channelId = b.channel?.id;
    const ts = b.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `✅ Marked as done! Canvas updated.`,
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

    const value = (action as ButtonAction).value ?? '{}';
    const { itemId, launchId } = JSON.parse(value) as StandupActionValue;
    db.updateItemStatus(itemId, 'blocked');
    db.markStandupAcked(itemId);

    const b = body as BlockActionBody;
    await client.views.open({
      trigger_id: b.trigger_id,
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

    const value = (action as ButtonAction).value ?? '{}';
    const { itemId } = JSON.parse(value) as StandupActionValue;
    db.updateItemStatus(itemId, 'in_progress');
    db.markStandupAcked(itemId);

    const b = body as BlockActionBody;
    const channelId = b.channel?.id;
    const ts = b.message?.ts;
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

  // ─── Slip: Yes, we slip ──────────────────────────────────────────────────
  app.action('slip_yes', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = (action as ButtonAction).value ?? '{}';
    const { launchId } = JSON.parse(value) as SlipActionValue;
    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `⚠️ <@${body.user.id}> confirmed a potential slip. <@${launch.pm_user_id}> — please review and update the launch date if needed.`,
    });
  });

  // ─── Slip: No, we're fine ────────────────────────────────────────────────
  app.action('slip_no', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const b = body as BlockActionBody;
    const channelId = b.channel?.id;
    const ts = b.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `✅ <@${body.user.id}> confirmed: no slip. We're on track.`,
        blocks: [],
      });
    }
  });

  // ─── Slip: Explain in thread ─────────────────────────────────────────────
  app.action('slip_explain', async ({ ack }) => {
    await ack();
    // User will respond in thread — no further action needed
  });

  // ─── Go/No-Go: Approve ──────────────────────────────────────────────────
  app.action('gonogo_approve', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const launchId = Number((action as ButtonAction).value);
    db.updateLaunchStatus(launchId, 'approved');

    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `🟢 *Launch approved* by <@${body.user.id}>! LaunchPad will execute on *${launch.launch_date}*.`,
    });

    const today = new Date().toISOString().split('T')[0];
    if (launch.launch_date === today) {
      await executeLaunch(client, launchId, []);
    }
  });

  // ─── Go/No-Go: Hold ─────────────────────────────────────────────────────
  app.action('gonogo_hold', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const launchId = Number((action as ButtonAction).value);
    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `🔴 *Launch on hold.* <@${body.user.id}> held the Go/No-Go. Discuss outstanding items in this channel.`,
    });
  });

  // ─── Legal: mark signed off ───────────────────────────────────────────────
  app.action('legal_signoff', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const launchId = Number((action as ButtonAction).value);
    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    db.markLegalSignedOff(launchId);

    const b = body as BlockActionBody;
    const channelId = b.channel?.id;
    const ts = b.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `✅ Legal signed off by <@${body.user.id}>.`,
        blocks: [],
      });
    }

    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `✅ *Legal sign-off complete* for *${launch.name}*, confirmed by <@${body.user.id}>.`,
    });
  });

  // ─── Go/No-Go: item marked green ─────────────────────────────────────────
  app.action('gonogo_item_green', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = (action as ButtonAction).value ?? '{}';
    const { itemId, launchId } = JSON.parse(value) as GoNoGoItemActionValue;

    db.setGoNoGoResponse(itemId, 'green');
    await refreshGoNoGoChecklist(client, launchId);
  });

  // ─── Go/No-Go: item marked red → ask for a reason ────────────────────────
  app.action('gonogo_item_red', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = (action as ButtonAction).value ?? '{}';
    const { itemId, launchId } = JSON.parse(value) as GoNoGoItemActionValue;

    const b = body as BlockActionBody;
    await client.views.open({
      trigger_id: b.trigger_id,
      view: {
        type: 'modal',
        callback_id: `gonogo_red_modal_${itemId}_${launchId}`,
        title: { type: 'plain_text', text: 'Mark Red' },
        submit: { type: 'plain_text', text: 'Submit' },
        blocks: [
          {
            type: 'input',
            block_id: 'gonogo_red_reason',
            label: { type: 'plain_text', text: "What's blocking go on this?" },
            element: {
              type: 'plain_text_input',
              action_id: 'reason_text',
              multiline: true,
              placeholder: { type: 'plain_text', text: 'e.g. load testing failed, waiting on a fix' },
            },
          },
        ],
      },
    });
  });

  // ─── Go/No-Go: red reason modal submitted ────────────────────────────────
  app.view(/^gonogo_red_modal_/, async ({ ack, body, view, client }) => {
    await ack();

    // callback_id is "gonogo_red_modal_{itemId}_{launchId}"
    const parts = view.callback_id.split('_');
    const launchId = Number(parts[parts.length - 1]);
    const itemId = Number(parts[parts.length - 2]);

    const reason =
      view.state.values['gonogo_red_reason']?.['reason_text']?.value ?? '(no reason given)';

    db.setGoNoGoResponse(itemId, 'red', reason);
    await refreshGoNoGoChecklist(client, launchId);

    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    // Immediate confirmation DM to the person who marked it red.
    await client.chat.postMessage({
      channel: body.user.id,
      text: `🔴 You marked an item red for *${launch.name}*: _${reason}_. The team has been notified.`,
    });
  });

  // ─── Go/No-Go: owner requests a PM override on a red item ───────────────
  app.action('gonogo_request_override', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = (action as ButtonAction).value ?? '{}';
    const { itemId, launchId } = JSON.parse(value) as GoNoGoItemActionValue;

    const launch = db.getLaunchById(launchId);
    const items = db.getItemsByLaunch(launchId);
    const item = items.find(i => i.id === itemId);
    if (!launch || !item) return;

    db.setOverrideRequested(itemId);
    await refreshGoNoGoChecklist(client, launchId);

    await client.chat.postMessage({
      channel: launch.pm_user_id,
      text: `🆘 *Override requested* for *${item.title}* on *${launch.name}*, flagged red by <@${item.owner_id}>: _${item.gonogo_note ?? 'no reason given'}_.`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              `🆘 *Override requested* for *${item.title}* on *${launch.name}*, ` +
              `flagged red by <@${item.owner_id}>: _${item.gonogo_note ?? 'no reason given'}_.`,
          },
        },
        {
          type: 'actions',
          block_id: `gonogo_override_approve_${itemId}`,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '✅ Approve Override', emoji: true },
              style: 'primary',
              action_id: 'gonogo_approve_override',
              value: JSON.stringify({ itemId, launchId }),
            },
          ],
        },
      ],
    });
  });

  // ─── Go/No-Go: PM approves the override ──────────────────────────────────
  app.action('gonogo_approve_override', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const value = (action as ButtonAction).value ?? '{}';
    const { itemId, launchId } = JSON.parse(value) as GoNoGoItemActionValue;

    const launch = db.getLaunchById(launchId);
    const items = db.getItemsByLaunch(launchId);
    const item = items.find(i => i.id === itemId);
    if (!launch || !item) return;

    db.approveOverride(itemId, body.user.id);
    await refreshGoNoGoChecklist(client, launchId);

    const b = body as BlockActionBody;
    const channelId = b.channel?.id;
    const ts = b.message?.ts;
    if (channelId && ts) {
      await client.chat.update({
        channel: channelId,
        ts,
        text: `✅ Override approved by <@${body.user.id}>.`,
        blocks: [],
      });
    }

    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `🟠 <@${body.user.id}> approved an override for *${item.title}* (originally flagged red by <@${item.owner_id}>).`,
    });
  });

  // ─── Retro: Start button clicked → open the outcome modal ────────────────
  app.action('retro_start', async ({ ack, body, client, action }) => {
    await ack();
    if (action.type !== 'button') return;

    const launchId = Number((action as ButtonAction).value);
    const launch = db.getLaunchById(launchId);
    if (!launch) return;

    const b = body as BlockActionBody;
    await client.views.open({
      trigger_id: b.trigger_id,
      view: buildOutcomeModal(launchId, launch.name),
    });
  });

  // ─── Retro: Outcome modal submitted → save + archive everything ─────────
  app.view('retro_outcome_submit', async ({ ack, view, client, body }) => {
    await ack();

    const launchId = Number(view.private_metadata);
    const values = view.state.values;

    const input: OutcomeFormInput = {
      launchId,
      whatWentWell: values.went_well?.input?.value ?? '',
      whatDidnt: values.went_wrong?.input?.value ?? '',
      adoptionNotes: values.adoption?.input?.value ?? '',
      submittedBy: body.user.id,
    };

    await finalizeRetroAndArchive(client, input);
  });
}
