// services/feedback.js
//
// Lets the wider team drop feedback into the launch channel ahead of the
// retro, instead of relying solely on the PM typing everything from memory
// into the outcome modal. Feedback is tagged 'went_well' / 'went_wrong' (or
// left untagged) and aggregated for buildOutcomeModal's prefill.
// @ts-nocheck

import * as db from '../db/index.js';

/**
 * Build the modal used to collect a single piece of feedback, either from
 * the /feedback command or the "💬 Add Feedback" button on the retro prompt.
 */
export function buildFeedbackModal(launchId, launchName) {
  return {
    type: 'modal',
    callback_id: 'launch_feedback_submit',
    private_metadata: String(launchId),
    title: { type: 'plain_text', text: 'Launch Feedback' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*${launchName}* — drop a quick note for the retro` },
      },
      {
        type: 'input',
        block_id: 'sentiment',
        label: { type: 'plain_text', text: 'Category' },
        element: {
          type: 'static_select',
          action_id: 'input',
          options: [
            { text: { type: 'plain_text', text: '👍 Went well' }, value: 'went_well' },
            { text: { type: 'plain_text', text: '👎 Could improve' }, value: 'went_wrong' },
          ],
        },
      },
      {
        type: 'input',
        block_id: 'text',
        label: { type: 'plain_text', text: 'Feedback' },
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
 * Save a single feedback submission and post a lightweight confirmation
 * in the launch channel so the team can see feedback is coming in.
 */
export async function submitFeedback(client, { launchId, userId, sentiment, text }) {
  const launch = db.getLaunchById(launchId);
  if (!launch) return;

  db.addFeedback({ launchId, userId, sentiment, text });

  await client.chat.postMessage({
    channel: launch.channel_id,
    text: `💬 <@${userId}> added retro feedback (_${sentiment === 'went_well' ? 'went well' : 'could improve'}_).`,
  }).catch(err => console.warn('[feedback] confirmation post failed:', err.message));
}

/**
 * Aggregate all collected feedback for a launch into the two free-text
 * blobs the outcome modal expects, so the PM starts from what the team
 * already said instead of a blank box.
 */
export function aggregateFeedback(launchId) {
  const entries = db.getFeedbackForLaunch(launchId);

  const wentWell = entries
    .filter(e => e.sentiment === 'went_well')
    .map(e => `• ${e.text} (<@${e.user_id}>)`)
    .join('\n');

  const wentWrong = entries
    .filter(e => e.sentiment === 'went_wrong')
    .map(e => `• ${e.text} (<@${e.user_id}>)`)
    .join('\n');

  return { wentWell, wentWrong };
}