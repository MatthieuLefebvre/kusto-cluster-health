import type { TopQuery } from '@/types/health';

export interface QueryOptimization {
  textAvailable: boolean;
  suggestions: string[];
}

const REDACTED_QUERY = /\bredacted\b|confidential .* full trace/i;

export function assessQueryOptimization(query: TopQuery): QueryOptimization {
  const textAvailable = Boolean(query.query.trim()) && !REDACTED_QUERY.test(query.query);
  const suggestions: string[] = [];

  if (!textAvailable) {
    suggestions.push('Query text is redacted in QueryCompletion telemetry; inspect the confidential trace before making syntax-level changes.');
  }
  if (query.failures > 0) suggestions.push('Investigate failures first; retries can multiply CPU and hide the original bottleneck.');
  if (query.executions >= 100) suggestions.push('High execution count: cache or batch repeated results, and verify the caller is not polling more often than needed.');
  if (query.p95DurationMs >= 1000) suggestions.push('High P95 latency: narrow the time range and reduce rows as early as possible.');
  if (query.peakMemoryBytes >= 1_000_000_000) suggestions.push('High peak memory: reduce join and summarize cardinality, and project away unused columns before those operators.');
  if (query.totalRows > 0 && query.scannedRows / query.totalRows >= 0.8) suggestions.push('Broad scan: add selective time and dimension filters early, and confirm the table cache policy covers the queried range.');

  if (textAvailable) {
    const kql = query.query.toLocaleLowerCase();
    if (kql.includes(' contains ')) suggestions.push('Prefer `has` over `contains` for whole-term searches when semantics allow; it can use the term index.');
    if (kql.includes('mv-expand')) suggestions.push('Filter and project before `mv-expand`, and limit expansion when only a subset is needed.');
    if (kql.includes(' join ') && !kql.includes('hint.strategy')) suggestions.push('For joins, reduce both sides first and consider `hint.strategy=broadcast` when the right side is small.');
    if ((kql.includes('parse_json(') || kql.includes('todynamic(')) && query.executions >= 100) suggestions.push('Repeated JSON parsing is costly; consider extracting frequently used properties at ingestion.');
    if (kql.includes('summarize') && !kql.includes(' bin(')) suggestions.push('For time-series aggregation, use an explicit `bin()` interval to control result cardinality.');
  }

  if (!suggestions.length) suggestions.push('No obvious issue is detectable from telemetry alone; validate with query trace and representative parameters.');
  return { textAvailable, suggestions };
}