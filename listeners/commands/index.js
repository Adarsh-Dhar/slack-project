import * as signals from './signals.js';

/**
 * Register all slash command listeners.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  signals.register(app);
}
