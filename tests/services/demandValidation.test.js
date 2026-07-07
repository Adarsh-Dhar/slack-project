import assert from 'node:assert';
import { describe, it } from 'node:test';

import { computeConfidence, summarizeEvents } from '../../services/demandValidation.js';

const THRESHOLDS = { high: 0.7, medium: 0.4 };
const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago

describe('demandValidation computeConfidence', () => {
  it('scores a well-corroborated cluster as high confidence', () => {
    const { score, label } = computeConfidence(
      { reachCount: 5, sourceDiversity: 4, revenueExposure: 40000, recencyRatio: 1 },
      THRESHOLDS
    );
    assert.ok(score >= 0.7, `expected >= 0.7, got ${score}`);
    assert.strictEqual(label, 'high');
  });

  it('scores a single-account, single-source cluster as low confidence (the loud minority case)', () => {
    const { score, label } = computeConfidence(
      { reachCount: 1, sourceDiversity: 1, revenueExposure: 0, recencyRatio: 1 },
      THRESHOLDS
    );
    assert.ok(score < 0.4, `expected < 0.4, got ${score}`);
    assert.strictEqual(label, 'low');
  });

  it('never exceeds 1.0 even with extreme inputs', () => {
    const { score } = computeConfidence(
      { reachCount: 999, sourceDiversity: 999, revenueExposure: 999999999, recencyRatio: 1 },
      THRESHOLDS
    );
    assert.ok(score <= 1.0);
  });
});

describe('demandValidation summarizeEvents', () => {
  it('counts distinct accounts, not raw event count, as reach', () => {
    const events = [
      { source_type: 'support_ticket', account_ref: 'acct_1', revenue_hint: null, created_at: NOW },
      { source_type: 'support_ticket', account_ref: 'acct_1', revenue_hint: null, created_at: NOW }, // same account, duplicate
      { source_type: 'churn', account_ref: 'acct_2', revenue_hint: null, created_at: NOW },
    ];
    const summary = summarizeEvents(events);
    assert.strictEqual(summary.reachCount, 2); // not 3 — duplicate account collapsed
    assert.strictEqual(summary.reachIsAccountBased, true);
  });

  it('falls back to event count when no account_ref is extractable, and flags it', () => {
    const events = [
      { source_type: 'analytics', account_ref: null, revenue_hint: null, created_at: NOW },
      { source_type: 'analytics', account_ref: null, revenue_hint: null, created_at: NOW },
    ];
    const summary = summarizeEvents(events);
    assert.strictEqual(summary.reachCount, 2);
    assert.strictEqual(summary.reachIsAccountBased, false);
  });

  it('computes recency ratio correctly across old and new events', () => {
    const events = [
      { source_type: 'support_ticket', account_ref: 'a', revenue_hint: null, created_at: NOW },
      { source_type: 'support_ticket', account_ref: 'b', revenue_hint: null, created_at: OLD },
    ];
    const summary = summarizeEvents(events);
    assert.strictEqual(summary.recencyRatio, 0.5);
  });
});
