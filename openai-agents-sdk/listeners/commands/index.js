import * as launch from './launch.js';
import * as phase from './phase.js';
import * as retro from './retro.js';
import * as feedback from './feedback.js';
import * as report from './report.js';
import * as portfolio from './portfolio.js';
import * as kpi from './kpi.js';

/**
 * Register all slash command listeners.
 * @param {import('@slack/bolt').App} app
 * @returns {void}
 */
export function register(app) {
  launch.register(app);
  phase.register(app);
  retro.register(app);
  feedback.register(app);
  report.register(app);
  portfolio.register(app);
  kpi.register(app);
}
