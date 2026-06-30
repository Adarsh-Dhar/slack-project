import { handleFeedbackButton } from './feedback-buttons.js';
import * as retroActions from './retro-actions.js';
import * as agentConfirmations from './agent-confirmations.js';

/**
 * Register action listeners with the Bolt app.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  app.action('feedback', handleFeedbackButton);
  retroActions.register(app);
  agentConfirmations.register(app);
}
