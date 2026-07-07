// seed-demo-signals.js
//
// Injects realistic demo "signal" data into Slack channels so you can test
// a signal-intake agent end to end, without waiting for real support tickets,
// sales feedback, interviews, analytics, or churn events to happen.
//
// All 9 messages below reference ONE underlying problem (creators want
// scheduled/bulk publishing) so you can verify your agent's clustering +
// scoring logic actually groups cross-source signal instead of treating
// each message as an isolated, disconnected item.
//
// USAGE:
//   1. npm install @slack/web-api
//   2. Set SLACK_BOT_TOKEN in your environment (needs chat:write scope)
//   3. Invite the bot to each channel listed in CHANNELS below
//   4. Fill in the real channel IDs in CHANNELS
//   5. node seed-demo-signals.js
//
// Optional: pass --dry-run to print what would be posted without calling Slack.

import { WebClient } from '@slack/web-api';

const DRY_RUN = process.argv.includes('--dry-run');
const token = process.env.SLACK_BOT_TOKEN;

if (!DRY_RUN && !token) {
  console.error('Missing SLACK_BOT_TOKEN. Set it or pass --dry-run to preview without posting.');
  process.exit(1);
}

const client = DRY_RUN ? null : new WebClient(token);

// ── Fill these in with real channel IDs from your workspace ────────────────
// Right-click a channel → View channel details → scroll down for the ID,
// or run client.conversations.list() once and log the results.
const CHANNELS = {
  supportTickets: process.env.CHANNEL_SUPPORT_TICKETS || 'C0SUPPORTTIX',
  salesFeedback:  process.env.CHANNEL_SALES_FEEDBACK  || 'C0SALESFEED',
  userInterviews: process.env.CHANNEL_USER_INTERVIEWS || 'C0USERINTV',
  analyticsAlerts: process.env.CHANNEL_ANALYTICS      || 'C0ANALYTICS',
  churnAlerts:    process.env.CHANNEL_CHURN_ALERTS    || 'C0CHURNALERT',
};

// ── Helper: build a simple, readable Block Kit message ──────────────────────
function textBlock(text) {
  return [{ type: 'section', text: { type: 'mrkdwn', text } }];
}

// ── 1. Support tickets ───────────────────────────────────────────────────────
const supportTickets = [
  {
    text: '🎫 New Ticket',
    blocks: textBlock(
      '🎫 *New Ticket #48213* — Priority: Normal\n' +
      '*Subject:* Can I schedule uploads in advance?\n' +
      '*From:* creator_id 3312 (Pro plan)\n\n' +
      '"I have to manually upload every episode at the exact time I want it live. ' +
      "I'm managing 3 shows and doing this by hand at midnight. Does Meridian have " +
      'any scheduling feature? Every other platform I use does."\n\n' +
      '_Tags: #feature-request #scheduling #creator-tools_'
    ),
  },
  {
    text: '🎫 New Ticket',
    blocks: textBlock(
      '🎫 *Ticket #48244* — Priority: High\n' +
      '*Subject:* Bulk upload keeps timing out\n' +
      '*From:* creator_id 5590 (Business plan)\n\n' +
      '"Trying to upload 12 episodes at once for a backlog migration from YouTube. ' +
      'It fails after file 3 every time. This is blocking our whole relaunch."\n\n' +
      '_Tags: #bug #bulk-upload #timeout_'
    ),
  },
  {
    text: '🎫 New Ticket',
    blocks: textBlock(
      '🎫 *Ticket #48301* — Priority: Normal\n' +
      '*Subject:* Re: scheduling\n' +
      '*From:* creator_id 7712 (Pro plan)\n\n' +
      '"+1 to what others are asking — a content calendar or scheduled publish ' +
      'would save me hours a week."\n\n' +
      '_Tags: #feature-request #scheduling_'
    ),
  },
];

// ── 2. Sales feedback ────────────────────────────────────────────────────────
const salesFeedback = [
  {
    text: '💰 Closed-Lost Deal',
    blocks: textBlock(
      '💰 *Closed-Lost — Deal D-9981 ($42,000 ARR)*\n' +
      '*Account:* Northline Studios (14-person media team)\n' +
      '*Reason:* missing_feature\n\n' +
      'Notes from Priya (AE): "Came down to scheduling. They publish across 4 shows ' +
      'on a fixed weekly calendar and need to queue uploads in advance. Vendor X has ' +
      'a full content calendar built in. This was the #1 blocker on the last two ' +
      'calls — nothing else was close."\n\n' +
      '*Competitor mentioned:* Vendor X'
    ),
  },
  {
    text: '💰 Deal at risk',
    blocks: textBlock(
      '💰 *Deal D-10022 — At risk (Stage: Negotiation)*\n' +
      '*Account:* Loomlight Media\n\n' +
      'Notes from Dan (AE): "Prospect loves the analytics but keeps circling back to ' +
      "'can we batch schedule our drops.' Flagging before we lose this one too — this " +
      'is the third deal this quarter where scheduling came up as a blocker."'
    ),
  },
];

