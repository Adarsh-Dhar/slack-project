// config.js
// @ts-nocheck
import 'dotenv/config';

function requireEnv(key) {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export const config = {
  SLACK_BOT_TOKEN: requireEnv('SLACK_BOT_TOKEN'),
  SLACK_SIGNING_SECRET: process.env['SLACK_SIGNING_SECRET'] ?? '',
  SLACK_APP_TOKEN: requireEnv('SLACK_APP_TOKEN'),
  PORT: parseInt(process.env['PORT'] ?? '3000', 10),
  DB_PATH: process.env['DB_PATH'] ?? './launchbot.db',

  TIER_CHANNELS: {
    major: [
      { suffix: 'eng',          team: 'engineering', purpose: 'Engineering build coordination' },
      { suffix: 'mktg',         team: 'marketing',   purpose: 'Marketing copy, assets, announcements' },
      { suffix: 'cs-readiness', team: 'sales',       purpose: 'CS and sales enablement' },
      { suffix: 'legal-review', team: 'legal',       purpose: 'Legal and compliance sign-off' },
      { suffix: 'docs',         team: 'docs',        purpose: 'Documentation and help center' },
    ],

    moderate: [
      { suffix: 'eng',  team: 'engineering', purpose: 'Engineering build coordination' },
      { suffix: 'mktg', team: 'marketing',   purpose: 'Marketing copy and announcements' },
      { suffix: 'docs', team: 'docs',        purpose: 'Documentation updates' },
    ],

    minor: [
      // Minor launches only get the main #launch-x channel, no sub-channels
    ],
  },

  PHASE_TEAM_MAP: {
    discovery:  ['engineering'],
    build:      ['engineering', 'marketing', 'sales'],
    prelaunch:  ['engineering', 'marketing', 'sales', 'legal', 'docs'],
    gonogo:     ['engineering', 'marketing', 'sales', 'legal', 'docs'],
    launchday:  ['engineering', 'marketing'],
  },

  PHASE_BOUNDARIES_DAYS: {
    discovery: 56,
    build: 42,
    prelaunch: 14,
    gonogo: 2,
    launchday: 0,
  },

  TEAM_USERGROUP_MAP: {
    engineering: process.env['USERGROUP_ENGINEERING'] ?? '',
    marketing:   process.env['USERGROUP_MARKETING'] ?? '',
    docs:        process.env['USERGROUP_DOCS'] ?? '',
    legal:       process.env['USERGROUP_LEGAL'] ?? '',
    sales:       process.env['USERGROUP_SALES'] ?? '',
    other:       '',
  },
};
