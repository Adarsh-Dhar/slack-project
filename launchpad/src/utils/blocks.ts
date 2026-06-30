// src/utils/blocks.ts
import type { KnownBlock } from '@slack/web-api';
import type { StandupBlocksInput, SlipAlertBlocksInput, GoNoGoChecklistBlocksInput, ItemRow, TeamName } from '../types';

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

const GONOGO_TEAMS: TeamName[] = ['engineering', 'marketing', 'docs', 'legal', 'sales'];

function gonogoItemLine(item: ItemRow): string {
  const owner = item.owner_id ? `<@${item.owner_id}>` : '_unassigned_';

  if (item.gonogo_response === 'green') return `🟢 *${item.title}* — ${owner}`;
  if (item.gonogo_response === 'overridden') {
    return `🟠 *${item.title}* — ${owner} _(overridden by <@${item.gonogo_overridden_by}>)_`;
  }
  if (item.gonogo_response === 'red') {
    const note = item.gonogo_note ? `: _${item.gonogo_note}_` : '';
    return `🔴 *${item.title}* — ${owner}${note}`;
  }
  return `⬜ *${item.title}* — ${owner} _(no response yet)_`;
}

/**
 * Structured Go/No-Go checklist, posted in the launch channel at T-48h.
 * Each unresponded item gets its own Green/Red buttons (scoped to that
 * item via the action value), red items get a "Request Override" button,
 * and the whole thing ends with the existing Approve/Hold launch actions.
 */
export function buildGoNoGoChecklistBlocks(input: GoNoGoChecklistBlocksInput): KnownBlock[] {
  const { launch, items, summary } = input;

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚦 Go/No-Go Checklist — ${launch.name}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `🟢 ${summary.green} green · 🔴 ${summary.red} red · 🟠 ${summary.overridden} overridden · ` +
          `⬜ ${summary.noResponse} no response _(${summary.total} total)_\n\nLaunch date: *${launch.launch_date}*`,
      },
    },
  ];

  for (const team of GONOGO_TEAMS) {
    const teamItems = items.filter(i => i.team === team);
    if (teamItems.length === 0) continue;

    const label = team.charAt(0).toUpperCase() + team.slice(1);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${label}*\n${teamItems.map(gonogoItemLine).join('\n')}` },
    });

    for (const item of teamItems) {
      if (!item.owner_id) continue;

      // Awaiting a response: show Green/Red buttons.
      if (!item.gonogo_response) {
        blocks.push({
          type: 'actions',
          block_id: `gonogo_item_${item.id}`,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: `🟢 Green: ${item.title}`, emoji: true },
              style: 'primary',
              action_id: 'gonogo_item_green',
              value: JSON.stringify({ itemId: item.id, launchId: launch.id }),
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: `🔴 Red: ${item.title}`, emoji: true },
              style: 'danger',
              action_id: 'gonogo_item_red',
              value: JSON.stringify({ itemId: item.id, launchId: launch.id }),
            },
          ],
        });
      } else if (item.gonogo_response === 'red' && !item.gonogo_override_requested) {
        // Red and not yet escalated: offer to request an override from the PM.
        blocks.push({
          type: 'actions',
          block_id: `gonogo_override_${item.id}`,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: `🆘 Request Override: ${item.title}`, emoji: true },
              action_id: 'gonogo_request_override',
              value: JSON.stringify({ itemId: item.id, launchId: launch.id }),
            },
          ],
        });
      } else if (item.gonogo_response === 'red' && item.gonogo_override_requested) {
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `⏳ Override requested for *${item.title}* — awaiting PM approval.` }],
        });
      }
    }
  }

  blocks.push({ type: 'divider' });

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
