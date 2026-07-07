import assert from 'node:assert';
import { describe, it } from 'node:test';

import { buildProblemStatementText } from '../../services/problemStatement.js';

const cluster = {
  problem_summary: 'Creators want scheduled publishing',
  reach_count: 4,
  revenue_exposure: 42199,
  confidence_score: 0.9,
  confidence_label: 'high',
};

describe('problemStatement buildProblemStatementText', () => {
  it('includes the segment, evidence count, and revenue exposure', () => {
    const events = [
      { source_type: 'support_ticket', segment: 'pro' },
      { source_type: 'sales_feedback', segment: 'enterprise' },
      { source_type: 'churn', segment: 'pro' },
    ];
    const text = buildProblemStatementText({ cluster, events });
    assert.match(text, /pro-tier/); // most common segment wins
    assert.match(text, /3 report\(s\)/);
    assert.match(text, /42,199/);
    assert.match(text, /0\.9/);
  });

  it('falls back to "affected" when no segment is known', () => {
    const events = [{ source_type: 'analytics', segment: null }];
    const text = buildProblemStatementText({ cluster, events });
    assert.match(text, /affected users/);
  });

  it('never invents a metric when reach is zero', () => {
    const zeroReachCluster = { ...cluster, reach_count: 0 };
    const text = buildProblemStatementText({ cluster: zeroReachCluster, events: [] });
    assert.match(text, /no measurable baseline yet/);
  });
});
