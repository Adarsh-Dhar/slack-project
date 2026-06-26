// src/app.ts
import { App } from '@slack/bolt';
import { config } from './config';
import { registerLaunchCommand } from './handlers/launch';
import { registerAgentCommand } from './handlers/agent';
import { registerActions } from './handlers/actions';
import { registerEvents } from './handlers/events';
import { registerScheduledJobs } from './handlers/standup';

const app = new App({
  token: config.SLACK_BOT_TOKEN,
  signingSecret: config.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: config.SLACK_APP_TOKEN,
});

registerLaunchCommand(app);
registerAgentCommand(app);
registerActions(app);
registerEvents(app);
registerScheduledJobs(app);

(async () => {
  await app.start(config.PORT);
  console.log(`⚡ LaunchPad is running on port ${config.PORT}`);
  console.log(`🤖 /agent command powered by gpt-4o-mini via GitHub Models`);
})();
