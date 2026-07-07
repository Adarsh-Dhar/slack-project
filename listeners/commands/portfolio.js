// listeners/commands/portfolio.js
// @ts-nocheck
import { buildPortfolioBlocks } from '../../services/report.js';

export function register(app) {
  // Portfolio view isn't scoped to one launch channel, so it can be run
  // from anywhere (a leadership channel, a PM's DM with the bot, etc.).
  app.command('/launch-portfolio', async ({ ack, respond }) => {
    await ack();

    try {
      const blocks = buildPortfolioBlocks();
      await respond({ text: '📊 Launch Portfolio', blocks });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error('[/launch-portfolio] Error:', message);
      await respond({ text: `❌ Error: ${message}` });
    }
  });
}
