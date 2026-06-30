// src/handlers/standup.ts
import type { App } from '@slack/bolt';
import * as cron from 'node-cron';
import { differenceInCalendarDays } from 'date-fns';
import * as db from '../db';
import { config } from '../config';
import { buildStandupBlocks } from '../utils/blocks';
import { postGoNoGoChecklist } from '../services/goNoGoCanvas';
import { executeLaunch } from '../services/launchDay';
import { postRetroPrompt } from '../services/retro';
import { checkAndSyncPhase } from '../services/phaseManager';
import { getOpenPRs } from '../services/githubPRs';
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
          .then(() => db.markStandupDmSent(topItem.id))
          .catch((err: Error) =>
            console.error(`[Standup] DM failed for ${ownerId}:`, err.message)
          );
      }
    }
  });

  // ─── Go/No-Go checklist post: hourly, throttled via gonogo_posted_at ────
  // Posts once per launch as soon as it enters the T-48h window (more
  // resilient than a single daily cron tick — survives a bot restart).
  cron.schedule('10 * * * *', async () => {
    const launches = db.getLaunchesNeedingGoNoGoPost();
    if (launches.length === 0) return;

    console.log(`[GoNoGoChecklist] Posting checklist for ${launches.length} launch(es)...`);

    for (const launch of launches) {
      await postGoNoGoChecklist(client, launch.id).catch((err: Error) =>
        console.error(`[GoNoGoChecklist] Failed for launch ${launch.id}:`, err.message)
      );
    }
  });

  // ─── Go/No-Go red-item nudge: hourly, throttled per item ────────────────
  cron.schedule('40 * * * *', async () => {
    const overdueItems = db.getItemsNeedingGoNoGoNudge();
    if (overdueItems.length === 0) return;

    console.log(`[GoNoGoNudge] Nudging ${overdueItems.length} red item(s)...`);

    for (const item of overdueItems) {
      if (!item.owner_id) continue;
      const launch = db.getLaunchById(item.launch_id);
      if (!launch) continue;

      await client.chat
        .postMessage({
          channel: item.owner_id,
          text:
            `🔴 *Still red:* *${item.title}* (${launch.name}) is blocking Go/No-Go.` +
            (item.gonogo_note ? ` Reason given: _${item.gonogo_note}_.` : '') +
            ` Reply in <#${launch.channel_id}> once resolved, or request an override.`,
        })
        .then(() => db.markGoNoGoNudged(item.id))
        .catch((err: Error) =>
          console.error(`[GoNoGoNudge] DM failed for ${item.owner_id}:`, err.message)
        );
    }
  });

  // ─── Launch day check: 9:05am weekdays ───────────────────────────────────
  cron.schedule(`5 ${config.STANDUP_HOUR} * * 1-5`, async () => {
    console.log('[LaunchDay] Checking for launches executing today...');

    const activeLaunches = db.getAllActiveLaunches();

    for (const launch of activeLaunches) {
      const daysUntil = differenceInCalendarDays(
        new Date(launch.launch_date),
        new Date()
      );

      if (daysUntil === 0 && launch.status === 'approved') {
        console.log(`[LaunchDay] Executing launch ${launch.id}: ${launch.name}`);
        await executeLaunch(client, launch.id, []).catch((err: Error) =>
          console.error(`[LaunchDay] Failed for launch ${launch.id}:`, err.message)
        );
      }
    }
  });

  // ─── Open-PR check: hourly, throttled to once/24h per launch via DB ─────
  // Fires for any launch within 48h of T=0 that has a github_repo set.
  cron.schedule('15 * * * *', async () => {
    const launches = db.getLaunchesNeedingPrCheck();
    if (launches.length === 0) return;

    console.log(`[PRCheck] Checking ${launches.length} launch(es) for open PRs...`);

    for (const launch of launches) {
      if (!launch.github_repo) continue;

      const openPRs = await getOpenPRs(launch.github_repo);
      if (openPRs.length === 0) continue;

      await client.chat
        .postMessage({
          channel: launch.channel_id,
          text: `🔴 *${openPRs.length} open PR(s)* on \`${launch.github_repo}\` with ≤48h to launch:`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  `🔴 *${openPRs.length} open PR(s)* on \`${launch.github_repo}\` with ≤48h to launch *${launch.name}*:\n\n` +
                  openPRs.map((pr: any) => `• <${pr.url}|#${pr.number} ${pr.title}> — @${pr.author}`).join('\n'),
              },
            },
          ],
        })
        .then(() => db.markPrAlertSent(launch.id))
        .catch((err: Error) =>
          console.error(`[PRCheck] Failed to alert launch ${launch.id}:`, err.message)
        );
    }
  });

  // ─── Legal sign-off SLA: hourly, throttled to once/24h per launch ───────
  cron.schedule('20 * * * *', async () => {
    const launches = db.getLaunchesNeedingLegalEscalation();
    if (launches.length === 0) return;

    console.log(`[LegalSLA] Escalating ${launches.length} launch(es) missing legal sign-off...`);

    for (const launch of launches) {
      await client.chat
        .postMessage({
          channel: launch.channel_id,
          text:
            `⚖️ *Legal sign-off still outstanding* for *${launch.name}* with ≤48h to launch. ` +
            `<@${launch.pm_user_id}> — please follow up in <#${launch.channel_id}> or the legal-review channel.`,
        })
        .then(() => db.markLegalEscalated(launch.id))
        .catch((err: Error) =>
          console.error(`[LegalSLA] Failed to escalate launch ${launch.id}:`, err.message)
        );
    }
  });

  // ─── 24h standup SLA nudge: hourly, throttled to once/24h per item ──────
  cron.schedule('30 * * * *', async () => {
    const overdueItems = db.getItemsAwaitingReply();
    if (overdueItems.length === 0) return;

    console.log(`[StandupSLA] Nudging ${overdueItems.length} item(s) with no reply in 24h...`);

    for (const item of overdueItems) {
      if (!item.owner_id) continue;
      const launch = db.getLaunchById(item.launch_id);
      if (!launch) continue;

      // Re-DM the owner
      await client.chat
        .postMessage({
          channel: item.owner_id,
          text:
            `⏰ *Still waiting on a reply* for *${item.title}* (${launch.name}) — ` +
            `no response in 24h. Could you give a quick status update?`,
        })
        .catch((err: Error) =>
          console.error(`[StandupSLA] DM nudge failed for ${item.owner_id}:`, err.message)
        );

      // Surface it to the PM in the launch channel too
      await client.chat
        .postMessage({
          channel: launch.channel_id,
          text: `⏰ <@${item.owner_id}> hasn't responded to the standup check-in for *${item.title}* in 24h.`,
        })
        .then(() => db.markItemEscalated(item.id))
        .catch((err: Error) =>
          console.error(`[StandupSLA] Channel alert failed for item ${item.id}:`, err.message)
        );
    }
  });

  // ─── Retro check: daily at 10am, find launches 7+ days post-launch ──────
  cron.schedule('0 10 * * *', async () => {
    console.log('[Retro] Checking for launches needing a retro...');

    const launchesNeedingRetro = db.getLaunchesNeedingRetro(7);

    for (const launch of launchesNeedingRetro) {
      await postRetroPrompt(client, launch);
      console.log(`[Retro] Posted retro prompt for launch ${launch.id} (${launch.name})`);
    }
  });

  // ─── Phase check: daily at 8am, sync phase transitions for active launches ───
  cron.schedule('0 8 * * *', async () => {
    console.log('[Phase] Checking phase transitions for active launches...');
    const activeLaunches = db.getAllActiveLaunches();
    for (const launch of activeLaunches) {
      await checkAndSyncPhase(client, launch);
    }
  });
}
