import assert from 'node:assert';
import { describe, it } from 'node:test';

import { extractCompetitorMentions, mineOwnData } from '../../services/competitiveScan.js';

const COMPETITORS = ['Vendor X', 'Vendor Y'];

describe('competitiveScan extractCompetitorMentions', () => {
  it('finds a known competitor mentioned in text, case-insensitively', () => {
    assert.deepStrictEqual(extractCompetitorMentions('moved to vendor x for scheduling', COMPETITORS), ['Vendor X']);
  });

  it('returns an empty array when no known competitor is mentioned', () => {
    assert.deepStrictEqual(extractCompetitorMentions('no competitor here', COMPETITORS), []);
  });

  it('finds multiple competitors in the same text', () => {
    assert.deepStrictEqual(
      extractCompetitorMentions('compared Vendor X and Vendor Y before deciding', COMPETITORS),
      ['Vendor X', 'Vendor Y']
    );
  });
});

describe('competitiveScan mineOwnData', () => {
  it('produces one own_data row per competitor mention, tagged has_it', () => {
    const events = [
      { id: 1, account_ref: 'acct_1', raw_text: 'Lost deal, Vendor X has content calendar' },
      { id: 2, account_ref: null, raw_text: 'No competitor mentioned here' },
    ];
    const rows = mineOwnData(events, COMPETITORS);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].competitorName, 'Vendor X');
    assert.strictEqual(rows[0].capabilityStatus, 'has_it');
    assert.strictEqual(rows[0].evidenceType, 'own_data');
    assert.strictEqual(rows[0].sourceRef, 'acct_1');
  });

  it('falls back to an event reference when account_ref is missing', () => {
    const events = [{ id: 7, account_ref: null, raw_text: 'Switched to Vendor Y' }];
    const rows = mineOwnData(events, COMPETITORS);
    assert.strictEqual(rows[0].sourceRef, 'event:7');
  });
});
