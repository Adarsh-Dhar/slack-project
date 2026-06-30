// src/services/goNoGoCanvas.ts
//
// Posts the structured Go/No-Go checklist at T-48h and keeps it live via
// chat.update as owners respond. This is a Block Kit message, not a Slack
// Canvas document — Canvases (conversations.canvases.*, used in
// canvasBuilder.ts for the static readiness doc) can't contain interactive
// buttons, so the checklist has to be a regular message we keep editing.

import type { WebClient } from '@slack/web-api';
import * as db from '../db';
import { buildGoNoGoChecklistBlocks } from '../utils/blocks';

/**
 * Post the checklist for the first time. Only call this once per launch —
 * callers should check `launch.gonogo_posted_at` first (the cron does).
 */
export async function postGoNoGoChecklist(client: WebClient, launchId: number): Promise<void> {
  const launch = db.getLaunchById(launchId);
  if (!launch) return;

  const items = db.getItemsByLaunch(launchId);
  const summary = db.getGoNoGoSummary(launchId);
  const blocks = buildGoNoGoChecklistBlocks({ launch, items, summary });

  const result = await client.chat.postMessage({
    channel: launch.channel_id,
    text: `🚦 Go/No-Go checklist for ${launch.name} — ${summary.green}/${summary.total} green`,
    blocks,
  });

  if (result.ts) {
    db.markGoNoGoPosted(launchId, result.ts);
  }

  // Notify owners with assigned items so they know to respond.
  const ownerIds = [...new Set(items.filter(i => i.owner_id).map(i => i.owner_id!))];
  for (const ownerId of ownerIds) {
    await client.chat
      .postMessage({
        channel: ownerId,
        text:
          `🚦 *Go/No-Go in 48 hours* for *${launch.name}*. Please mark your item(s) green or red in <#${launch.channel_id}>.`,
      })
      .catch(() => undefined);
  }
}

/**
 * Re-render and chat.update the existing checklist message so the aggregate
 * counts and per-item state reflect the latest responses. Call this after
 * any green/red click, override request, or override approval.
 */
export async function refreshGoNoGoChecklist(client: WebClient, launchId: number): Promise<void> {
  const launch = db.getLaunchById(launchId);
  if (!launch || !launch.gonogo_message_ts) return;

  const items = db.getItemsByLaunch(launchId);
  const summary = db.getGoNoGoSummary(launchId);
  const blocks = buildGoNoGoChecklistBlocks({ launch, items, summary });

  await client.chat.update({
    channel: launch.channel_id,
    ts: launch.gonogo_message_ts,
    text: `🚦 Go/No-Go checklist for ${launch.name} — ${summary.green}/${summary.total} green`,
    blocks,
  });
}
