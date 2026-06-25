// src/utils/blocks.ts
import type { KnownBlock } from '@slack/web-api';
import type { StandupBlocksInput, SlipAlertBlocksInput, GoNoGoBlocksInput } from '../types';

export function buildStandupBlocks(input: StandupBlocksInput): KnownBlock[] {
  const { itemTitle, launchName, launchDate, itemId, launchId } = input;
  const value = JSON.stringify({ itemId, launchId });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Good morning!* 🚀\n\nYour one item for today on *${launchName}* (launching ${launchDate}):\n\n> *${itemTitle}*\n\nWhere are you on this?`,
      },
    },
    {
      type: 'actions',
      block_id: `standup_${itemId}_${launchId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Done ✅', emoji: true },
          style: 'primary',
          action_id: 'standup_done',
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Blocked 🚫', emoji: true },
          style: 'danger',
          action_id: 'standup_blocked',
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Still working on it 🔄', emoji: true },
          action_id: 'standup_in_progress',
          value,
        },
      ],
    },
  ];
}

export function buildSlipAlertBlocks(input: SlipAlertBlocksInput): KnownBlock[] {
  const { detectedUserId, channelName, messageText, launchDate, launchId } = input;
  const value = JSON.stringify({ launchId, detectedUserId });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `⚠️ *Potential slip detected in #${channelName}*\n<@${detectedUserId}> said something that may affect the ${launchDate} launch.`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `> _"${messageText.slice(0, 200)}"_`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `<@${detectedUserId}> — does this affect the *${launchDate}* date?`,
      },
    },
    {
      type: 'actions',
      block_id: `slip_${launchId}_${Date.now()}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Yes, we need to slip' },
          style: 'danger',
          action_id: 'slip_yes',
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: "No, we're fine" },
          style: 'primary',
          action_id: 'slip_no',
          value: JSON.stringify({ launchId }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: "I'll explain in thread" },
          action_id: 'slip_explain',
          value: JSON.stringify({ launchId }),
        },
      ],
    },
  ];
}

export function buildGoNoGoBlocks(input: GoNoGoBlocksInput): KnownBlock[] {
  const { launch, items, completedCount, totalCount } = input;
  const outstanding = items.filter(i => i.status !== 'done');
  const ratio = totalCount > 0 ? completedCount / totalCount : 0;
  const statusEmoji = ratio === 1 ? '🟢' : ratio >= 0.8 ? '🟡' : '🔴';

  const itemLines = outstanding
    .map(i => `❌ *${i.title}* — <@${i.owner_id ?? 'unassigned'}> (${i.team})`)
    .join('\n');

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚦 Go/No-Go — ${launch.name}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${statusEmoji} *${completedCount} of ${totalCount} items complete.* ${outstanding.length} outstanding.\n\nLaunch date: *${launch.launch_date}*`,
      },
    },
  ];

  if (outstanding.length > 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Outstanding items:*\n${itemLines}` },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '✅ All items complete! Ready to launch.' },
    });
  }

  blocks.push({
    type: 'actions',
    block_id: `gonogo_${launch.id}`,
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: '✅ Approve Launch', emoji: true },
        style: 'primary',
        action_id: 'gonogo_approve',
        value: String(launch.id),
        confirm: {
          title: { type: 'plain_text', text: 'Approve this launch?' },
          text: {
            type: 'mrkdwn',
            text: `This will approve the *${launch.name}* launch for *${launch.launch_date}*.`,
          },
          confirm: { type: 'plain_text', text: 'Yes, approve' },
          deny: { type: 'plain_text', text: 'Not yet' },
        },
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: '🛑 Hold Launch', emoji: true },
        style: 'danger',
        action_id: 'gonogo_hold',
        value: String(launch.id),
      },
    ],
  });

  return blocks;
}
