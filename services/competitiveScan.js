// services/competitiveScan.js
// @ts-nocheck
//
// Two-phase scan: (1) mine your own signal_events for competitor mentions —
// free, instant, and higher-confidence than a generic web search because
// it's tied to actual lost/at-risk revenue; (2) only for competitors NOT
// already covered by phase 1, run a capped, cited web search. Every row
// this writes to competitive_scans traces back to either a specific event
// or a specific URL — never a bare claim.

import { config } from '../config.js';
import * as db from '../db/index.js';
import { searchWeb } from './webSearch.js';

/**
 * Pure function: find which known competitors are named in a block of text.
 * Case-insensitive substring match against the configured list — simple on
 * purpose. Testable without any DB or network access.
 */
export function extractCompetitorMentions(text, knownCompetitors = config.KNOWN_COMPETITORS) {
  const lower = text.toLowerCase();
  return knownCompetitors.filter(name => lower.includes(name.toLowerCase()));
}

/**
 * Phase 1: mine already-ingested signal_events for competitor mentions.
 * Pure-ish — takes events as input, returns rows to persist, does not
 * write to the DB itself (mineOwnDataForCluster below does the writing).
 */
export function mineOwnData(events, knownCompetitors = config.KNOWN_COMPETITORS) {
  const rows = [];
  for (const event of events) {
    const mentions = extractCompetitorMentions(event.raw_text, knownCompetitors);
    for (const competitorName of mentions) {
      rows.push({
        competitorName,
        capabilityStatus: 'has_it', // being named as the reason a deal was lost/churned implies they have the capability
        evidenceType: 'own_data',
        sourceRef: event.account_ref ?? `event:${event.id}`,
        note: event.raw_text.slice(0, 200),
      });
    }
  }
  return rows;
}

/**
 * Orchestration for phase 1: persist mined rows for a cluster's events.
 * Returns the competitor names already covered by own data, so phase 2
 * knows what NOT to spend a web search on.
 */
export function mineOwnDataForCluster(clusterId) {
  const events = db.getSignalEventsForCluster(clusterId);
  const rows = mineOwnData(events);
  for (const row of rows) {
    db.recordCompetitiveScan({ clusterId, ...row });
  }
  return { rows, coveredCompetitors: new Set(rows.map(r => r.competitorName)) };
}

/**
 * Phase 2: bounded, cited web search for competitors not already covered by
 * own data. Caps at config.COMPETITIVE_SCAN_MAX_SEARCHES searches total.
 * A competitor with no citable result gets recorded as 'unknown' with no
 * source_ref — explicitly NOT as 'lacks_it'. Silence is not evidence.
 */
export async function webScanForCluster(clusterId, problemKeyword, alreadyCovered = new Set()) {
  const toSearch = config.KNOWN_COMPETITORS.filter(c => !alreadyCovered.has(c)).slice(0, config.COMPETITIVE_SCAN_MAX_SEARCHES);
  const results = [];

  for (const competitorName of toSearch) {
    try {
      const hits = await searchWeb(`${competitorName} ${problemKeyword}`, { maxResults: 1 });
      if (hits.length === 0) {
        db.recordCompetitiveScan({
          clusterId, competitorName, capabilityStatus: 'unknown', evidenceType: 'web_search',
          sourceRef: null, note: 'No search results found — not evidence of absence, just no citation available.',
        });
        results.push({ competitorName, status: 'unknown', url: null });
        continue;
      }
      const top = hits[0];
      db.recordCompetitiveScan({
        clusterId, competitorName, capabilityStatus: 'has_it', evidenceType: 'web_search',
        sourceRef: top.url, note: top.snippet?.slice(0, 200) ?? top.title,
      });
      results.push({ competitorName, status: 'has_it', url: top.url });
    } catch (e) {
      // Search unavailable/failed — record as unknown, never as a negative claim.
      db.recordCompetitiveScan({
        clusterId, competitorName, capabilityStatus: 'unknown', evidenceType: 'web_search',
        sourceRef: null, note: `Search unavailable: ${e.message}`,
      });
      results.push({ competitorName, status: 'unknown', url: null, error: e.message });
    }
  }

  return results;
}

/**
 * Full scan: own data first, then web search only for the gap. Returns
 * everything now on file for this cluster (own data + web), for posting.
 */
export async function runCompetitiveScan(clusterId, problemKeyword) {
  const { coveredCompetitors } = mineOwnDataForCluster(clusterId);
  await webScanForCluster(clusterId, problemKeyword, coveredCompetitors);
  return db.getCompetitiveScansForCluster(clusterId);
}
