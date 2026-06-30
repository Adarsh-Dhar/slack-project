// listeners/actions/retro-actions.js
// @ts-nocheck
import * as db from '../../db/index.js';
import { buildOutcomeModal, finalizeRetroAndArchive } from '../../services/retro.js';

export function register(app) {
  // Handle "Start Retro" button click
  app.action('retro_start', async ({ ack, body, client }) => {
    await ack();

    try {
      const launchId = parseInt(body.actions[0].value, 10);
      const launch = db.getLaunchById(launchId);

      if (!launch) {
        await client.chat.postMessage({
          channel: body.channel.id,
          text: '❌ Launch not found.',
        });
        return;
      }

      const modal = buildOutcomeModal(launchId, launch.name);
      await client.views.open({
        trigger_id: body.trigger_id,
        view: modal,
      });
    } catch (err) {
      console.error('[retro_start] Error:', err);
    }
  });

  // Handle retro outcome modal submission
  app.view('retro_outcome_submit', async ({ ack, body, view, client }) => {
    await ack();

    try {
      const launchId = parseInt(view.private_metadata, 10);
      const state = view.state.values;

      const whatWentWell = state.went_well.input.value;
      const whatDidnt = state.went_wrong.input.value;
      const adoptionNotes = state.adoption?.input?.value || '';

      await finalizeRetroAndArchive(client, {
        launchId,
        whatWentWell,
        whatDidnt,
        adoptionNotes,
        submittedBy: body.user.id,
      });
    } catch (err) {
      console.error('[retro_outcome_submit] Error:', err);
    }
  });
}
