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
