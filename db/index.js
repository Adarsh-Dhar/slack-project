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
  // Check stakeholder_channels first (sub-channels + external # mentions).
  const row = db
    .prepare('SELECT launch_id FROM stakeholder_channels WHERE channel_id = ?')
    .get(channelId);
  if (row) return getLaunchById(row.launch_id);

  // Fallback: check if the channel IS the main launch channel. The main
  // channel lives in launches.channel_id, not stakeholder_channels, so
  // slip-check messages posted there were silently ignored before this.
  const launch = db
    .prepare(`SELECT * FROM launches WHERE channel_id = ? AND status = 'active'`)
    .get(channelId);
  return launch ?? undefined;
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

// ─── Slip event helpers ───────────────────────────────────────────────────────

export function createSlipEvent({ launchId, channelId, detectedUserId, messageText }) {
  const stmt = db.prepare(
    `INSERT INTO slip_events (launch_id, channel_id, detected_user_id, message_text)
     VALUES (@launchId, @channelId, @detectedUserId, @messageText)`
  );
  const result = stmt.run({ launchId, channelId, detectedUserId, messageText });
  return result.lastInsertRowid;
}

export function resolveSlipEvent(id, status, resolvedBy) {
  db.prepare(
    `UPDATE slip_events SET status = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?`
  ).run(status, resolvedBy, id);
}

export function getSlipEvent(id) {
  return db.prepare('SELECT * FROM slip_events WHERE id = ?').get(id);
}

export function getSlipEventsForLaunch(launchId) {
  return db
    .prepare('SELECT * FROM slip_events WHERE launch_id = ? ORDER BY created_at DESC')
    .all(launchId);
}

export function getOpenSlipEventCount(launchId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS n FROM slip_events
       WHERE launch_id = ? AND status IN ('pending', 'confirmed', 'explaining')`
    )
    .get(launchId).n;
}

// ─── KPI / success metric helpers ─────────────────────────────────────────────

export function upsertKpi({ launchId, name, targetValue, unit, updatedBy }) {
  db.prepare(
    `INSERT INTO kpis (launch_id, name, target_value, unit, updated_by)
     VALUES (@launchId, @name, @targetValue, @unit, @updatedBy)
     ON CONFLICT(launch_id, name) DO UPDATE SET
       target_value = excluded.target_value,
       unit = excluded.unit,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  ).run({ launchId, name, targetValue: targetValue ?? null, unit: unit ?? null, updatedBy });
}

export function recordKpiValue({ launchId, name, currentValue, updatedBy }) {
  db.prepare(
    `UPDATE kpis SET current_value = ?, updated_by = ?, updated_at = datetime('now')
     WHERE launch_id = ? AND name = ?`
  ).run(currentValue, updatedBy, launchId, name);
}

export function getKpisForLaunch(launchId) {
  return db
    .prepare('SELECT * FROM kpis WHERE launch_id = ? ORDER BY created_at ASC')
    .all(launchId);
}

// ─── Cross-launch / portfolio helpers ─────────────────────────────────────────

export function getAllLaunches() {
  return db.prepare('SELECT * FROM launches ORDER BY launch_date ASC').all();
}

export function getLaunchesByPm(pmUserId) {
  return db
    .prepare(`SELECT * FROM launches WHERE pm_user_id = ? AND status != 'archived' ORDER BY launch_date ASC`)
    .all(pmUserId);
}

export function getPortfolioSnapshot() {
  // One row per non-archived launch with item completion + red-item + open
  // slip-event counts, for the cross-launch /launch-portfolio view and for
  // services/report.js.
  return db
    .prepare(
      `SELECT
         l.id, l.name, l.channel_id, l.launch_date, l.pm_user_id, l.tier,
         l.status, l.current_phase,
         (SELECT COUNT(*) FROM items i WHERE i.launch_id = l.id) AS total_items,
         (SELECT COUNT(*) FROM items i WHERE i.launch_id = l.id AND i.status = 'done') AS done_items,
         (SELECT COUNT(*) FROM gonogo_responses g WHERE g.launch_id = l.id AND g.status = 'red') AS red_items,
         (SELECT COUNT(*) FROM slip_events s WHERE s.launch_id = l.id AND s.status IN ('pending','confirmed','explaining')) AS open_slips
       FROM launches l
       WHERE l.status != 'archived'
       ORDER BY l.launch_date ASC`
    )
    .all();
}

