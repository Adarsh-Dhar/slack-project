// listeners/actions/content-review-actions.js
// @ts-nocheck
import * as db from '../../db/index.js';

export function register(app) {
  app.action('content_approve', async ({ ack, body, respond }) => {
    await ack();
    const { launchId, contentType } = JSON.parse(body.actions[0].value);
    db.setContentReviewStatus({ launchId, contentType, status: 'approved', reviewer: body.user.id });
    await respond({ text: `✅ <@${body.user.id}> approved the ${contentType} copy.` });
  });

  app.action('content_changes', async ({ ack, body, respond }) => {
    await ack();
    const { launchId, contentType } = JSON.parse(body.actions[0].value);
    db.setContentReviewStatus({ launchId, contentType, status: 'changes_requested', reviewer: body.user.id });
    await respond({ text: `✏️ <@${body.user.id}> requested changes on the ${contentType} copy.` });
  });
}
