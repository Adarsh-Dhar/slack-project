import { handleFeedbackButton } from './feedback-buttons.js';
import * as retroActions from './retro-actions.js';
import * as agentConfirmations from './agent-confirmations.js';
import * as standupActions from './standup-actions.js';
import * as slipActions from './slip-actions.js';
import * as gonogoActions from './gonogo-actions.js';
import * as launchFeedbackActions from './launch-feedback-actions.js';
import * as commsActions from './comms-actions.js';

/**
 * Register action listeners with the Bolt app.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  app.action('feedback', handleFeedbackButton);
  retroActions.register(app);
  agentConfirmations.register(app);
  standupActions.register(app);
  slipActions.register(app);
  gonogoActions.register(app);
  launchFeedbackActions.register(app);
  commsActions.register(app);
}
