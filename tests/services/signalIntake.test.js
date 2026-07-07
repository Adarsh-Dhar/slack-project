import assert from 'node:assert';
import { describe, it } from 'node:test';

import { extractAccountRef, extractRevenueHint, extractSegment, normalizeSignalMessage } from '../../services/signalIntake.js';

describe('signalIntake extraction', () => {
  it('extracts creator_id style account refs', () => {
    assert.strictEqual(extractAccountRef('From: creator_id 3312 (Pro plan)'), '3312');
  });

  it('extracts c_XXXX style account refs', () => {
    assert.strictEqual(extractAccountRef('Customer c_5521 (Pro plan)'), 'c_5521');
  });

  it('extracts Account: label style refs', () => {
    assert.strictEqual(extractAccountRef('Account: Northline Studios (14-person media team)'), 'Northline Studios');
  });

  it('returns null when no account ref is present', () => {
    assert.strictEqual(extractAccountRef('Every Sunday night someone manually queues uploads.'), null);
  });

  it('extracts dollar amounts', () => {
    assert.strictEqual(extractRevenueHint('Closed-Lost — Deal D-9981 ($42,000 ARR)'), 42000);
  });

  it('returns null when no dollar amount is present', () => {
    assert.strictEqual(extractRevenueHint('No dollars mentioned here.'), null);
  });

  it('extracts plan tier segment keywords', () => {
    assert.strictEqual(extractSegment('creator_id 3312 (Pro plan)'), 'pro');
    assert.strictEqual(extractSegment('Business plan, $499 MRR'), 'business');
  });

  it('normalizes a full message into all three fields at once', () => {
    const result = normalizeSignalMessage('Churn Alert — Customer c_5521 (Pro plan, $199 MRR)');
    assert.deepStrictEqual(result, { accountRef: 'c_5521', segment: 'pro', revenueHint: 199 });
  });
});
