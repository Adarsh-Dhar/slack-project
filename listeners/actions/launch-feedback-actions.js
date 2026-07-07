// listeners/actions/launch-feedback-actions.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { buildFeedbackModal, submitFeedback } from '../../services/feedback.js';

export function register(app) {
  // Handle "💬 Add Feedback" button click (posted alongside the retro prompt)
  app.action('feedback_add', async ({ ack, body, client }) => {
    await ack();

    try {
      const launchId = parseInt(body.actions[0].value, 10);
      const launch = db.getLaunchById(launchId);
      if (!launch) return;

      const modal = buildFeedbackModal(launchId, launch.name);
      await client.views.open({ trigger_id: body.trigger_id, view: modal });
    } catch (err) {
      console.error('[feedback_add] Error:', err);
    }
  });

  // Handle feedback modal submission
  app.view('launch_feedback_submit', async ({ ack, body, view, client }) => {
    await ack();

    try {
      const launchId = parseInt(view.private_metadata, 10);
      const state = view.state.values;

      const sentiment = state.sentiment.input.selected_option?.value ?? null;
      const text = state.text.input.value;

      await submitFeedback(client, {
        launchId,
        userId: body.user.id,
        sentiment,
        text,
      });
    } catch (err) {
      console.error('[launch_feedback_submit] Error:', err);
    }
  });
}