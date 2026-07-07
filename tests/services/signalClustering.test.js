import assert from 'node:assert';
import { describe, it } from 'node:test';

import { groupEventsByOverlap, tokenize } from '../../services/signalClustering.js';

describe('signalClustering tokenize', () => {
  it('normalizes different forms of the same word to the same token', () => {
    assert.deepStrictEqual(tokenize('schedule'), ['schedul']);
    assert.deepStrictEqual(tokenize('scheduling'), ['schedul']);
    assert.deepStrictEqual(tokenize('scheduled'), ['schedul']);
  });

  it('drops stopwords and short words', () => {
    const tokens = tokenize('I can do this for the app');
    assert.deepStrictEqual(tokens, []);
  });
});

describe('signalClustering groupEventsByOverlap', () => {
  it('groups events with overlapping vocabulary together', () => {
    const events = [
      { id: 1, raw_text: 'scheduling content calendar for uploads' },
      { id: 2, raw_text: 'need scheduling and a content calendar feature' },
    ];
    const groups = groupEventsByOverlap(events);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].length, 2);
  });

  it('keeps unrelated events in separate groups (the loud-minority control case)', () => {
    const events = [
      { id: 1, raw_text: 'scheduling content calendar for uploads' },
      { id: 2, raw_text: 'billing invoice PDF export broken' },
      { id: 3, raw_text: 'dark mode color contrast accessibility' },
    ];
    const groups = groupEventsByOverlap(events);
    assert.strictEqual(groups.length, 3);
    for (const group of groups) assert.strictEqual(group.length, 1);
  });

  it('does not merge groups below the configured overlap threshold', () => {
    const events = [
      { id: 1, raw_text: 'scheduling content calendar uploads episodes weekly' },
      { id: 2, raw_text: 'billing export invoice accounting' },
    ];
    const groups = groupEventsByOverlap(events, { minOverlap: 0.5 });
    assert.strictEqual(groups.length, 2);
  });
});
