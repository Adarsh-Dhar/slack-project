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

  // Optional: a channel ID (e.g. #launch-leadership) that /launch-report share
  // mirrors reports into. Leave unset to only post reports in-channel.
  LEADERSHIP_CHANNEL_ID: process.env['LEADERSHIP_CHANNEL_ID'] ?? '',

  // Outbound comms webhooks, one per channel type. Point these at your
  // CMS/ESP/social-scheduler's incoming webhook, or an internal proxy.
  COMMS_WEBHOOKS: {
    blog:   process.env['COMMS_WEBHOOK_BLOG']   ?? '',
    email:  process.env['COMMS_WEBHOOK_EMAIL']  ?? '',
    social: process.env['COMMS_WEBHOOK_SOCIAL'] ?? '',
    press:  process.env['COMMS_WEBHOOK_PRESS']  ?? '',
  },

  // Monitoring provider — used by services/monitoring.js pull-based tool.
  MONITORING_API_URL: process.env['MONITORING_API_URL'] ?? '',
  MONITORING_API_KEY: process.env['MONITORING_API_KEY'] ?? '',

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
  ],

  GO_NO_GO_DAYS_BEFORE: 2,
  STANDUP_HOUR: 9,

  // Posted into the relevant sub-channel (and DM'd to that team's roster,
  // when `team` is set) once a launch comes within `daysBeforeBoundary` days
  // of the named phase boundary. Keyed off PHASE_BOUNDARIES_DAYS so reminders
  // stay in sync if those thresholds move.
  DEADLINE_REMINDERS: {
    feature_freeze: {
      phase: 'build',
      team: 'engineering',
      daysBeforeBoundary: 3,
      message: '🧊 *Feature freeze in {days} day(s)* for {launchName}. Get remaining PRs in for review.',
    },
    legal_review: {
      phase: 'prelaunch',
      team: 'legal',
      daysBeforeBoundary: 3,
      message: '⚖️ *Legal review window closes in {days} day(s)* for {launchName}. Please complete sign-off.',
    },
  },

  // Hour-by-hour launch-day runbook, posted by services/runbook.js into the
  // launch channel (which doubles as the war room) once a launch enters
  // the `launchday` phase. Times are relative labels, not literal clock times.
  DEFAULT_RUNBOOK: [
    { time: 'T-2h', title: 'Final go/no-go confirmation', ownerTeam: 'engineering', instructions: 'Confirm all Go/No-Go items are green; page on-call if any are still red.' },
    { time: 'T-1h', title: 'Deploy freeze & staging smoke test', ownerTeam: 'engineering', instructions: 'Run the staging smoke suite and confirm rollback plan is ready.' },
    { time: 'T-0', title: 'Flip the flag / ship it', ownerTeam: 'engineering', instructions: 'Execute the launch deploy. Post a ✅ here once live.' },
    { time: 'T+15m', title: 'Marketing & comms go out', ownerTeam: 'marketing', instructions: 'Publish announcement post and notify CS of go-live.' },
    { time: 'T+1h', title: 'Monitor dashboards', ownerTeam: 'engineering', instructions: 'Watch error rates and key metrics; post status updates in this channel every 30 min.' },
    { time: 'T+4h', title: 'Stability check-in', ownerTeam: 'engineering', instructions: 'Confirm no open incidents before standing down the war room.' },
  ],
};
