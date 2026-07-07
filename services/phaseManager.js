// services/phaseManager.js
//
// Computes which phase a launch should be in based on today's date,
// and syncs sub-channel membership to match.
// @ts-nocheck

import { differenceInCalendarDays } from 'date-fns';
import * as db from '../db/index.js';
import { config } from '../config.js';
import { postLaunchDayRunbook } from './runbook.js';

const PHASE_ORDER = ['discovery', 'build', 'prelaunch', 'gonogo', 'launchday'];

export function calculatePhase(launchDate) {
  const daysUntilLaunch = differenceInCalendarDays(new Date(launchDate), new Date());
  const b = config.PHASE_BOUNDARIES_DAYS;

  if (daysUntilLaunch >= b.discovery) return 'discovery';
  if (daysUntilLaunch >= b.build) return 'build';
  if (daysUntilLaunch >= b.prelaunch) return 'prelaunch';
  if (daysUntilLaunch >= b.gonogo) return 'gonogo';
  return 'launchday';
}

export async function resolveTeamMembers(client, launchId, team) {
  const usergroupId = config.TEAM_USERGROUP_MAP[team];

  if (usergroupId) {
    try {
      const result = await client.usergroups.users.list({ usergroup: usergroupId });
      if (result.users && result.users.length > 0) return result.users;
    } catch (err) {
      console.warn(`[phaseManager] Failed to resolve usergroup for ${team}:`, err);
    }
  }

  const roster = db.getTeamRoster(launchId, team);
  if (roster?.manual_user_ids) {
    return JSON.parse(roster.manual_user_ids);
  }

  return [];
}

function findSubChannelForTeam(launchId, team) {
  const channels = db.getStakeholderChannels(launchId);
  const match = channels.find(c => c.team === team);
  return match?.channel_id ?? null;
}

export async function syncMembersForPhaseChange(client, launch, oldPhase, newPhase) {
  const oldTeams = new Set(config.PHASE_TEAM_MAP[oldPhase]);
  const newTeams = new Set(config.PHASE_TEAM_MAP[newPhase]);

  const teamsToAdd = [...newTeams].filter(t => !oldTeams.has(t));
  const teamsToRemove = [...oldTeams].filter(t => !newTeams.has(t));

  const addedUsers = [];
  const removedUsers = [];

  for (const team of teamsToAdd) {
    const channelId = findSubChannelForTeam(launch.id, team);
    if (!channelId) continue;

    const userIds = await resolveTeamMembers(client, launch.id, team);
    if (userIds.length === 0) continue;

    await client.conversations
      .invite({ channel: channelId, users: userIds.join(',') })
      .catch(err => console.warn(`[phaseManager] Invite failed for ${team}:`, err));

    addedUsers.push(...userIds);
  }

  for (const team of teamsToRemove) {
    const channelId = findSubChannelForTeam(launch.id, team);
    if (!channelId) continue;

    const userIds = await resolveTeamMembers(client, launch.id, team);

    for (const userId of userIds) {
      if (userId === launch.pm_user_id) continue; // never remove the PM

      await client.conversations
        .kick({ channel: channelId, user: userId })
        .catch(err => console.warn(`[phaseManager] Kick failed for ${userId} in ${team}:`, err));

      removedUsers.push(userId);
    }
  }

  return { added: addedUsers, removed: removedUsers };
}

export async function announcePhaseChange(client, launch, newPhase, added, removed) {
  const phaseLabels = {
    discovery: 'Discovery & Scoping',
    build: 'Build & Alignment',
    prelaunch: 'Pre-launch Prep',
    gonogo: 'Go / No-Go',
    launchday: 'Launch Day',
  };

  let text = `*${launch.name} has entered Phase: ${phaseLabels[newPhase]}*\n`;
  if (added.length > 0) {
    text += `\nAdded to relevant channels: ${[...new Set(added)].map(u => `<@${u}>`).join(', ')}`;
  }
  if (removed.length > 0) {
    text += `\nRotated out (phase complete): ${[...new Set(removed)].map(u => `<@${u}>`).join(', ')}`;
  }

  await client.chat.postMessage({ channel: launch.channel_id, text });

  // Notify every sub-channel touched by this phase's roster change, not
  // just main. syncMembersForPhaseChange already tells us which teams
  // changed; cross-reference against the launch's registered sub-channels.
  const touchedTeams = new Set([
    ...config.PHASE_TEAM_MAP[newPhase],
    ...(config.PHASE_TEAM_MAP[PHASE_ORDER[PHASE_ORDER.indexOf(newPhase) - 1]] ?? []),
  ]);
  const subChannels = db.getStakeholderChannels(launch.id)
    .filter(c => touchedTeams.has(c.team));

  for (const sc of subChannels) {
    await client.chat.postMessage({
      channel: sc.channel_id,
      text: `*${launch.name}* has entered Phase: ${phaseLabels[newPhase]}.`,
    }).catch(err => console.warn(`[phaseManager] Sub-channel notify failed for ${sc.channel_id}:`, err.message));
  }
}

export async function checkAndSyncPhase(client, launch) {
  const newPhase = calculatePhase(launch.launch_date);

  if (newPhase === launch.current_phase) return;

  const oldIndex = PHASE_ORDER.indexOf(launch.current_phase);
  const newIndex = PHASE_ORDER.indexOf(newPhase);
  if (newIndex < oldIndex) {
    console.warn(
      `[phaseManager] Launch ${launch.id} computed phase ${newPhase} is before current ${launch.current_phase}. Skipping auto-sync — use /launch-phase to force if intentional.`
    );
    return;
  }

  const { added, removed } = await syncMembersForPhaseChange(
    client, launch, launch.current_phase, newPhase
  );

  db.updateLaunchPhase(launch.id, newPhase);
  await announcePhaseChange(client, launch, newPhase, added, removed);

  // Once a launch crosses into launchday, post the runbook and repurpose
  // the main channel as the war room.
  if (newPhase === 'launchday') {
    await postLaunchDayRunbook(client, launch).catch(err =>
      console.error(`[phaseManager] Failed to post runbook for launch ${launch.id}:`, err)
    );
  }
}
