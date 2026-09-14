import { describe, expect, it } from 'vitest';

import { assessQueryOptimization } from '@/services/queryOptimization';
import type { TopQuery } from '@/types/health';

function topQuery(overrides: Partial<TopQuery> = {}): TopQuery {
  return {
    application: 'App', workloadGroup: 'default', query: 'T | take 10', executions: 1,
    totalCpuMs: 10, p95DurationMs: 10, peakMemoryBytes: 10, failures: 0,
    scannedExtents: 1, totalExtents: 10, scannedRows: 10, totalRows: 100,
    ...overrides,
  };
}

describe('assessQueryOptimization', () => {
  it('does not infer syntax optimizations from redacted text', () => {
    const result = assessQueryOptimization(topQuery({ query: '[Redacted - see confidential Kuskus for full trace]' }));
    expect(result.textAvailable).toBe(false);
    expect(result.suggestions[0]).toContain('redacted');
  });

  it('flags broad scans and repeated execution', () => {
    const result = assessQueryOptimization(topQuery({ executions: 500, scannedRows: 95, totalRows: 100 }));
    expect(result.suggestions.some((suggestion) => suggestion.startsWith('High execution count'))).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.startsWith('Broad scan'))).toBe(true);
  });

  it('suggests indexed term search for readable contains expressions', () => {
    const result = assessQueryOptimization(topQuery({ query: 'T | where Message contains "error"' }));
    expect(result.textAvailable).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.includes('`has`'))).toBe(true);
  });
});