// src/db/index.ts
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import type {
  LaunchRow, ItemRow, StakeholderChannelRow, TeamRosterRow,
  CreateLaunchInput, CreateItemInput, AddStakeholderChannelInput,
  ItemStatus, LaunchStatus, LaunchPhase, TeamName,
} from '../types';

const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');

// Run schema migration on startup
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ─── Launch helpers ──────────────────────────────────────────────────────────

export function createLaunch(input: CreateLaunchInput): number {
  const stmt = db.prepare<CreateLaunchInput>(
    `INSERT INTO launches (name, channel_id, launch_date, pm_user_id, tier)
     VALUES (@name, @channelId, @launchDate, @pmUserId, @tier)`
  );
  const result = stmt.run(input);
  return result.lastInsertRowid as number;
}

export function getLaunchByChannel(channelId: string): LaunchRow | undefined {
  return db
    .prepare<string, LaunchRow>('SELECT * FROM launches WHERE channel_id = ?')
    .get(channelId);
}

export function getLaunchById(id: number): LaunchRow | undefined {
  return db
    .prepare<number, LaunchRow>('SELECT * FROM launches WHERE id = ?')
    .get(id);
}

export function getAllActiveLaunches(): LaunchRow[] {
  return db
    .prepare<[], LaunchRow>(`SELECT * FROM launches WHERE status = 'active'`)
    .all();
}

export function updateLaunchCanvas(launchId: number, canvasId: string): void {
  db.prepare('UPDATE launches SET canvas_id = ? WHERE id = ?').run(canvasId, launchId);
}

export function updateLaunchStatus(launchId: number, status: LaunchStatus): void {
  db.prepare('UPDATE launches SET status = ? WHERE id = ?').run(status, launchId);
}

// ─── Retro helpers ────────────────────────────────────────────────────────────

export function markRetroScheduled(launchId: number, scheduledFor: string): void {
  db.prepare(
    `UPDATE launches SET status = 'retro_pending', retro_scheduled_for = ? WHERE id = ?`
  ).run(scheduledFor, launchId);
}

export function saveOutcomeAndArchive(
  launchId: number,
  outcomeSummary: string
): void {
  db.prepare(
    `UPDATE launches
     SET status = 'archived', outcome_summary = ?, retro_completed_at = datetime('now')
     WHERE id = ?`
  ).run(outcomeSummary, launchId);
}

/**
 * Launches that are 'launched' status and whose launch_date was
 * exactly N days ago (default 7) — these need a retro prompt.
 */
export function getLaunchesNeedingRetro(daysAfterLaunch: number): LaunchRow[] {
  return db
    .prepare<number, LaunchRow>(
      `SELECT * FROM launches
       WHERE status = 'launched'
       AND date(launch_date, '+' || ? || ' days') <= date('now')`
    )
    .all(daysAfterLaunch);
}

// ─── Item helpers ────────────────────────────────────────────────────────────

export function createItem(input: CreateItemInput): number {
  const stmt = db.prepare(
    `INSERT INTO items (launch_id, team, title, owner_id, due_date, status)
     VALUES (@launchId, @team, @title, @ownerId, @dueDate, @status)`
  );
  const result = stmt.run({
    launchId: input.launchId,
    team: input.team,
    title: input.title,
    ownerId: input.ownerId ?? null,
    dueDate: input.dueDate ?? null,
    status: input.status ?? 'not_started',
  });
  return result.lastInsertRowid as number;
}

export function getItemsByLaunch(launchId: number): ItemRow[] {
  return db
    .prepare<number, ItemRow>('SELECT * FROM items WHERE launch_id = ? ORDER BY team, id')
    .all(launchId);
}

export function updateItemStatus(itemId: number, status: ItemStatus): void {
  db.prepare('UPDATE items SET status = ? WHERE id = ?').run(status, itemId);
}

export function updateItemOwner(itemId: number, ownerId: string): void {
  db.prepare('UPDATE items SET owner_id = ? WHERE id = ?').run(ownerId, itemId);
}

export function getItemsForOwner(launchId: number, ownerId: string): ItemRow[] {
  return db
    .prepare<[number, string], ItemRow>(
      `SELECT * FROM items WHERE launch_id = ? AND owner_id = ? AND status != 'done'`
    )
    .all(launchId, ownerId);
}

// ─── Stakeholder channel helpers ─────────────────────────────────────────────

export function addStakeholderChannel(input: AddStakeholderChannelInput): void {
  db.prepare(
    'INSERT OR IGNORE INTO stakeholder_channels (launch_id, channel_id, team) VALUES (?, ?, ?)'
  ).run(input.launchId, input.channelId, input.team);
}

export function getStakeholderChannels(launchId: number): StakeholderChannelRow[] {
  return db
    .prepare<number, StakeholderChannelRow>(
      'SELECT * FROM stakeholder_channels WHERE launch_id = ?'
    )
    .all(launchId);
}

export function getLaunchByStakeholderChannel(channelId: string): LaunchRow | undefined {
  const row = db
    .prepare<string, { launch_id: number }>(
      'SELECT launch_id FROM stakeholder_channels WHERE channel_id = ?'
    )
    .get(channelId);
  return row ? getLaunchById(row.launch_id) : undefined;
}

// ─── Phase & roster helpers ─────────────────────────────────────────────────────

export function updateLaunchPhase(launchId: number, phase: LaunchPhase): void {
  db.prepare(`UPDATE launches SET current_phase = ? WHERE id = ?`).run(phase, launchId);
}

export function setTeamRoster(
  launchId: number,
  team: TeamName,
  usergroupId: string | null,
  manualUserIds: string[]
): void {
  db.prepare(
    `INSERT INTO team_rosters (launch_id, team, usergroup_id, manual_user_ids)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(launch_id, team) DO UPDATE SET
       usergroup_id = excluded.usergroup_id,
       manual_user_ids = excluded.manual_user_ids`
  ).run(launchId, team, usergroupId, JSON.stringify(manualUserIds));
}

export function getTeamRoster(launchId: number, team: TeamName): TeamRosterRow | undefined {
  return db
    .prepare<[number, string], TeamRosterRow>(
      `SELECT * FROM team_rosters WHERE launch_id = ? AND team = ?`
    )
    .get(launchId, team);
}

export function getAllRostersForLaunch(launchId: number): TeamRosterRow[] {
  return db
    .prepare<number, TeamRosterRow>(`SELECT * FROM team_rosters WHERE launch_id = ?`)
    .all(launchId);
}
