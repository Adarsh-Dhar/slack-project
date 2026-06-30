// db/index.js
// @ts-nocheck
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.DB_PATH || './launchbot.db';
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Run schema migration on startup
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ─── Launch helpers ──────────────────────────────────────────────────────────

export function createLaunch(input) {
  const stmt = db.prepare(
    `INSERT INTO launches (name, channel_id, launch_date, pm_user_id, tier)
     VALUES (@name, @channelId, @launchDate, @pmUserId, @tier)`
  );
  const result = stmt.run(input);
  return result.lastInsertRowid;
}

export function getLaunchByChannel(channelId) {
  return db
    .prepare('SELECT * FROM launches WHERE channel_id = ?')
    .get(channelId);
}

export function getLaunchById(id) {
  return db
    .prepare('SELECT * FROM launches WHERE id = ?')
    .get(id);
}

export function getAllActiveLaunches() {
  return db
    .prepare(`SELECT * FROM launches WHERE status = 'active'`)
    .all();
}

export function updateLaunchCanvas(launchId, canvasId) {
  db.prepare('UPDATE launches SET canvas_id = ? WHERE id = ?').run(canvasId, launchId);
}

export function updateLaunchStatus(launchId, status) {
  db.prepare('UPDATE launches SET status = ? WHERE id = ?').run(status, launchId);
}

// ─── Retro helpers ────────────────────────────────────────────────────────────

export function markRetroScheduled(launchId, scheduledFor) {
  db.prepare(
    `UPDATE launches SET status = 'retro_pending', retro_scheduled_for = ? WHERE id = ?`
  ).run(scheduledFor, launchId);
}

export function saveOutcomeAndArchive(launchId, outcomeSummary) {
  db.prepare(
    `UPDATE launches
     SET status = 'archived', outcome_summary = ?, retro_completed_at = datetime('now')
     WHERE id = ?`
  ).run(outcomeSummary, launchId);
}

export function getLaunchesNeedingRetro(daysAfterLaunch) {
  return db
    .prepare(
      `SELECT * FROM launches
       WHERE status = 'launched'
       AND date(launch_date, '+' || ? || ' days') <= date('now')`
    )
    .all(daysAfterLaunch);
}

// ─── Item helpers ────────────────────────────────────────────────────────────

export function createItem(input) {
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
  return result.lastInsertRowid;
}

export function getItemsByLaunch(launchId) {
  return db
    .prepare('SELECT * FROM items WHERE launch_id = ? ORDER BY team, id')
    .all(launchId);
}

export function updateItemStatus(itemId, status) {
  db.prepare('UPDATE items SET status = ? WHERE id = ?').run(status, itemId);
}

export function updateItemOwner(itemId, ownerId) {
  db.prepare('UPDATE items SET owner_id = ? WHERE id = ?').run(ownerId, itemId);
}

export function getItemsForOwner(launchId, ownerId) {
  return db
    .prepare(
      `SELECT * FROM items WHERE launch_id = ? AND owner_id = ? AND status != 'done'`
    )
    .all(launchId, ownerId);
}

// ─── Stakeholder channel helpers ─────────────────────────────────────────────

export function addStakeholderChannel(input) {
  db.prepare(
    'INSERT OR IGNORE INTO stakeholder_channels (launch_id, channel_id, team) VALUES (?, ?, ?)'
  ).run(input.launchId, input.channelId, input.team);
}

export function getStakeholderChannels(launchId) {
  return db
    .prepare(
      'SELECT * FROM stakeholder_channels WHERE launch_id = ?'
    )
    .all(launchId);
}

export function getLaunchByStakeholderChannel(channelId) {
  const row = db
    .prepare(
      'SELECT launch_id FROM stakeholder_channels WHERE channel_id = ?'
    )
    .get(channelId);
  return row ? getLaunchById(row.launch_id) : undefined;
}

// ─── Phase & roster helpers ─────────────────────────────────────────────────────

export function updateLaunchPhase(launchId, phase) {
  db.prepare(`UPDATE launches SET current_phase = ? WHERE id = ?`).run(phase, launchId);
}

export function setTeamRoster(launchId, team, usergroupId, manualUserIds) {
  db.prepare(
    `INSERT INTO team_rosters (launch_id, team, usergroup_id, manual_user_ids)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(launch_id, team) DO UPDATE SET
       usergroup_id = excluded.usergroup_id,
       manual_user_ids = excluded.manual_user_ids`
  ).run(launchId, team, usergroupId, JSON.stringify(manualUserIds));
}

export function getTeamRoster(launchId, team) {
  return db
    .prepare(
      `SELECT * FROM team_rosters WHERE launch_id = ? AND team = ?`
    )
    .get(launchId, team);
}

export function getAllRostersForLaunch(launchId) {
  return db
    .prepare(`SELECT * FROM team_rosters WHERE launch_id = ?`)
    .all(launchId);
}
