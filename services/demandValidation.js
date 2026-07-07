// services/demandValidation.js
// @ts-nocheck
//
// Turns a cluster's raw evidence into a confidence score. The scoring
// function itself is pure (no DB, no I/O) so it can be unit tested with
// plain objects — the "is this a real problem or a loud minority" judgment
// call lives entirely in computeConfidence, in one place, not scattered
// across Slack-posting code.

import { config } from '../config.js';
import * as db from '../db/index.js';

const RECENCY_WINDOW_DAYS = 14;

/**
 * Pure scoring function. Takes plain numbers, returns a score 0-1 and a label.
 * Weights sum to 1.0 — reach and source diversity matter most (that's the
 * actual "real problem vs loud minority" distinction), revenue and recency
 * matter less but still count.
 */
export function computeConfidence({ reachCount, sourceDiversity, revenueExposure, recencyRatio }, thresholds = config.SIGNAL_CONFIDENCE_THRESHOLDS) {
  const reachFactor = Math.min(reachCount / 5, 1);           // 5+ distinct accounts = max
  const sourceFactor = Math.min(sourceDiversity / 3, 1);     // 3+ distinct source types = max
  const revenueFactor = Math.min(revenueExposure / 20000, 1); // $20k+ exposure = max
  const recencyFactor = recencyRatio;                         // already 0-1

  const score =
    0.35 * reachFactor +
    0.30 * sourceFactor +
    0.20 * revenueFactor +
    0.15 * recencyFactor;

  const label = score >= thresholds.high ? 'high' : score >= thresholds.medium ? 'medium' : 'low';

  return { score: Math.round(score * 100) / 100, label };
}

/**
 * Compute the raw inputs computeConfidence needs from a list of signal_events.
 * Kept separate from computeConfidence so the "what counts as reach" question
 * (distinct account_ref vs falling back to event count) can change without
 * touching the scoring formula itself.
 */
export function summarizeEvents(events) {
  const distinctAccounts = new Set(events.filter(e => e.account_ref).map(e => e.account_ref));
  // If nobody's account_ref was extractable, fall back to event count — but
  // this is a weaker signal, worth flagging in the report rather than hiding.
  const reachCount = distinctAccounts.size > 0 ? distinctAccounts.size : events.length;

  const sourceDiversity = new Set(events.map(e => e.source_type)).size;

  const revenueExposure = events.reduce((sum, e) => sum + (e.revenue_hint ?? 0), 0);

  const now = Date.now();
  const recentCount = events.filter(e => {
    const created = new Date(e.created_at).getTime();
    return (now - created) / (1000 * 60 * 60 * 24) <= RECENCY_WINDOW_DAYS;
  }).length;
  const recencyRatio = events.length > 0 ? recentCount / events.length : 0;

  return {
    reachCount,
    sourceDiversity,
    revenueExposure,
    recencyRatio,
    reachIsAccountBased: distinctAccounts.size > 0,
  };
}

/**
 * Orchestration: load a cluster's events, score it, persist the score.
 * Returns the full result so callers (Slack posting, agent tools) don't
 * need a second DB read.
 */
export function scoreCluster(clusterId) {
  const events = db.getSignalEventsForCluster(clusterId);
  const summary = summarizeEvents(events);
  const { score, label } = computeConfidence(summary);

  db.updateClusterScore({
    clusterId,
    reachCount: summary.reachCount,
    sourceDiversity: summary.sourceDiversity,
    revenueExposure: summary.revenueExposure,
    confidenceScore: score,
    confidenceLabel: label,
  });

  return { clusterId, ...summary, confidenceScore: score, confidenceLabel: label, eventCount: events.length };
}
