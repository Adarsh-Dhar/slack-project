// services/runbook.js
//
// Posts the launch-day runbook. The "war room" is the existing main launch
// channel, repurposed for launch day rather than a brand-new channel — this
// avoids another round of channel-creation/membership bookkeeping. If a
// dedicated war-room channel is ever wanted, add a `warroom` entry to
// config.TIER_CHANNELS and swap the target channel below.
// @ts-nocheck

import { config } from '../config.js';

/**
 * Build the Block Kit blocks for the runbook message: a header plus one
 * section per hour-by-hour entry in config.DEFAULT_RUNBOOK.
 */
export function buildRunbookBlocks(launch) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚀 ${launch.name} — Launch Day Runbook`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `This channel is now the *war room* for launch day. Post status updates here as you complete each step below.`,
      },
    },
    { type: 'divider' },
  ];

  for (const step of config.DEFAULT_RUNBOOK) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${step.time} — ${step.title}* _(owner: ${step.ownerTeam})_\n${step.instructions}`,
      },
    });
  }

  return blocks;
}

/**
 * Post the launch-day runbook into the launch's main channel, which doubles
 * as the war room. Called by phaseManager once a launch transitions into
 * the `launchday` phase.
 */
export async function postLaunchDayRunbook(client, launch) {
  return client.chat.postMessage({
    channel: launch.channel_id,
    text: `🚀 Launch Day Runbook for *${launch.name}*`,
    blocks: buildRunbookBlocks(launch),
  });
}