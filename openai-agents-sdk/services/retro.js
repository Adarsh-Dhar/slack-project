// services/retro.js
//
// Handles the post-launch retro flow:
//   1. Post a retro prompt 7 days after launch (or on-demand via /retro)
//   2. Open a modal for the PM to log the outcome
//   3. On submission, archive the main + all sub-channels and save the outcome
// @ts-nocheck

import * as db from '../db/index.js';
import { aggregateFeedback } from './feedback.js';

/**
 * Post the retro prompt into the launch channel with a "Start Retro" button.
 * Marks the launch as retro_pending so the cron doesn't re-fire on it.
 */
export async function postRetroPrompt(client, launch) {
  const today = new Date().toISOString().slice(0, 10);
  db.markRetroScheduled(launch.id, today);

  await client.chat.postMessage({
    channel: launch.channel_id,
    text: `📋 *Time for the ${launch.name} retro!*`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `📋 *It's been a week since ${launch.name} launched!*\n\n` +
            `Let's capture how it went before we wrap up this channel. ` +
            `Click below to log the outcome — this will archive the channel once submitted.`,
        },
      },
      {
        type: 'actions',
        block_id: `retro_${launch.id}`,
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '📝 Start Retro', emoji: true },
            style: 'primary',
            action_id: 'retro_start',
            value: String(launch.id),
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '💬 Add Feedback', emoji: true },
            action_id: 'feedback_add',
            value: String(launch.id),
          },
        ],
      },
    ],
  });
}

/**
 * Build the outcome-logging modal shown when "Start Retro" is clicked.
 */
export function buildOutcomeModal(launchId, launchName) {
  const { wentWell, wentWrong } = aggregateFeedback(launchId);
  return {
    type: 'modal',
    callback_id: 'retro_outcome_submit',
    private_metadata: String(launchId),
    title: { type: 'plain_text', text: 'Launch Retro' },
    submit: { type: 'plain_text', text: 'Submit & Archive' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${launchName}* — post-launch retro` },
      },
      {
        type: 'input',
        block_id: 'went_well',
        label: { type: 'plain_text', text: 'What went well?' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          multiline: true,
          initial_value: wentWell || undefined,
        },
      },
      {
        type: 'input',
        block_id: 'went_wrong',
        label: { type: 'plain_text', text: 'What could have gone better?' },
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          multiline: true,
          initial_value: wentWrong || undefined,
        },
      },
      {
        type: 'input',
        block_id: 'adoption',
        label: { type: 'plain_text', text: 'Adoption / metrics notes' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'input',
          multiline: true,
        },
      },
    ],
  };
}

/**
 * Called when the outcome modal is submitted.
 * Saves the outcome, posts a final summary, and archives every
 * channel associated with this launch (main + all sub-channels).
 */
export async function finalizeRetroAndArchive(client, input) {
  const launch = db.getLaunchById(input.launchId);
  if (!launch) return;

  const outcomeSummary =
    `*What went well:*\n${input.whatWentWell}\n\n` +
    `*What could improve:*\n${input.whatDidnt}\n\n` +
    `*Adoption notes:*\n${input.adoptionNotes || '_none provided_'}`;

  // 1. Save to DB and flip status to archived
  db.saveOutcomeAndArchive(input.launchId, outcomeSummary);

  // 2. Post final summary before archiving (last message in the channel)
  await client.chat.postMessage({
    channel: launch.channel_id,
    text:
      `✅ *Retro complete for ${launch.name}* — logged by <@${input.submittedBy}>\n\n` +
      outcomeSummary +
      `\n\n_This channel and all sub-channels will now be archived._`,
  }).catch(err => console.error('[retro] Failed to post summary (channel may already be archived):', err.message));

  // 3. Archive the main channel
  await client.conversations.archive({ channel: launch.channel_id }).catch(err =>
    console.error('[retro] Failed to archive main channel:', err)
  );

  // 4. Archive all registered sub-channels
  const stakeholderChannels = db.getStakeholderChannels(launch.id);
  for (const sc of stakeholderChannels) {
    await client.conversations.archive({ channel: sc.channel_id }).catch(err =>
      console.error(`[retro] Failed to archive sub-channel ${sc.channel_id}:`, err)
    );
  }
}
