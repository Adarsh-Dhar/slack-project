// services/signalClustering.js
// @ts-nocheck
//
// Groups unclustered signal_events that look like the same underlying
// problem. v1 uses deterministic keyword-overlap (Jaccard similarity on
// significant words) rather than an LLM call — it's free, instant, and
// fully unit-testable without network access. The grouping logic
// (groupEventsByOverlap) is a pure function on purpose: if you later want
// LLM-based clustering instead, swap out ONLY that function — everything
// downstream (persistence, scoring, Slack posting) stays unchanged.

import { config } from '../config.js';
import * as db from '../db/index.js';
import { scoreCluster } from './demandValidation.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'and', 'or', 'for',
  'in', 'on', 'at', 'this', 'that', 'it', 'i', 'we', 'you', 'my', 'our', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'with', 'from', 'as', 'if', 'but',
  'can', 'could', 'would', 'will', 'about', 'so', 'not', 'me', 'us',
]);

/**
 * Very lightweight stemmer — strips common suffixes so "schedule",
 * "scheduling", and "scheduled" count as the same token. This is NOT a real
 * Porter stemmer; it's a handful of rules good enough to stop obvious
 * near-duplicates from silently lowering overlap scores. If clustering
 * quality needs to improve further, this is the first thing to upgrade
 * (or replace tokenize/groupEventsByOverlap with an LLM-based grouper).
 */
function stem(word) {
  if (word.length > 6 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 5 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 5 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  // Trailing silent-e (e.g. "schedule" should match the "schedul" root left
  // behind by stripping "-ing"/"-ed" above): strip it too, for consistency
  // rather than dictionary correctness — what matters is that every form of
  // the same word reduces to the same token, not that the token is a real word.
  if (word.length > 5 && word.endsWith('e') && !word.endsWith('ee')) return word.slice(0, -1);
  return word;
}

/**
 * Tokenize text into significant words: lowercase, strip punctuation,
 * drop stopwords and very short words, then stem. Pure function, no I/O.
 */
export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !STOPWORDS.has(word))
    .map(stem);
}

function jaccard(setA, setB) {
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Greedily group events by token overlap. Pure function — takes plain
 * event-like objects ({ id, raw_text }), returns arrays of grouped events.
 * Does NOT filter by minimum group size — that's the caller's decision,
 * since "min size" is a business threshold (config), not a clustering concern.
 */
export function groupEventsByOverlap(events, { minOverlap = 0.15 } = {}) {
  const groups = []; // [{ tokens: Set, events: [] }]

  for (const event of events) {
    const tokens = new Set(tokenize(event.raw_text));
    let bestGroup = null;
    let bestScore = 0;

    for (const group of groups) {
      const score = jaccard(tokens, group.tokens);
      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup && bestScore >= minOverlap) {
      bestGroup.events.push(event);
      // Expand the group's token set so later events can match on the
      // group's accumulated vocabulary, not just the first event's wording.
      for (const t of tokens) bestGroup.tokens.add(t);
    } else {
      groups.push({ tokens, events: [event] });
    }
  }

  return groups.map(g => g.events);
}

/**
 * Build a short, human-editable summary label for a new cluster.
 * v1: most frequent significant word across the group's events. Deliberately
 * crude — this is a starting label a PM edits, not a final answer.
 */
function summarizeGroup(events) {
  const freq = new Map();
  for (const event of events) {
    for (const token of new Set(tokenize(event.raw_text))) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }
  }
  const topWords = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word]) => word);
  return `Possible signal: ${topWords.join(', ')} (${events.length} reports, needs a human-written title)`;
}

/**
 * Orchestration: pull unclustered events, group them, persist any group
 * that meets the minimum size threshold as a new signal_cluster, score it,
 * and leave everything else unclustered for the next run.
 *
 * Returns the list of newly created cluster IDs (for posting to Slack).
 */
export function clusterPendingSignals() {
  const pending = db.getUnclusteredSignalEvents();
  const groups = groupEventsByOverlap(pending);

  const newClusterIds = [];

  for (const group of groups) {
    if (group.length < config.SIGNAL_MIN_EVENTS_TO_CLUSTER) continue; // leave as noise for now

    const clusterId = db.createSignalCluster({ problemSummary: summarizeGroup(group) });
    db.assignEventsToCluster(group.map(e => e.id), clusterId);
    scoreCluster(clusterId);
    newClusterIds.push(clusterId);
  }

  return newClusterIds;
}
