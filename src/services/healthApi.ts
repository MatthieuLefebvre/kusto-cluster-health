import type { Cluster, HealthResponse } from '@/types/health';

async function getJson<T extends object>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const body = await response.text();
  const payload = body ? JSON.parse(body) as T | { error?: string } : {};
  if (!response.ok) {
    throw new Error('error' in payload && payload.error ? payload.error : `Request failed (${response.status})`);
  }
  return payload as T;
}

export function getClusters(
  signal?: AbortSignal,
  filters?: { search: string; field: 'customer' | 'capacity' | 'cluster'; customer?: string; capacity?: string },
): Promise<Cluster[]> {
  const query = filters ? `?${new URLSearchParams({
    search: filters.search,
    field: filters.field,
    customer: filters.customer ?? '',
    capacity: filters.capacity ?? '',
  })}` : '';
  return getJson(`/api/clusters${query}`, signal);
}

export function getHealth(
  source: string,
  start: Date,
  end: Date,
  operation: string,
  signal?: AbortSignal,
): Promise<HealthResponse> {
  const query = new URLSearchParams({
    source,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  if (operation) query.set('operation', operation);
  return getJson(`/api/health?${query}`, signal);
}