import * as launch from './launch.js';
import * as phase from './phase.js';
import * as retro from './retro.js';

/**
 * Register all slash command listeners.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  launch.register(app);
  phase.register(app);
  retro.register(app);
}
