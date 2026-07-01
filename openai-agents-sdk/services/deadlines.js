// services/deadlines.js
//
// Computes, for each active launch, whether any configured deadline
// reminder (config.DEADLINE_REMINDERS) should fire today, and posts it
// into the relevant sub-channel plus DMs the team roster. Mirrors the
// PR-check pattern in scheduler.js. Uses the notified_deadlines table so
// a reminder only ever posts once per launch.
// @ts-nocheck

import { differenceInCalendarDays } from 'date-fns';
import * as db from '../db/index.js';
import { config } from '../config.js';
import { resolveTeamMembers } from './phaseManager.js';

function findSubChannelForTeam(launchId, team) {
  const channels = db.getStakeholderChannels(launchId);
  const match = channels.find(c => c.team === team);
  return match?.channel_id ?? null;
}

/**
 * Check every configured deadline reminder against every active launch,
 * and post/DM the ones that have just crossed their threshold.
 */
export async function checkDeadlines(client) {
  const activeLaunches = db.getAllActiveLaunches();

  for (const launch of activeLaunches) {
    for (const [deadlineKey, reminder] of Object.entries(config.DEADLINE_REMINDERS)) {
      if (db.hasDeadlineBeenNotified(launch.id, deadlineKey)) continue;

      const boundaryDays = config.PHASE_BOUNDARIES_DAYS[reminder.phase];
      if (boundaryDays === undefined) continue;

      const daysUntilBoundary = differenceInCalendarDays(new Date(launch.launch_date), new Date()) - boundaryDays;
      if (daysUntilBoundary > reminder.daysBeforeBoundary) continue; // not yet within the window
      if (daysUntilBoundary < 0) continue; // boundary already passed without us catching it; skip rather than post stale reminder

      await fireDeadlineReminder(client, launch, deadlineKey, reminder, daysUntilBoundary);
    }
  }
}

async function fireDeadlineReminder(client, launch, deadlineKey, reminder, daysRemaining) {
  const text = reminder.message
    .replace('{days}', String(Math.max(daysRemaining, 0)))
    .replace('{launchName}', launch.name);

  const targetChannel = reminder.team
    ? findSubChannelForTeam(launch.id, reminder.team) ?? launch.channel_id
    : launch.channel_id;

  await client.chat.postMessage({ channel: targetChannel, text }).catch(err =>
    console.error(`[deadlines] Failed to post ${deadlineKey} reminder for launch ${launch.id}:`, err)
  );

  if (reminder.team) {
    const userIds = await resolveTeamMembers(client, launch.id, reminder.team);
    for (const userId of userIds) {
      await client.chat.postMessage({ channel: userId, text }).catch(err =>
        console.warn(`[deadlines] DM failed for ${userId} (${deadlineKey}):`, err.message)
      );
    }
  }

  db.markDeadlineNotified(launch.id, deadlineKey);
}