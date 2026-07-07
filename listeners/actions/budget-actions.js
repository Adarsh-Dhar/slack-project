// listeners/actions/budget-actions.js
// @ts-nocheck
import * as db from '../../db/index.js';

export function register(app) {
  app.action('budget_approve', async ({ ack, body, respond }) => {
    await ack();
    const { launchId, category } = JSON.parse(body.actions[0].value);
    db.setBudgetApproval({ launchId, category, status: 'approved', approver: body.user.id });
    await respond({ text: `✅ <@${body.user.id}> approved "${category}".` });
  });

  app.action('budget_reject', async ({ ack, body, respond }) => {
    await ack();
    const { launchId, category } = JSON.parse(body.actions[0].value);
    db.setBudgetApproval({ launchId, category, status: 'rejected', approver: body.user.id });
    await respond({ text: `❌ <@${body.user.id}> rejected "${category}".` });
  });
}
