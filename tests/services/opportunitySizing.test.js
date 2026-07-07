import assert from 'node:assert';
import { describe, it } from 'node:test';

import { computeOpportunitySize } from '../../services/opportunitySizing.js';

describe('opportunitySizing computeOpportunitySize', () => {
  it('always sets lowEstimate to the observed revenue exposure', () => {
    const result = computeOpportunitySize({ reachCount: 3, revenueExposure: 5000, segment: 'pro', segmentSize: 1000, maxMultiplier: 20 });
    assert.strictEqual(result.lowEstimate, 5000);
  });

  it('omits highEstimate entirely when segment size is unknown, rather than guessing', () => {
    const result = computeOpportunitySize({ reachCount: 3, revenueExposure: 5000, segment: 'pro', segmentSize: null, maxMultiplier: 20 });
    assert.strictEqual(result.highEstimate, null);
    assert.match(result.basisNote, /not available/);
  });

  it('omits highEstimate when segment itself is unknown', () => {
    const result = computeOpportunitySize({ reachCount: 3, revenueExposure: 5000, segment: null, segmentSize: null, maxMultiplier: 20 });
    assert.strictEqual(result.highEstimate, null);
  });

  it('extrapolates using the segment-size-to-reach ratio when both are known', () => {
    const result = computeOpportunitySize({ reachCount: 5, revenueExposure: 1000, segment: 'pro', segmentSize: 50, maxMultiplier: 20 });
    // multiplier = 50/5 = 10, uncapped since 10 < 20
    assert.strictEqual(result.highEstimate, 10000);
    assert.doesNotMatch(result.basisNote, /capped/);
  });

  it('caps the multiplier so thin evidence cannot produce an absurd projection', () => {
    const result = computeOpportunitySize({ reachCount: 1, revenueExposure: 100, segment: 'free', segmentSize: 100000, maxMultiplier: 20 });
    // raw multiplier would be 100000x, must be capped at 20x
    assert.strictEqual(result.highEstimate, 2000);
    assert.match(result.basisNote, /capped at 20x/);
  });

  it('never produces a highEstimate below the lowEstimate', () => {
    const result = computeOpportunitySize({ reachCount: 10, revenueExposure: 1000, segment: 'pro', segmentSize: 10, maxMultiplier: 20 });
    assert.ok(result.highEstimate >= result.lowEstimate);
  });
});