// ─── Comms log helpers ────────────────────────────────────────────────────────

export function logComms({ launchId, channel, status, triggeredBy, detail }) {
  db.prepare(
    `INSERT INTO comms_log (launch_id, channel, status, triggered_by, detail)
     VALUES (?, ?, ?, ?, ?)`
  ).run(launchId, channel, status, triggeredBy, detail ?? null);
}

export function getCommsLog(launchId) {
  return db.prepare('SELECT * FROM comms_log WHERE launch_id = ? ORDER BY created_at DESC').all(launchId);
}

// ─── Budget helpers ───────────────────────────────────────────────────────────

export function upsertBudgetItem({ launchId, category, approvedAmount, approver, updatedBy }) {
  db.prepare(
    `INSERT INTO budget_items (launch_id, category, approved_amount, approver, updated_by)
     VALUES (@launchId, @category, @approvedAmount, @approver, @updatedBy)
     ON CONFLICT(launch_id, category) DO UPDATE SET
       approved_amount = excluded.approved_amount,
       approver = excluded.approver,
       updated_by = excluded.updated_by,
       updated_at = datetime('now')`
  ).run({ launchId, category, approvedAmount: approvedAmount ?? null, approver: approver ?? null, updatedBy });
}

export function recordSpend({ launchId, category, spentAmount, updatedBy }) {
  db.prepare(
    `UPDATE budget_items SET spent_amount = ?, updated_by = ?, updated_at = datetime('now')
     WHERE launch_id = ? AND category = ?`
  ).run(spentAmount, updatedBy, launchId, category);
}

export function getBudgetForLaunch(launchId) {
  return db.prepare('SELECT * FROM budget_items WHERE launch_id = ? ORDER BY created_at ASC').all(launchId);
}

// ─── CS readiness helpers ─────────────────────────────────────────────────────

