// services/scheduler.js
//
// Scheduled jobs for phase synchronization and retro prompts.
// @ts-nocheck

import cron from 'node-cron';
import * as db from '../db/index.js';
import { checkAndSyncPhase } from './phaseManager.js';
import { postRetroPrompt } from './retro.js';
import { postGoNoGoCanvas } from './gonogo.js';
import { buildStandupBlocks } from '../utils/blocks.js';
import { getOpenPRs } from './githubPRs.js';
import { differenceInCalendarDays } from 'date-fns';
import { config } from '../config.js';
import { checkDeadlines } from './deadlines.js';

let phaseSyncTask = null;
let retroCheckTask = null;
let standupTask = null;
let slaCheckTask = null;
let prCheckTask = null;
let gonogoCheckTask = null;
let deadlineCheckTask = null;

/**
 * Start the scheduled jobs.
 * @param {import('@slack/web-api').WebClient} client
 */
export function startScheduler(client) {
  // Run phase sync daily at midnight
  phaseSyncTask = cron.schedule('0 0 * * *', async () => {
    console.log('[scheduler] Running daily phase sync...');
    try {
      const activeLaunches = db.getAllActiveLaunches();
      for (const launch of activeLaunches) {
        await checkAndSyncPhase(client, launch);
      }
      console.log(`[scheduler] Phase sync complete for ${activeLaunches.length} launches`);
    } catch (err) {
      console.error('[scheduler] Phase sync error:', err);
    }
  }, {
    timezone: 'UTC',
  });

  // Run retro check daily at 9 AM
  retroCheckTask = cron.schedule('0 9 * * *', async () => {
    console.log('[scheduler] Checking for launches needing retro...');
    try {
      const launchesNeedingRetro = db.getLaunchesNeedingRetro(7);
      for (const launch of launchesNeedingRetro) {
        await postRetroPrompt(client, launch);
      }
      console.log(`[scheduler] Retro prompts posted for ${launchesNeedingRetro.length} launches`);
    } catch (err) {
      console.error('[scheduler] Retro check error:', err);
    }
  }, {
    timezone: 'UTC',
  });

  // Run standup DMs daily at 9 AM on weekdays
  standupTask = cron.schedule('0 9 * * 1-5', async () => {
    console.log('[scheduler] Running daily standup check-ins...');
    try {
      const activeLaunches = db.getAllActiveLaunches();
      for (const launch of activeLaunches) {
        const items = db.getItemsByLaunch(launch.id).filter(i => i.status !== 'done' && i.owner_id);
        const byOwner = new Map();
        for (const item of items) {
          const existing = byOwner.get(item.owner_id) ?? [];
          byOwner.set(item.owner_id, [...existing, item]);
        }
        for (const [ownerId, ownerItems] of byOwner.entries()) {
          const topItem = ownerItems[0];
          await client.chat.postMessage({
            channel: ownerId,
            text: `Daily check-in for ${launch.name}`,
            blocks: buildStandupBlocks({
              itemTitle: topItem.title, launchName: launch.name, launchDate: launch.launch_date,
              itemId: topItem.id, launchId: launch.id,
            }),
          }).catch(err => console.error(`[Standup] DM failed for ${ownerId}:`, err.message));
        }
      }
      console.log('[scheduler] Standup check-ins complete');
    } catch (err) {
      console.error('[scheduler] Standup error:', err);
    }
  }, { timezone: 'UTC' });

  // Run SLA check hourly
  slaCheckTask = cron.schedule('0 * * * *', async () => {
    console.log('[scheduler] Running SLA check...');
    try {
      const stale = db.getStaleItems(24);
      for (const item of stale) {
        const launch = db.getLaunchById(item.launch_id);
        if (!launch) continue;
        await client.chat.postMessage({
          channel: item.owner_id,
          text: `⏰ Reminder: *${item.title}* for *${launch.name}* still needs an update (no reply in 24h+).`,
        }).catch(() => {});
        db.markItemNotified(item.id);
        // Escalation: on 3rd+ nudge, also post to launch channel tagging PM
        if (item.notify_count >= 2) {
          await client.chat.postMessage({
            channel: launch.channel_id,
            text: `🔁 <@${launch.pm_user_id}> — <@${item.owner_id}> hasn't responded on *${item.title}* after multiple reminders.`,
          }).catch(() => {});
        }
      }
      console.log(`[scheduler] SLA check complete for ${stale.length} items`);
    } catch (err) {
      console.error('[scheduler] SLA check error:', err);
    }
  }, { timezone: 'UTC' });

  // Run PR check daily at 9 AM
  prCheckTask = cron.schedule('0 9 * * *', async () => {
    console.log('[scheduler] Running PR check...');
    const activeLaunches = db.getAllActiveLaunches();
    try {
      for (const launch of activeLaunches) {
        if (!launch.github_repo) continue;
        const daysUntil = differenceInCalendarDays(new Date(launch.launch_date), new Date());
        if (daysUntil !== config.GO_NO_GO_DAYS_BEFORE) continue;
        const [owner, repo] = launch.github_repo.split('/');
        try {
          const prs = await getOpenPRs(owner, repo);
          if (prs.length > 0) {
            await client.chat.postMessage({
              channel: launch.channel_id,
              text: `🚨 *${prs.length} open PR(s)* on \`${launch.github_repo}\` with launch in ${daysUntil} day(s):\n` +
                    prs.map(pr => `• <${pr.html_url}|#${pr.number} ${pr.title}>`).join('\n'),
            });
          }
        } catch (err) {
          console.error(`[PRCheck] Failed for ${launch.github_repo}:`, err.message);
        }
      }
      console.log('[scheduler] PR check complete');
    } catch (err) {
      console.error('[scheduler] PR check error:', err);
    }

    // Legal SLA check - same daily 9am tick
    console.log('[scheduler] Running legal SLA check...');
    try {
      for (const launch of activeLaunches) {
        const legalItems = db.getItemsByLaunch(launch.id).filter(i => i.team === 'legal' && i.status !== 'done');
        const overdue = legalItems.filter(i => new Date(i.due_date) < new Date());
        if (overdue.length > 0) {
          await client.chat.postMessage({
            channel: launch.channel_id,
            text: `⚖️ *Legal sign-off overdue* for ${launch.name}: ${overdue.map(i => i.title).join(', ')}`,
          }).catch(() => {});
        }
      }
      console.log('[scheduler] Legal SLA check complete');
    } catch (err) {
      console.error('[scheduler] Legal SLA check error:', err);
    }
  }, { timezone: 'UTC' });

  // Run Go/No-Go canvas check daily at 9 AM — posts the checklist canvas
  // once a launch crosses the T-48h (config.GO_NO_GO_DAYS_BEFORE) boundary.
  gonogoCheckTask = cron.schedule('0 9 * * *', async () => {
    console.log('[scheduler] Running Go/No-Go canvas check...');
    try {
      const dueLaunches = db.getLaunchesNeedingGoNoGo(config.GO_NO_GO_DAYS_BEFORE);
      for (const launch of dueLaunches) {
        await postGoNoGoCanvas(client, launch);
      }
      console.log(`[scheduler] Go/No-Go canvas posted for ${dueLaunches.length} launches`);
    } catch (err) {
      console.error('[scheduler] Go/No-Go canvas error:', err);
    }
  }, { timezone: 'UTC' });

  // Run deadline-reminder check daily at 9 AM — mirrors the PR-check
  // pattern: walk active launches, fire any reminder that just crossed
  // its configured threshold.
  deadlineCheckTask = cron.schedule('0 9 * * *', async () => {
    console.log('[scheduler] Running deadline reminder check...');
    try {
      await checkDeadlines(client);
      console.log('[scheduler] Deadline reminder check complete');
    } catch (err) {
      console.error('[scheduler] Deadline reminder check error:', err);
    }
  }, { timezone: 'UTC' });

  console.log('[scheduler] Scheduled jobs started');
}

/**
 * Stop the scheduled jobs.
 */
export function stopScheduler() {
  if (phaseSyncTask) {
    phaseSyncTask.stop();
    phaseSyncTask = null;
  }
  if (retroCheckTask) {
    retroCheckTask.stop();
    retroCheckTask = null;
  }
  if (standupTask) {
    standupTask.stop();
    standupTask = null;
  }
  if (slaCheckTask) {
    slaCheckTask.stop();
    slaCheckTask = null;
  }
  if (prCheckTask) {
    prCheckTask.stop();
    prCheckTask = null;
  }
  if (gonogoCheckTask) {
    gonogoCheckTask.stop();
    gonogoCheckTask = null;
  }
  if (deadlineCheckTask) {
    deadlineCheckTask.stop();
    deadlineCheckTask = null;
  }
  console.log('[scheduler] Scheduled jobs stopped');
}
