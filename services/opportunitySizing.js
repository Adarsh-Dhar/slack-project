// services/opportunitySizing.js
// @ts-nocheck
//
// Sizing is ALWAYS a range with a stated method, never a single number —
// same discipline as services/pnl.js's confirmed/estimated split. The low
// end is only ever dollars already tied to real events (revenue_exposure).
// The high end is an explicit extrapolation across a manually-configured
// segment size, capped so a thin-evidence cluster can't produce an absurd
// number, and omitted entirely (not guessed) when segment size is unknown.

import { config } from '../config.js';
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
 * Pure function: computes the low/high estimate and basis note from plain
 * inputs. No DB access — every branch (segment known/unknown, multiplier
 * capped/uncapped) is independently unit-testable.
 */
export function computeOpportunitySize({ reachCount, revenueExposure, segment, segmentSize, maxMultiplier }) {
  const lowEstimate = revenueExposure;

  if (!segment || !segmentSize || reachCount <= 0) {
    return {
      lowEstimate,
      highEstimate: null,
      basisNote:
        `Low estimate: $${Math.round(lowEstimate).toLocaleString()} observed from ${reachCount} confirmed account(s). ` +
        `High-end extrapolation not available — segment size unknown or not configured for "${segment ?? 'unknown'}".`,
    };
  }

  const rawMultiplier = segmentSize / reachCount;
  const multiplier = Math.min(rawMultiplier, maxMultiplier);
  const capped = rawMultiplier > maxMultiplier;
  const highEstimate = lowEstimate * multiplier;

  return {
    lowEstimate,
    highEstimate,
    basisNote:
      `Low estimate: $${Math.round(lowEstimate).toLocaleString()} observed from ${reachCount} confirmed account(s) in the ${segment} segment. ` +
      `High estimate: extrapolated assuming the same problem affects the same share of the full ${segment} segment ` +
      `(${segmentSize.toLocaleString()} accounts total), ${capped ? `capped at ${maxMultiplier}x to avoid overreaching from thin evidence` : `a ${multiplier.toFixed(1)}x multiplier`}. ` +
      `This is a projection, not observed revenue — treat the high end as an upper bound to justify further investigation, not a forecast.`,
  };
}

/**
 * Orchestration: load cluster + events, compute the range, persist it.
 */
export function sizeOpportunity(clusterId) {
  const cluster = db.getSignalCluster(clusterId);
  if (!cluster) throw new Error(`No signal cluster #${clusterId}`);
  const events = db.getSignalEventsForCluster(clusterId);

  const segment = mostCommonSegment(events);
  const segmentSize = segment ? config.SEGMENT_SIZES[segment] : null;

  const { lowEstimate, highEstimate, basisNote } = computeOpportunitySize({
    reachCount: cluster.reach_count,
    revenueExposure: cluster.revenue_exposure,
    segment,
    segmentSize,
    maxMultiplier: config.OPPORTUNITY_MAX_EXTRAPOLATION_MULTIPLIER,
  });

  const sizeId = db.recordOpportunitySize({ clusterId, lowEstimate, highEstimate, basisNote });
  return { sizeId, lowEstimate, highEstimate, basisNote };
}
