// services/signalIntake.js
// @ts-nocheck
//
// Turns a raw Slack message from a signal-source channel into a structured
// signal_events row. Extraction is deliberately regex/heuristic-based, not
// LLM-based — ingestion needs to be fast, free, and deterministic since it
// runs on every message in five channels. Clustering (services/signalClustering.js)
// is where LLM-quality judgment actually gets applied, on a much smaller,
// pre-filtered set of events — that's the right place to pay for it.

import * as db from '../db/index.js';

// ─── Pure extraction functions (no I/O — easy to unit test) ─────────────────

const ACCOUNT_REF_PATTERNS = [
  /\b(?:creator_id|customer_id|user_id|account_id)[:\s]+(\w+)/i,
  /\b(c_\d+|u_\d+|creator_\d+)\b/i,
  /\baccount:\s*([A-Za-z0-9&.\- ]+?)(?:\s*\(|\n|$)/i,
  /\bcustomer\s+(c_\d+)\b/i,
];

export function extractAccountRef(text) {
  for (const pattern of ACCOUNT_REF_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1].trim();
  }
  return null;
}

const SEGMENT_KEYWORDS = ['enterprise', 'business', 'pro', 'free'];

export function extractSegment(text) {
  const lower = text.toLowerCase();
  for (const keyword of SEGMENT_KEYWORDS) {
    if (lower.includes(keyword)) return keyword;
  }
  return null;
}

export function extractRevenueHint(text) {
  const match = text.match(/\$([\d,]+(?:\.\d+)?)/);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Normalize a raw message into the fields signal_events needs.
 * Exported separately from ingestMessage so it can be unit tested without a DB.
 */
export function normalizeSignalMessage(rawText) {
  return {
    accountRef: extractAccountRef(rawText),
    segment: extractSegment(rawText),
    revenueHint: extractRevenueHint(rawText),
  };
}

/**
 * Ingest one raw message. This is the only function that touches the DB —
 * everything else in this file is pure and testable in isolation.
 */
export function ingestMessage({ sourceType, channelId, messageTs, rawText }) {
  const { accountRef, segment, revenueHint } = normalizeSignalMessage(rawText);
  return db.recordSignalEvent({
    sourceType,
    channelId,
    messageTs,
    accountRef,
    segment,
    revenueHint,
    rawText,
  });
}
