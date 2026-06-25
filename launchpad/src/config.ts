// src/config.ts
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true }); // .env.local takes precedence

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  SLACK_BOT_TOKEN: requireEnv('SLACK_BOT_TOKEN'),
  SLACK_SIGNING_SECRET: requireEnv('SLACK_SIGNING_SECRET'),
  SLACK_APP_TOKEN: requireEnv('SLACK_APP_TOKEN'),
  PORT: parseInt(process.env['PORT'] ?? '3000', 10),
  DB_PATH: process.env['DB_PATH'] ?? './launchpad.db',

  GO_NO_GO_DAYS_BEFORE: 2,
  STANDUP_HOUR: 9,
  SCAN_LIMIT: 200,

  SLIP_KEYWORDS: [
    'need more time',
    'not ready',
    'delayed',
    'pushed back',
    'behind schedule',
    "won't make",
    'need another day',
    'need 2 more days',
    'blocking us',
    'blocked on',
  ] as readonly string[],
} as const;
