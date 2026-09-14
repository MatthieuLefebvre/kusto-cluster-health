export interface Cluster {
  source: string;
  clusterName: string;
  customerName: string;
  customerAccount: string;
  capacityId: string;
  kind: string;
  region: string;
  machineCount: number;
  machineSku: string;
  state?: string;
  serviceOffering: string;
  lastUpdated?: string;
}

export interface CpuPoint {
  timestamp: string;
  avgCpu: number;
  p95Cpu: number;
  maxCpu: number;
  IsAdmin: boolean;
}

export interface CachePoint {
  timestamp: string;
  hotHitRatio: number | null;
  hotHitBytes: number;
  hotMissBytes: number;
  queryCount: number;
}

export interface QueryPoint {
  timestamp: string;
  queryCount: number;
  failedQueries: number;
  p50DurationMs: number;
  p95DurationMs: number;
  totalCpuMs: number;
  peakMemoryBytes: number;
  failureRate: number;
}

export interface DiskPoint {
  timestamp: string;
  avgDiskQueue: number;
  p95DiskQueue: number;
  maxDiskQueue: number;
}

export interface MemoryPoint {
  timestamp: string;
  avgAvailableMb: number;
  minAvailableMb: number;
}

export interface ChangeRow {
  timestamp: string;
  event: string;
  entityName: string;
  database: string;
  principal: string;
  changeCommand: string;
  activityId: string;
}

export interface TopQuery {
  application: string;
  workloadGroup: string;
  query: string;
  executions: number;
  totalCpuMs: number;
  p95DurationMs: number;
  peakMemoryBytes: number;
  failures: number;
  scannedExtents: number;
  totalExtents: number;
  scannedRows: number;
  totalRows: number;
}

export interface HealthResponse {
  source: string;
  generatedAt: string;
  range: { start: string; end: string; interval: string };
  kql: Record<'metadata' | 'cpu' | 'memory' | 'disk-queue' | 'cache' | 'queries' | 'changes' | 'top-queries', string>;
  metadata: Cluster[];
  cpu: CpuPoint[];
  memory: MemoryPoint[];
  'disk-queue': DiskPoint[];
  cache: CachePoint[];
  queries: QueryPoint[];
  changes: ChangeRow[];
  'top-queries': TopQuery[];
}