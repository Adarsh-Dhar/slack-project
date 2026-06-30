// utils/blocks.js
// @ts-nocheck

export function buildStandupBlocks(input) {
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

export function buildSlipAlertBlocks(input) {
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

export function buildGoNoGoCanvasBlocks(input) {
  const { launch, items, responses } = input;
  const responseByItem = new Map(responses.map(r => [r.item_id, r]));

  const greenCount = responses.filter(r => r.status === 'green').length;
  const redCount = responses.filter(r => r.status === 'red').length;
  const pendingCount = items.length - responses.length;
  const statusEmoji = redCount > 0 ? '�' : pendingCount > 0 ? '🟡' : '🟢';

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🚦 Go/No-Go — ${launch.name}`, emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `${statusEmoji} *${greenCount} green · ${redCount} red · ${pendingCount} pending* ` +
          `out of ${items.length} readiness items.\n\nLaunch date: *${launch.launch_date}* (T-48h checklist)`,
      },
    },
    { type: 'divider' },
  ];

  for (const item of items) {
    const response = responseByItem.get(item.id);
    const statusLabel = response
      ? response.status === 'green'
        ? '🟢 Green'
        : '🔴 Red'
      : '⚪️ Awaiting response';
    const value = JSON.stringify({ itemId: item.id, launchId: launch.id });

    blocks.push({
      type: 'section',
      block_id: `gonogo_item_${item.id}`,
      text: {
        type: 'mrkdwn',
        text: `*${item.title}*\n${item.team} · <@${item.owner_id ?? 'unassigned'}> · ${statusLabel}`,
      },
    });

    blocks.push({
      type: 'actions',
      block_id: `gonogo_item_actions_${item.id}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🟢 Green', emoji: true },
          style: 'primary',
          action_id: 'gonogo_item_green',
          value,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔴 Red', emoji: true },
          style: 'danger',
          action_id: 'gonogo_item_red',
          value,
        },
      ],
    });
  }

  return blocks;
}

export function buildOverridePromptBlocks(input) {
  const { itemTitle, launchName, itemId, launchId } = input;
  const value = JSON.stringify({ itemId, launchId });

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `🔴 You marked *${itemTitle}* (${launchName}) as *red* on the Go/No-Go checklist.\n\n` +
          `If you believe this shouldn't block launch, you can request an override from the PM.`,
      },
    },
    {
      type: 'actions',
      block_id: `gonogo_override_${itemId}_${launchId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Request Override', emoji: true },
          style: 'primary',
          action_id: 'gonogo_request_override',
          value,
        },
      ],
    },
  ];
}

export function buildOverrideApprovalBlocks(input) {
  const { overrideId, itemTitle, launchName, requestedBy, reason } = input;
  const value = String(overrideId);

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `🟠 *Override requested* for *${itemTitle}* on *${launchName}*\n\n` +
          `Requested by <@${requestedBy}>${reason ? `:\n> ${reason}` : ' (no reason given).'}`,
      },
    },
    {
      type: 'actions',
      block_id: `gonogo_override_approval_${overrideId}`,
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve Override', emoji: true },
          style: 'primary',
          action_id: 'gonogo_override_approve',
          value,
          confirm: {
            title: { type: 'plain_text', text: 'Approve this override?' },
            text: {
              type: 'mrkdwn',
              text: `This will mark *${itemTitle}* as cleared for launch despite being red.`,
            },
            confirm: { type: 'plain_text', text: 'Yes, approve' },
            deny: { type: 'plain_text', text: 'Cancel' },
          },
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Deny', emoji: true },
          style: 'danger',
          action_id: 'gonogo_override_deny',
          value,
        },
      ],
    },
  ];
}
