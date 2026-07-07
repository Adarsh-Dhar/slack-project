// services/problemStatement.js
// @ts-nocheck
//
// Drafts a problem statement from a cluster's own evidence — deterministic
// template fill, not an LLM call. This keeps it free, instant, and fully
// testable, and it forces the "crisp and testable" structure by construction
// rather than hoping an LLM follows instructions. If you want a more natural
// narrative later, that's a good candidate for an LLM pass — but keep the
// template as the fallback/validation shape, since the four blanks below
// are exactly the facts a defensible problem statement needs.

import * as db from '../db/index.js';

function mostCommonSegment(events) {
  const counts = {};
  for (const e of events) {
    if (!e.segment) continue;
    counts[e.segment] = (counts[e.segment] ?? 0) + 1;
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/**
 * Pure function: builds the draft text from plain data. No DB access here —
 * makes it trivial to unit test every wording branch (segment known/unknown,
 * revenue present/absent) without a database.
 */
export function buildProblemStatementText({ cluster, events }) {
  const segment = mostCommonSegment(events);
  const sourceTypes = [...new Set(events.map(e => e.source_type))];
  const segmentPhrase = segment ? `${segment}-tier` : 'affected';

  const evidenceLine =
    `evidenced by ${events.length} report(s) across ${sourceTypes.length} source(s) ` +
    `(${sourceTypes.join(', ')})` +
    (cluster.revenue_exposure > 0 ? `, ${Math.round(cluster.revenue_exposure).toLocaleString()} dollars of revenue exposure` : '');

  // The outcome/metric line only ever references metrics this system can
  // actually measure — never an invented one like "user happiness".
  const metricLine =
    cluster.reach_count > 0
      ? `a reduction in related ${sourceTypes.includes('churn') ? 'churn and ' : ''}support/sales friction, ` +
        `measured by a drop in new signal_events tagged to this problem and by revenue_exposure trending down` 
      : `no measurable baseline yet — needs more evidence before a metric can be committed to`;

  return (
    `We believe ${segmentPhrase} users experience: ${cluster.problem_summary}\n\n` +
    `This is ${evidenceLine}.\n\n` +
    `If we solve it, we expect ${metricLine}.\n\n` +
    `Confidence in this being a real (not loud-minority) problem: ${cluster.confidence_score ?? 'unscored'} ` +
    `(${cluster.confidence_label ?? 'unscored'}), based on reach of ${cluster.reach_count} distinct account(s).` 
  );
}

/**
 * Orchestration: load cluster + events, build the draft, persist it as a
 * new version, return it for posting to Slack.
 */
export function draftProblemStatement(clusterId, createdBy = 'agent') {
  const cluster = db.getSignalCluster(clusterId);
  if (!cluster) throw new Error(`No signal cluster #${clusterId}`);
  const events = db.getSignalEventsForCluster(clusterId);

  const draftText = buildProblemStatementText({ cluster, events });
  const statementId = db.createProblemStatement({ clusterId, draftText, createdBy });

  return { statementId, draftText, version: db.getLatestProblemStatement(clusterId).version };
}