// ── 3. User interviews ───────────────────────────────────────────────────────
const userInterviews = [
  {
    text: '🎙️ Interview notes',
    blocks: textBlock(
      '🎙️ *Interview #014 — Ops Manager, mid-size creator team (50-200 employees)*\n' +
      '_2026-06-20_\n\n' +
      '*[participant]:* "Every Sunday night, someone on my team is manually queuing ' +
      "uploads for the week because there's no scheduling. We built a spreadsheet just " +
      "to track what goes live when. It's honestly the most annoying part of using " +
      'Meridian."\n\n' +
      '*[interviewer]:* "If that existed, how would it change your workflow?"\n\n' +
      '*[participant]:* "We\'d probably plan a whole month at once instead of week to ' +
      "week. Right now we don't bother planning further out because someone still has " +
      'to manually execute it."\n\n' +
      '_Tags applied: #scheduling #workflow-friction #manual-process_'
    ),
  },
];

// ── 4. Analytics alerts ──────────────────────────────────────────────────────
const analyticsAlerts = [
  {
    text: '📊 Weekly Feature Signal Report',
    blocks: textBlock(
      '📊 *Weekly Feature Signal Report — Week 2026-W26*\n\n' +
      '⚠️ "content_calendar" search queries in-app: 340 (+218% WoW)\n' +
      '⚠️ Help center article "How to schedule an upload": 890 views (+156% WoW) — ' +
      'highest-growth article this month\n' +
      '📉 Bulk upload success rate: 88.2% — down from 96% baseline, correlates with ' +
      'support ticket #48244 spike\n' +
      '📈 Creators publishing 5+ episodes/week: retention is 34% lower than creators ' +
      'on a predictable 1-2/week cadence — worth checking if inconsistent publishing ' +
      '(no scheduling) is a factor'
    ),
  },
];

// ── 5. Churn alerts ──────────────────────────────────────────────────────────
const churnAlerts = [
  {
    text: '🔴 Churn Alert',
    blocks: textBlock(
      '🔴 *Churn Alert — Customer c_5521 (Pro plan, $199 MRR, 340-day tenure)*\n' +
      '*Cancel reason selected:* missing_feature\n\n' +
      '*Free text:* "Needed to be able to plan and schedule our episode calendar a ' +
      "month out. Doing it manually every week wasn't sustainable for our team. Might " +
      'come back if this gets added."'
    ),
  },
  {
    text: '🔴 Churn Alert',
    blocks: textBlock(
      '🔴 *Churn Alert — Customer c_5544 (Business plan, $499 MRR)*\n' +
      '*Cancel reason selected:* switched_to_competitor\n\n' +
      '*Free text:* "Moved to Vendor X mainly for the content calendar / scheduled ' +
      'publishing feature."'
    ),
  },
];

// ── Post everything, with a small delay between messages to respect rate limits ─
const plan = [
  { channel: CHANNELS.supportTickets, label: '#support-tickets', messages: supportTickets },
  { channel: CHANNELS.salesFeedback, label: '#sales-feedback', messages: salesFeedback },
  { channel: CHANNELS.userInterviews, label: '#user-interviews', messages: userInterviews },
  { channel: CHANNELS.analyticsAlerts, label: '#analytics-alerts', messages: analyticsAlerts },
  { channel: CHANNELS.churnAlerts, label: '#churn-alerts', messages: churnAlerts },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  for (const group of plan) {
    console.log(`\n=== ${group.label} (${group.channel}) ===`);
    for (const msg of group.messages) {
      if (DRY_RUN) {
        console.log(`[dry-run] Would post to ${group.channel}:`, msg.text);
        continue;
      }
      try {
        const result = await client.chat.postMessage({
          channel: group.channel,
          text: msg.text,
          blocks: msg.blocks,
        });
        console.log(`Posted ts=${result.ts} to ${group.label}`);
      } catch (err) {
        console.error(`Failed to post to ${group.label}:`, err.data?.error || err.message);
      }
      await sleep(1200); // stay comfortably under Slack's chat.postMessage rate limit
    }
  }
  console.log('\nDone seeding demo signals.');
}

run();
