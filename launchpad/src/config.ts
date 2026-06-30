// src/config.ts
import * as dotenv from 'dotenv';
import type { LaunchTier, SubChannel, TeamName } from './types';
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
  GITHUB_TOKEN: requireEnv('GITHUB_TOKEN'),
  PORT: parseInt(process.env['PORT'] ?? '3000', 10),
  DB_PATH: process.env['DB_PATH'] ?? './launchpad.db',

  // GitHub Models
  GITHUB_MODELS_ENDPOINT: 'https://models.github.ai/inference/chat/completions',
  GITHUB_MODELS_MODEL: 'openai/gpt-4o-mini',
  GITHUB_MODELS_API_VERSION: '2022-11-28',

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

  TIER_CHANNELS: {
    major: [
      { suffix: 'eng',          team: 'engineering' as TeamName, purpose: 'Engineering build coordination' },
      { suffix: 'mktg',         team: 'marketing'   as TeamName, purpose: 'Marketing copy, assets, announcements' },
      { suffix: 'cs-readiness', team: 'sales'       as TeamName, purpose: 'CS and sales enablement' },
      { suffix: 'legal-review', team: 'legal'       as TeamName, purpose: 'Legal and compliance sign-off' },
      { suffix: 'docs',         team: 'docs'        as TeamName, purpose: 'Documentation and help center' },
    ] as SubChannel[],

    moderate: [
      { suffix: 'eng',  team: 'engineering' as TeamName, purpose: 'Engineering build coordination' },
      { suffix: 'mktg', team: 'marketing'   as TeamName, purpose: 'Marketing copy and announcements' },
      { suffix: 'docs', team: 'docs'        as TeamName, purpose: 'Documentation updates' },
    ] as SubChannel[],

    minor: [
      // Minor launches only get the main #launch-x channel, no sub-channels
    ] as SubChannel[],
  } as const satisfies Record<LaunchTier, SubChannel[]>,
} as const;