export function upsertCsReadinessItem({ launchId, item, link, status, updatedBy }) {
  db.prepare(
    `INSERT INTO cs_readiness_items (launch_id, item, link, status, updated_by)
     VALUES (@launchId, @item, @link, @status, @updatedBy)
     ON CONFLICT(launch_id, item) DO UPDATE SET
       link = excluded.link, status = excluded.status,
       updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).run({ launchId, item, link: link ?? null, status: status ?? 'not_started', updatedBy });
}

export function getCsReadinessForLaunch(launchId) {
  return db.prepare('SELECT * FROM cs_readiness_items WHERE launch_id = ? ORDER BY created_at ASC').all(launchId);
}

// ─── Risk helpers ─────────────────────────────────────────────────────────────

export function upsertRiskItem({ launchId, category, level, note, updatedBy }) {
  db.prepare(
    `INSERT INTO risk_items (launch_id, category, level, note, updated_by)
     VALUES (@launchId, @category, @level, @note, @updatedBy)
     ON CONFLICT(launch_id, category) DO UPDATE SET
       level = excluded.level, note = excluded.note,
       updated_by = excluded.updated_by, updated_at = datetime('now')`
  ).run({ launchId, category, level, note: note ?? null, updatedBy });
}

export function getRiskItemsForLaunch(launchId) {
  return db.prepare('SELECT * FROM risk_items WHERE launch_id = ? ORDER BY created_at ASC').all(launchId);
}

// ─── Budget approval helper ───────────────────────────────────────────────────

export function setBudgetApproval({ launchId, category, status, approver }) {
  db.prepare(
    `UPDATE budget_items SET approval_status = ?, approver = ?, updated_at = datetime('now')
     WHERE launch_id = ? AND category = ?`
  ).run(status, approver, launchId, category);
}

// ─── Content review helpers ───────────────────────────────────────────────────

export function submitContentForReview({ launchId, contentType, link, submittedBy }) {
  db.prepare(
    `INSERT INTO content_reviews (launch_id, content_type, link, submitted_by)
     VALUES (@launchId, @contentType, @link, @submittedBy)
     ON CONFLICT(launch_id, content_type) DO UPDATE SET
       link = excluded.link, submitted_by = excluded.submitted_by,
       status = 'pending', updated_at = datetime('now')`
  ).run({ launchId, contentType, link, submittedBy });
}

export function setContentReviewStatus({ launchId, contentType, status, reviewer, note }) {
  db.prepare(
    `UPDATE content_reviews SET status = ?, reviewer = ?, note = ?, updated_at = datetime('now')
     WHERE launch_id = ? AND content_type = ?`
  ).run(status, reviewer, note ?? null, launchId, contentType);
}

export function getContentReviews(launchId) {
  return db.prepare('SELECT * FROM content_reviews WHERE launch_id = ? ORDER BY created_at ASC').all(launchId);
}

// ─── Slip events (open query) ─────────────────────────────────────────────────

export function getOpenSlipEvents(launchId) {
  return db.prepare(
    `SELECT * FROM slip_events WHERE launch_id = ? AND status IN ('pending','confirmed','explaining') ORDER BY created_at DESC`
  ).all(launchId);
}

// ─── Go/No-Go decision + override helpers ────────────────────────────────────

export function getPendingOverridesForLaunch(launchId) {
  return db.prepare(
    `SELECT * FROM gonogo_overrides WHERE launch_id = ? AND status = 'pending' ORDER BY created_at ASC`
  ).all(launchId);
}

export function recordGonogoDecision({ launchId, decision, decidedBy }) {
  db.prepare(
    `UPDATE launches SET gonogo_decision = ?, gonogo_decided_by = ?, gonogo_decided_at = datetime('now') WHERE id = ?`
  ).run(decision, decidedBy, launchId);
}

// ─── Confirm live helper ──────────────────────────────────────────────────────

export function confirmLaunchLive({ launchId, confirmedBy }) {
  db.prepare(
    `UPDATE launches SET live_confirmed_at = datetime('now'), live_confirmed_by = ? WHERE id = ?`
  ).run(confirmedBy, launchId);
}

// ─── Signal intake helpers ──────────────────────────────────────────────────
// No launch_id here on purpose — see the note in schema.sql. These record
// raw evidence before any launch exists.

export function recordSignalEvent({ sourceType, channelId, messageTs, accountRef, segment, revenueHint, rawText }) {
  const stmt = db.prepare(
    `INSERT INTO signal_events (source_type, channel_id, message_ts, account_ref, segment, revenue_hint, raw_text)
     VALUES (@sourceType, @channelId, @messageTs, @accountRef, @segment, @revenueHint, @rawText)`
  );
  const result = stmt.run({
    sourceType,
    channelId: channelId ?? null,
    messageTs: messageTs ?? null,
    accountRef: accountRef ?? null,
    segment: segment ?? null,
    revenueHint: revenueHint ?? null,
    rawText,
  });
  return result.lastInsertRowid;
}

export function getUnclusteredSignalEvents() {
  return db.prepare('SELECT * FROM signal_events WHERE cluster_id IS NULL ORDER BY created_at ASC').all();
}

export function getSignalEventsForCluster(clusterId) {
  return db.prepare('SELECT * FROM signal_events WHERE cluster_id = ? ORDER BY created_at ASC').all(clusterId);
}

export function assignEventsToCluster(eventIds, clusterId) {
  const stmt = db.prepare('UPDATE signal_events SET cluster_id = ? WHERE id = ?');
  const runAll = db.transaction((ids) => {
    for (const id of ids) stmt.run(clusterId, id);
  });
  runAll(eventIds);
}

// ─── Signal cluster helpers ──────────────────────────────────────────────────

export function createSignalCluster({ problemSummary }) {
  const result = db
    .prepare('INSERT INTO signal_clusters (problem_summary) VALUES (?)')
    .run(problemSummary);
  return result.lastInsertRowid;
}

export function getSignalCluster(clusterId) {
  return db.prepare('SELECT * FROM signal_clusters WHERE id = ?').get(clusterId);
}

export function getAllSignalClusters(status) {
  if (status) {
    return db.prepare('SELECT * FROM signal_clusters WHERE status = ? ORDER BY updated_at DESC').all(status);
  }
  return db.prepare('SELECT * FROM signal_clusters ORDER BY updated_at DESC').all();
}

export function updateClusterScore({ clusterId, reachCount, sourceDiversity, revenueExposure, confidenceScore, confidenceLabel }) {
  db.prepare(
    `UPDATE signal_clusters SET
       reach_count = @reachCount,
       source_diversity = @sourceDiversity,
       revenue_exposure = @revenueExposure,
       confidence_score = @confidenceScore,
       confidence_label = @confidenceLabel,
       updated_at = datetime('now')
     WHERE id = @clusterId`
  ).run({ clusterId, reachCount, sourceDiversity, revenueExposure, confidenceScore, confidenceLabel });
}

export function updateClusterStatus(clusterId, status) {
  db.prepare(`UPDATE signal_clusters SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, clusterId);
}

