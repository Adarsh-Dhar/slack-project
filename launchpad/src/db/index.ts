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

// CREATE TABLE IF NOT EXISTS won't add new columns to a pre-existing DB file,
// so patch them in here for upgrades. Safe to run repeatedly.
function ensureColumn(table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('launches', 'github_repo', 'github_repo TEXT');
ensureColumn('launches', 'legal_signoff_required', 'legal_signoff_required INTEGER DEFAULT 0');
ensureColumn('launches', 'legal_signed_off_at', 'legal_signed_off_at TEXT');
ensureColumn('launches', 'last_pr_alert_at', 'last_pr_alert_at TEXT');
ensureColumn('launches', 'last_legal_escalated_at', 'last_legal_escalated_at TEXT');
ensureColumn('items', 'last_dm_sent_at', 'last_dm_sent_at TEXT');
ensureColumn('items', 'last_dm_acked_at', 'last_dm_acked_at TEXT');
ensureColumn('items', 'last_escalated_at', 'last_escalated_at TEXT');

// ─── Launch helpers ──────────────────────────────────────────────────────────

export function createLaunch(input: CreateLaunchInput): number {
  const stmt = db.prepare(
    `INSERT INTO launches (name, channel_id, launch_date, pm_user_id, tier, github_repo, legal_signoff_required)
     VALUES (@name, @channelId, @launchDate, @pmUserId, @tier, @githubRepo, @legalSignoffRequired)`
  );
  const result = stmt.run({
    name: input.name,
    channelId: input.channelId,
    launchDate: input.launchDate,
    pmUserId: input.pmUserId,
    tier: input.tier,
    githubRepo: input.githubRepo ?? null,
    legalSignoffRequired: input.legalSignoffRequired ? 1 : 0,
  });
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

// ─── Standup SLA helpers ─────────────────────────────────────────────────────

export function markStandupDmSent(itemId: number): void {
  db.prepare(`UPDATE items SET last_dm_sent_at = datetime('now') WHERE id = ?`).run(itemId);
}

export function markStandupAcked(itemId: number): void {
  db.prepare(`UPDATE items SET last_dm_acked_at = datetime('now') WHERE id = ?`).run(itemId);
}

/**
 * Items whose owner was DM'd a standup check-in 24h+ ago, never acked since
 * (or acked before the most recent DM), still not done, and not already
 * escalated in the last 24h (so the hourly cron doesn't spam).
 */
export function getItemsAwaitingReply(): ItemRow[] {
  return db
    .prepare<[], ItemRow>(
      `SELECT * FROM items
       WHERE owner_id IS NOT NULL
       AND status != 'done'
       AND last_dm_sent_at IS NOT NULL
       AND (last_dm_acked_at IS NULL OR last_dm_acked_at < last_dm_sent_at)
       AND datetime(last_dm_sent_at, '+24 hours') <= datetime('now')
       AND (last_escalated_at IS NULL OR datetime(last_escalated_at, '+24 hours') <= datetime('now'))`
    )
    .all();
}

export function markItemEscalated(itemId: number): void {
  db.prepare(`UPDATE items SET last_escalated_at = datetime('now') WHERE id = ?`).run(itemId);
}

// ─── GitHub PR / legal sign-off SLA helpers ──────────────────────────────────

export function setLaunchGithubRepo(launchId: number, repo: string): void {
  db.prepare(`UPDATE launches SET github_repo = ? WHERE id = ?`).run(repo, launchId);
}

export function markLegalSignedOff(launchId: number): void {
  db.prepare(
    `UPDATE launches SET legal_signed_off_at = datetime('now') WHERE id = ?`
  ).run(launchId);
}

export function markPrAlertSent(launchId: number): void {
  db.prepare(
    `UPDATE launches SET last_pr_alert_at = datetime('now') WHERE id = ?`
  ).run(launchId);
}

export function markLegalEscalated(launchId: number): void {
  db.prepare(
    `UPDATE launches SET last_legal_escalated_at = datetime('now') WHERE id = ?`
  ).run(launchId);
}

/**
 * Active/approved launches whose github_repo is set and haven't had a PR
 * alert posted in the last 24h (throttle — the cron that calls this runs
 * hourly once inside the 48h pre-launch window).
 */
export function getLaunchesNeedingPrCheck(): LaunchRow[] {
  return db
    .prepare<[], LaunchRow>(
      `SELECT * FROM launches
       WHERE status IN ('active', 'approved')
       AND github_repo IS NOT NULL
       AND date(launch_date, '-2 days') <= date('now')
       AND date(launch_date) >= date('now')
       AND (last_pr_alert_at IS NULL OR datetime(last_pr_alert_at, '+24 hours') <= datetime('now'))`
    )
    .all();
}

/**
 * Active/approved launches that require legal signoff, haven't gotten it,
 * are within the legal-SLA window (gonogo phase boundary), and haven't been
 * escalated in the last 24h.
 */
export function getLaunchesNeedingLegalEscalation(): LaunchRow[] {
  return db
    .prepare<[], LaunchRow>(
      `SELECT * FROM launches
       WHERE status IN ('active', 'approved')
       AND legal_signoff_required = 1
       AND legal_signed_off_at IS NULL
       AND date(launch_date, '-2 days') <= date('now')
       AND date(launch_date) >= date('now')
       AND (last_legal_escalated_at IS NULL OR datetime(last_legal_escalated_at, '+24 hours') <= datetime('now'))`
    )
    .all();
}
