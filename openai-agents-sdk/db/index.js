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
    `INSERT INTO launches (name, channel_id, launch_date, pm_user_id, tier, github_repo)
     VALUES (@name, @channelId, @launchDate, @pmUserId, @tier, @githubRepo)`
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

export function getLaunchByName(name) {
  return db
    .prepare('SELECT * FROM launches WHERE name = ?')
    .get(name);
}

export function getLaunchByNameFuzzy(name) {
  // Try exact match first
  const exact = db.prepare('SELECT * FROM launches WHERE name = ?').get(name);
  if (exact) return exact;
  
  // Try case-insensitive match
  const caseInsensitive = db.prepare('SELECT * FROM launches WHERE LOWER(name) = LOWER(?)').get(name);
  if (caseInsensitive) return caseInsensitive;
  
  // Try with spaces instead of hyphens
  const withSpaces = db.prepare('SELECT * FROM launches WHERE LOWER(name) = LOWER(?)').get(name.replace(/-/g, ' '));
  if (withSpaces) return withSpaces;
  
  // Try with hyphens instead of spaces
  const withHyphens = db.prepare('SELECT * FROM launches WHERE LOWER(name) = LOWER(?)').get(name.replace(/\s+/g, '-'));
  if (withHyphens) return withHyphens;
  
  return null;
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
  db.prepare('UPDATE items SET status = ?, last_notified_at = datetime(\'now\') WHERE id = ?').run(status, itemId);
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

export function markItemNotified(itemId) {
  db.prepare(`UPDATE items SET last_notified_at = datetime('now'), notify_count = notify_count + 1 WHERE id = ?`).run(itemId);
}

export function getStaleItems(hoursThreshold) {
  return db.prepare(`
    SELECT * FROM items
    WHERE status NOT IN ('done')
      AND owner_id IS NOT NULL
      AND (last_notified_at IS NULL OR last_notified_at <= datetime('now', '-' || ? || ' hours'))
  `).all(hoursThreshold);
}

// ─── Go/No-Go helpers ────────────────────────────────────────────────────────

export function getLaunchesNeedingGoNoGo(daysBefore) {
  return db.prepare(`
    SELECT * FROM launches
    WHERE status = 'active'
      AND (gonogo_posted_for IS NULL OR gonogo_posted_for != date('now'))
      AND date(launch_date, '-' || ? || ' days') <= date('now')
  `).all(daysBefore);
}

export function markGoNoGoPosted(launchId, messageTs) {
  db.prepare(
    `UPDATE launches SET gonogo_posted_for = date('now'), gonogo_message_ts = ? WHERE id = ?`
  ).run(messageTs, launchId);
}

export function updateGoNoGoMessageTs(launchId, messageTs) {
  db.prepare(`UPDATE launches SET gonogo_message_ts = ? WHERE id = ?`).run(messageTs, launchId);
}

export function upsertGoNoGoResponse(itemId, launchId, status, respondedBy) {
  db.prepare(
    `INSERT INTO gonogo_responses (item_id, launch_id, status, responded_by, responded_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(item_id) DO UPDATE SET
       status = excluded.status,
       responded_by = excluded.responded_by,
       responded_at = excluded.responded_at`
  ).run(itemId, launchId, status, respondedBy);
}

export function getGoNoGoResponses(launchId) {
  return db.prepare('SELECT * FROM gonogo_responses WHERE launch_id = ?').all(launchId);
}

export function getGoNoGoResponseForItem(itemId) {
  return db.prepare('SELECT * FROM gonogo_responses WHERE item_id = ?').get(itemId);
}

export function createOverrideRequest(input) {
  const stmt = db.prepare(
    `INSERT INTO gonogo_overrides (launch_id, item_id, requested_by, reason)
     VALUES (@launchId, @itemId, @requestedBy, @reason)`
  );
  const result = stmt.run({
    launchId: input.launchId,
    itemId: input.itemId,
    requestedBy: input.requestedBy,
    reason: input.reason ?? null,
  });
  return result.lastInsertRowid;
}

export function getOverrideRequest(id) {
  return db.prepare('SELECT * FROM gonogo_overrides WHERE id = ?').get(id);
}

export function resolveOverrideRequest(id, status, resolvedBy) {
  db.prepare(
    `UPDATE gonogo_overrides SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`
  ).run(status, resolvedBy, id);
}

// ─── Deadline reminder helpers ───────────────────────────────────────────────

export function hasDeadlineBeenNotified(launchId, deadlineKey) {
  const row = db
    .prepare('SELECT 1 FROM notified_deadlines WHERE launch_id = ? AND deadline_key = ?')
    .get(launchId, deadlineKey);
  return !!row;
}

export function markDeadlineNotified(launchId, deadlineKey) {
  db.prepare(
    `INSERT INTO notified_deadlines (launch_id, deadline_key) VALUES (?, ?)
     ON CONFLICT(launch_id, deadline_key) DO NOTHING`
  ).run(launchId, deadlineKey);
}

// ─── Feedback helpers ────────────────────────────────────────────────────────

export function addFeedback({ launchId, userId, sentiment, text }) {
  db.prepare(
    `INSERT INTO feedback (launch_id, user_id, sentiment, text)
     VALUES (?, ?, ?, ?)`
  ).run(launchId, userId, sentiment, text);
}

export function getFeedbackForLaunch(launchId) {
  return db
    .prepare('SELECT * FROM feedback WHERE launch_id = ? ORDER BY created_at ASC')
    .all(launchId);
}
