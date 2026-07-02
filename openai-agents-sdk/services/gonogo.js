// services/gonogo.js
//
// Orchestrates the Go/No-Go canvas flow:
//   1. Post the structured checklist canvas in the launch channel at T-48h
//   2. Aggregate green/red responses as owners click in
//   3. Auto-DM any owner whose item comes back red
//   4. Surface override requests to the PM with a single approval button
// @ts-nocheck

import * as db from '../db/index.js';
import {
  buildGoNoGoCanvasBlocks,
  buildOverridePromptBlocks,
  buildOverrideApprovalBlocks,
} from '../utils/blocks.js';

/**
 * Post the Go/No-Go checklist canvas into the launch channel.
 * Called by the scheduler once a launch crosses the T-48h boundary.
 */
export async function postGoNoGoCanvas(client, launch) {
  const items = db.getItemsByLaunch(launch.id);
  const responses = db.getGoNoGoResponses(launch.id);

  const blocks = buildGoNoGoCanvasBlocks({ launch, items, responses });

  const result = await client.chat.postMessage({
    channel: launch.channel_id,
    text: `🚦 Go/No-Go checklist for *${launch.name}* — please mark each item green or red.`,
    blocks,
  });

  db.markGoNoGoPosted(launch.id, result.ts);
  return result.ts;
}

/**
 * Re-render the canvas message in place after a response comes in,
 * so the aggregate green/red/pending counts stay current.
 */
export async function refreshGoNoGoCanvas(client, launch) {
  if (!launch.gonogo_message_ts) return;

  const items = db.getItemsByLaunch(launch.id);
  const responses = db.getGoNoGoResponses(launch.id);
  const blocks = buildGoNoGoCanvasBlocks({ launch, items, responses });

  await client.chat.update({
    channel: launch.channel_id,
    ts: launch.gonogo_message_ts,
    text: `🚦 Go/No-Go checklist for *${launch.name}*`,
    blocks,
  }).catch(err => console.error('[gonogo] Failed to refresh canvas:', err.message));
}

/**
 * Record an owner's response to a single checklist item, refresh the
 * aggregate canvas, and — if red — auto-DM the owner with an option
 * to request a PM override.
 */
export async function recordResponse(client, input) {
  const { itemId, launchId, status, respondedBy } = input;

  db.upsertGoNoGoResponse(itemId, launchId, status, respondedBy);

  const launch = db.getLaunchById(launchId);
  if (!launch) return;

  await refreshGoNoGoCanvas(client, launch);

  if (status === 'red') {
    const item = db.getItemsByLaunch(launchId).find(i => i.id === itemId);
    if (!item) return;

    const dmTarget = item.owner_id ?? respondedBy;
    await client.chat.postMessage({
      channel: dmTarget,
      text: `🔴 *${item.title}* was marked red on the *${launch.name}* Go/No-Go checklist.`,
      blocks: buildOverridePromptBlocks({
        itemTitle: item.title,
        launchName: launch.name,
        itemId: item.id,
        launchId: launch.id,
      }),
    }).catch(err => console.error('[gonogo] Failed to DM red-item owner:', err.message));
  }
}

/**
 * Surface an override request to the PM with a single approval button
 * (plus a deny button), DM'd directly to the PM.
 */
export async function requestOverride(client, input) {
  const { itemId, launchId, requestedBy, reason } = input;

  const launch = db.getLaunchById(launchId);
  if (!launch) return;

  const item = db.getItemsByLaunch(launchId).find(i => i.id === itemId);
  if (!item) return;

  const overrideId = db.createOverrideRequest({ launchId, itemId, requestedBy, reason });

  await client.chat.postMessage({
    channel: launch.pm_user_id,
    text: `🟠 Override requested for *${item.title}* on *${launch.name}*`,
    blocks: buildOverrideApprovalBlocks({
      overrideId,
      itemTitle: item.title,
      launchName: launch.name,
      requestedBy,
      reason,
    }),
  });

  return overrideId;
}

/**
 * Resolve an override request (approve or deny) and notify the requester.
 * Approval flips the item's checklist response to green so it stops
 * blocking the canvas/launch.
 */
export async function resolveOverride(client, input) {
  const { overrideId, decision, resolvedBy } = input;

  const override = db.getOverrideRequest(overrideId);
  if (!override || override.status !== 'pending') return null;

  db.resolveOverrideRequest(overrideId, decision, resolvedBy);

  const launch = db.getLaunchById(override.launch_id);
  const item = db.getItemsByLaunch(override.launch_id).find(i => i.id === override.item_id);
  if (!launch || !item) return override;

  if (decision === 'approved') {
    db.upsertGoNoGoResponse(item.id, launch.id, 'green', resolvedBy);
    await refreshGoNoGoCanvas(client, launch);
    await client.chat.postMessage({
      channel: launch.channel_id,
      text: `✅ <@${resolvedBy}> approved an override for *${item.title}* — cleared for launch.`,
    });
  }

  await client.chat.postMessage({
    channel: override.requested_by,
    text:
      decision === 'approved'
        ? `✅ Your override request for *${item.title}* (${launch.name}) was approved by <@${resolvedBy}>.`
        : `❌ Your override request for *${item.title}* (${launch.name}) was denied by <@${resolvedBy}>.`,
  });

  return override;
}

/**
 * Re-send the override-prompt DM to every owner whose item is currently
 * red. Used for on-demand chasing, separate from the automatic DM
 * recordResponse sends the moment an item first goes red.
 */
export async function chaseRedItems(client, launch) {
  const items = db.getItemsByLaunch(launch.id);
  const responses = db.getGoNoGoResponses(launch.id);
  const redItemIds = new Set(responses.filter(r => r.status === 'red').map(r => r.item_id));
  const redItems = items.filter(i => redItemIds.has(i.id));

  for (const item of redItems) {
    const dmTarget = item.owner_id;
    if (!dmTarget) continue;
    await client.chat.postMessage({
      channel: dmTarget,
      text: `🔴 Reminder: *${item.title}* is still red on the *${launch.name}* Go/No-Go checklist.`,
      blocks: buildOverridePromptBlocks({
        itemTitle: item.title,
        launchName: launch.name,
        itemId: item.id,
        launchId: launch.id,
      }),
    }).catch(err => console.error('[gonogo] Failed to re-DM red-item owner:', err.message));
  }
  return redItems.length;
}