export function promoteClusterToLaunch(clusterId, launchId) {
  db.prepare(
    `UPDATE signal_clusters SET status = 'promoted', promoted_launch_id = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(launchId, clusterId);
}

// ─── Problem statement helpers ───────────────────────────────────────────────

export function createProblemStatement({ clusterId, draftText, createdBy }) {
  const prior = db
    .prepare('SELECT MAX(version) as maxVersion FROM problem_statements WHERE cluster_id = ?')
    .get(clusterId);
  const version = (prior?.maxVersion ?? 0) + 1;
  const result = db
    .prepare('INSERT INTO problem_statements (cluster_id, version, draft_text, created_by) VALUES (?, ?, ?, ?)')
    .run(clusterId, version, draftText, createdBy);
  return result.lastInsertRowid;
}

export function getLatestProblemStatement(clusterId) {
  return db
    .prepare('SELECT * FROM problem_statements WHERE cluster_id = ? ORDER BY version DESC LIMIT 1')
    .get(clusterId);
}

export function approveProblemStatement(statementId) {
  db.prepare(`UPDATE problem_statements SET status = 'approved' WHERE id = ?`).run(statementId);
}

// ─── Competitive scan helpers ─────────────────────────────────────────────────

export function recordCompetitiveScan({ clusterId, competitorName, capabilityStatus, evidenceType, sourceRef, note }) {
  const result = db
    .prepare(
      `INSERT INTO competitive_scans (cluster_id, competitor_name, capability_status, evidence_type, source_ref, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(clusterId, competitorName, capabilityStatus, evidenceType, sourceRef ?? null, note ?? null);
  return result.lastInsertRowid;
}

export function getCompetitiveScansForCluster(clusterId) {
  return db.prepare('SELECT * FROM competitive_scans WHERE cluster_id = ? ORDER BY created_at ASC').all(clusterId);
}

// ─── Opportunity sizing helpers ───────────────────────────────────────────────

export function recordOpportunitySize({ clusterId, lowEstimate, highEstimate, basisNote }) {
  const result = db
    .prepare('INSERT INTO opportunity_sizes (cluster_id, low_estimate, high_estimate, basis_note) VALUES (?, ?, ?, ?)')
    .run(clusterId, lowEstimate, highEstimate ?? null, basisNote);
  return result.lastInsertRowid;
}

export function getLatestOpportunitySize(clusterId) {
  return db
    .prepare('SELECT * FROM opportunity_sizes WHERE cluster_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(clusterId);
}
