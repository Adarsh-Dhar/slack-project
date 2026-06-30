// services/scheduler.js
//
// Scheduled jobs for phase synchronization and retro prompts.
// @ts-nocheck

import cron from 'node-cron';
import * as db from '../db/index.js';
import { checkAndSyncPhase } from './phaseManager.js';
import { postRetroPrompt } from './retro.js';

let phaseSyncTask = null;
let retroCheckTask = null;

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
  console.log('[scheduler] Scheduled jobs stopped');
}
