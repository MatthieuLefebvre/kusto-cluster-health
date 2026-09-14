import { describe, expect, it } from 'vitest';

import { loadQuery } from '../server/queries.ts';

const baseBindings = {
  source: 'TRD-KQ4G7ZJYKTK1KNXV5B',
  start: '2026-01-01T00:00:00.000Z',
  end: '2026-09-14T00:00:00.000Z',
};

describe('changes query', () => {
  it('renders an exact operation with the expanded filtered limit', async () => {
    const query = await loadQuery('changes', {
      ...baseBindings,
      operation: 'ALTER-TABLE-EXTENTS-MERGE-POLICY',
      changeLimit: 2000,
    });

    expect(query).toContain('Event contains "ALTER-TABLE-EXTENTS-MERGE-POLICY"');
    expect(query).toContain('| take 2000');
    expect(query).not.toContain('{{');
  });

  it('keeps the smaller unfiltered result limit', async () => {
    const query = await loadQuery('changes', { ...baseBindings, changeLimit: 250 });

    expect(query).toContain('isempty("")');
    expect(query).toContain('| take 250');
    expect(query).not.toContain('{{');
  });
});