// src/handlers/standup.ts
import type { App } from '@slack/bolt';
import * as cron from 'node-cron';
import { differenceInCalendarDays } from 'date-fns';
import * as db from '../db';
import { config } from '../config';
import { buildStandupBlocks } from '../utils/blocks';
import { runGoNoGo } from '../services/goNoGo';
import { executeLaunch } from '../services/launchDay';
import type { ItemRow } from '../types';

export function registerScheduledJobs(app: App): void {
  const client = app.client;

  // ─── Daily standup: 9am weekdays ────────────────────────────────────────
  cron.schedule(`0 ${config.STANDUP_HOUR} * * 1-5`, async () => {
    console.log('[Standup] Running daily standups...');

    const activeLaunches = db.getAllActiveLaunches();

    for (const launch of activeLaunches) {
      const items = db.getItemsByLaunch(launch.id);
      const incompleteItems = items.filter(i => i.status !== 'done' && i.owner_id !== null);

      // Group by owner
      const byOwner = new Map<string, ItemRow[]>();
      for (const item of incompleteItems) {
        const ownerId = item.owner_id!;
        const existing = byOwner.get(ownerId) ?? [];
        byOwner.set(ownerId, [...existing, item]);
      }

      for (const [ownerId, ownerItems] of byOwner.entries()) {
        const topItem = ownerItems[0];
        if (!topItem) continue;

        const blocks = buildStandupBlocks({
          itemTitle: topItem.title,
          launchName: launch.name,
          launchDate: launch.launch_date,
          itemId: topItem.id,
          launchId: launch.id,
        });

        await client.chat
          .postMessage({
            channel: ownerId,
            text: `Daily check-in for ${launch.name}`,
            blocks,
          })
          .catch((err: Error) =>
            console.error(`[Standup] DM failed for ${ownerId}:`, err.message)
          );
      }
    }
  });

  // ─── Go/No-Go + launch day check: 9:05am weekdays ───────────────────────
  cron.schedule(`5 ${config.STANDUP_HOUR} * * 1-5`, async () => {
    console.log('[GoNoGo] Checking for upcoming launches...');

    const activeLaunches = db.getAllActiveLaunches();

    for (const launch of activeLaunches) {
      const daysUntil = differenceInCalendarDays(
        new Date(launch.launch_date),
        new Date()
      );

      if (daysUntil === config.GO_NO_GO_DAYS_BEFORE) {
        console.log(`[GoNoGo] Triggering for launch ${launch.id}: ${launch.name}`);
        await runGoNoGo(client, launch.id).catch((err: Error) =>
          console.error(`[GoNoGo] Failed for launch ${launch.id}:`, err.message)
        );
      }

      if (daysUntil === 0 && launch.status === 'approved') {
        console.log(`[LaunchDay] Executing launch ${launch.id}: ${launch.name}`);
        await executeLaunch(client, launch.id, []).catch((err: Error) =>
          console.error(`[LaunchDay] Failed for launch ${launch.id}:`, err.message)
        );
      }
    }
  });
}
