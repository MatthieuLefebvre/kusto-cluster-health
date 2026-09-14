import { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Clock3, Cpu, Database, Gauge, HardDrive, RefreshCw, Search,
  Server, ShieldCheck, SlidersHorizontal, TableProperties, Workflow,
} from 'lucide-react';

import { MetricCard } from '@/components/MetricCard';
import { TrendChart } from '@/components/TrendChart';
import { getClusters, getHealth } from '@/services/healthApi';
import type { Cluster, HealthResponse } from '@/types/health';

const DEFAULT_SOURCE = 'TRD-KQ4G7ZJYKTK1KNXV5B';
const RANGE_OPTIONS = [
  { label: '6 hours', hours: 6 },
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '14 days', hours: 336 },
];

type View = 'overview' | 'workload' | 'changes';

function compact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function percent(value: number) {
  return `${value.toFixed(1)}%`;
}

function maxOf<T>(rows: T[], selector: (row: T) => number | null | undefined) {
  const values = rows.map(selector).filter((value): value is number => Number.isFinite(value));
  return values.length ? Math.max(...values) : 0;
}

function averageOf<T>(rows: T[], selector: (row: T) => number | null | undefined) {
  const values = rows.map(selector).filter((value): value is number => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

export function HomePage() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [customer, setCustomer] = useState('');
  const [capacity, setCapacity] = useState('');
  const [operation, setOperation] = useState('');
  const [rangeHours, setRangeHours] = useState(24);
  const [view, setView] = useState<View>('overview');
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getClusters(controller.signal).then(setClusters).catch((reason: Error) => setError(reason.message));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const end = new Date();
    const start = new Date(end.getTime() - rangeHours * 3_600_000);
    setLoading(true);
    setError('');
    getHealth(source, start, end, operation, controller.signal)
      .then((response) => {
        setData(response);
        const cluster = response.metadata[0];
        if (cluster) {
          setCustomer(cluster.customerName ?? '');
          setCapacity(cluster.capacityId ?? '');
          setClusters((current) => current.some((item) => item.source === cluster.source) ? current : [cluster, ...current]);
        }
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [source, rangeHours, operation, refreshKey]);

  const customerOptions = useMemo(() => [...new Set(clusters.map((cluster) => cluster.customerName).filter(Boolean))].sort(), [clusters]);
  const capacityOptions = useMemo(() => [...new Set(clusters.filter((cluster) => !customer || cluster.customerName === customer).map((cluster) => cluster.capacityId).filter(Boolean))].sort(), [clusters, customer]);
  const clusterOptions = useMemo(() => clusters.filter((cluster) =>
    (!customer || cluster.customerName === customer) && (!capacity || cluster.capacityId === capacity),
  ), [clusters, customer, capacity]);

  const metrics = useMemo(() => {
    if (!data) return { cpu: 0, cache: 0, failures: 0, disk: 0, queries: 0, score: 0 };
    const cpu = maxOf(data.cpu.filter((point) => !point.IsAdmin), (point) => point.p95Cpu);
    const cache = averageOf(data.cache, (point) => point.hotHitRatio);
    const queryCount = data.queries.reduce((sum, point) => sum + point.queryCount, 0);
    const failed = data.queries.reduce((sum, point) => sum + point.failedQueries, 0);
    const failures = queryCount ? 100 * failed / queryCount : 0;
    const disk = maxOf(data['disk-queue'], (point) => point.p95DiskQueue);
    const score = Math.max(0, Math.round(100 - Math.max(0, cpu - 65) * 1.2 - failures * 4 - Math.max(0, disk - 2) * 3 - Math.max(0, 80 - cache) * 0.35));
    return { cpu, cache, failures, disk, queries: queryCount, score };
  }, [data]);

  const findings = useMemo(() => {
    const result: { level: string; title: string; detail: string }[] = [];
    if (metrics.cpu >= 90) result.push({ level: 'critical', title: 'CPU saturation', detail: `P95 reached ${percent(metrics.cpu)}. Correlate the peak with expensive queries and scaling decisions.` });
    else if (metrics.cpu >= 75) result.push({ level: 'warn', title: 'Elevated CPU', detail: `P95 reached ${percent(metrics.cpu)}. Review workload concentration before resizing.` });
    if (metrics.cache > 0 && metrics.cache < 80) result.push({ level: 'warn', title: 'Low hot-cache hit ratio', detail: `Observed ${percent(metrics.cache)}. Check cache policy against queried time ranges and cold scans.` });
    if (metrics.failures >= 2) result.push({ level: 'critical', title: 'Query failures', detail: `${percent(metrics.failures)} of completed query records were not successful.` });
    if (metrics.disk >= 2) result.push({ level: 'warn', title: 'Disk queue pressure', detail: `P95 queue depth reached ${metrics.disk.toFixed(1)}. Compare with cache misses, merge activity, and ingestion.` });
    const policyChanges = data?.changes.filter((change) => /merge|cache|retention|extent/i.test(`${change.event} ${change.changeCommand}`)).length ?? 0;
    if (policyChanges) result.push({ level: 'info', title: 'Policy changes in range', detail: `${policyChanges} merge, cache, retention, or extent-related changes may explain a workload shift.` });
    if (!result.length && data) result.push({ level: 'good', title: 'No strong pressure signal', detail: 'The selected window has no threshold breach. Compare against a known incident window before closing the investigation.' });
    return result;
  }, [data, metrics]);

  const selectCustomer = (value: string) => {
    setCustomer(value);
    setCapacity('');
    const match = clusters.find((cluster) => cluster.customerName === value);
    if (match) setSource(match.source);
  };

  const selectCapacity = (value: string) => {
    setCapacity(value);
    const match = clusters.find((cluster) => cluster.capacityId === value && (!customer || cluster.customerName === customer));
    if (match) setSource(match.source);
  };

  const metadata = data?.metadata[0];

  return (
    <main className="health-app">
      <header className="app-header">
        <div className="app-brand"><span><Activity size={20} /></span><div><strong>Cluster Health</strong><small>Kusto investigation workbench</small></div></div>
        <div className="connection-state"><span /> Live · Kuskus</div>
      </header>

      <section className="filter-band" aria-label="Analysis filters">
        <label><span>Customer</span><select value={customer} onChange={(event) => selectCustomer(event.target.value)}><option value="">All customers</option>{customerOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>Capacity ID</span><select value={capacity} onChange={(event) => selectCapacity(event.target.value)}><option value="">All capacities</option>{capacityOptions.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="filter-wide"><span>Cluster</span><select value={source} onChange={(event) => setSource(event.target.value)}>{clusterOptions.map((cluster) => <option key={cluster.source} value={cluster.source}>{cluster.clusterName || cluster.source} · {cluster.kind}</option>)}{!clusterOptions.some((cluster) => cluster.source === source) && <option value={source}>{metadata?.clusterName || source}</option>}</select></label>
        <label><span>Operation</span><select value={operation} onChange={(event) => setOperation(event.target.value)}><option value="">All alterations</option><option value="MERGE">Merge</option><option value="CACHE">Cache</option><option value="RETENTION">Retention</option><option value="EXTENT">Extent</option><option value="ENCODING">Encoding</option><option value="SYSTEM-PROPERTIES">System properties</option></select></label>
        <label><span>Time range</span><select value={rangeHours} onChange={(event) => setRangeHours(Number(event.target.value))}>{RANGE_OPTIONS.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}</select></label>
        <button className="icon-button refresh-button" onClick={() => setRefreshKey((value) => value + 1)} title="Refresh analysis" aria-label="Refresh analysis"><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
      </section>

      <section className="context-strip">
        <div><Server size={16} /><span>{metadata?.clusterName || source}</span></div>
        <div><Database size={16} /><span>{metadata?.serviceOffering || 'Kusto'} · {metadata?.region || 'Region unavailable'}</span></div>
        <div><Cpu size={16} /><span>{metadata ? `${metadata.machineCount} × ${metadata.machineSku}` : 'Loading topology'}</span></div>
        <div><Clock3 size={16} /><span>{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : 'Waiting for data'}</span></div>
      </section>

      {error && <div className="error-banner"><AlertTriangle size={18} /><span>{error}</span></div>}

      <nav className="view-tabs" aria-label="Dashboard views">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}><Gauge size={16} />Overview</button>
        <button className={view === 'workload' ? 'active' : ''} onClick={() => setView('workload')}><Workflow size={16} />Workload</button>
        <button className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}><TableProperties size={16} />Changes <span>{data?.changes.length ?? 0}</span></button>
      </nav>

      {view === 'overview' && <>
        <section className="metric-grid" aria-label="Health indicators">
          <MetricCard label="Health score" value={loading ? '—' : `${metrics.score}/100`} detail="Heuristic triage score" tone={metrics.score >= 85 ? 'good' : metrics.score >= 65 ? 'warn' : 'critical'} icon={ShieldCheck} />
          <MetricCard label="CPU P95" value={loading ? '—' : percent(metrics.cpu)} detail="Engine nodes · peak interval" tone={metrics.cpu < 75 ? 'good' : metrics.cpu < 90 ? 'warn' : 'critical'} icon={Cpu} />
          <MetricCard label="Hot-cache hits" value={loading || !metrics.cache ? '—' : percent(metrics.cache)} detail="Shard bytes served hot" tone={!metrics.cache ? 'neutral' : metrics.cache >= 80 ? 'good' : 'warn'} icon={Database} />
          <MetricCard label="Query failures" value={loading ? '—' : percent(metrics.failures)} detail={`${compact(metrics.queries)} query completions`} tone={metrics.failures < 1 ? 'good' : metrics.failures < 2 ? 'warn' : 'critical'} icon={Search} />
          <MetricCard label="Disk queue P95" value={loading ? '—' : metrics.disk.toFixed(1)} detail="Peak interval across nodes" tone={metrics.disk < 2 ? 'good' : metrics.disk < 5 ? 'warn' : 'critical'} icon={HardDrive} />
        </section>

        <section className="overview-layout">
          <div className="charts-column">
            <article className="panel"><header><div><small>Compute</small><h2>CPU pressure</h2></div><span>P95 and average, engine nodes</span></header><TrendChart data={(data?.cpu.filter((point) => !point.IsAdmin) ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'avgCpu', label: 'Average', color: '#237b73' }, { key: 'p95Cpu', label: 'P95', color: '#d17b30' }]} formatter={(value) => `${value.toFixed(0)}%`} threshold={80} /></article>
            <div className="chart-pair">
              <article className="panel"><header><div><small>Cache</small><h2>Hot-cache hit ratio</h2></div></header><TrendChart data={(data?.cache ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'hotHitRatio', label: 'Hot hit ratio', color: '#237b73' }]} formatter={(value) => `${value.toFixed(0)}%`} threshold={80} /></article>
              <article className="panel"><header><div><small>Queries</small><h2>Latency P95</h2></div></header><TrendChart data={(data?.queries ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'p95DurationMs', label: 'P95 duration', color: '#3975a5' }]} formatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value.toFixed(0)}ms`} /></article>
            </div>
          </div>
          <aside className="findings-panel"><header><SlidersHorizontal size={17} /><div><small>Automated triage</small><h2>Investigation findings</h2></div></header>{findings.map((finding) => <div className={`finding finding--${finding.level}`} key={finding.title}><span /><div><strong>{finding.title}</strong><p>{finding.detail}</p></div></div>)}<p className="method-note">Thresholds are triage aids, not service limits. Validate against the cluster baseline and incident timeline.</p></aside>
        </section>
      </>}

      {view === 'workload' && <section className="workload-view">
        <article className="panel disk-panel"><header><div><small>Storage</small><h2>Disk queue pressure</h2></div><span>Compare with cache misses and merge windows</span></header><TrendChart data={(data?.['disk-queue'] ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'avgDiskQueue', label: 'Average', color: '#3975a5' }, { key: 'p95DiskQueue', label: 'P95', color: '#c7564d' }]} threshold={2} /></article>
        <article className="table-panel"><header><div><small>Resource consumers</small><h2>Top queries by total CPU</h2></div></header><div className="table-scroll"><table><thead><tr><th>Application / workload</th><th>Query sample</th><th>Executions</th><th>Total CPU</th><th>P95 duration</th><th>Peak memory</th><th>Failures</th></tr></thead><tbody>{data?.['top-queries'].map((query, index) => <tr key={`${query.query}-${index}`}><td><strong>{query.application || 'Unknown'}</strong><small>{query.workloadGroup || 'default'}</small></td><td className="query-cell">{query.query || 'Query text unavailable'}</td><td>{compact(query.executions)}</td><td>{compact(query.totalCpuMs)} ms</td><td>{compact(query.p95DurationMs)} ms</td><td>{compact(query.peakMemoryBytes)} B</td><td>{query.failures}</td></tr>)}</tbody></table></div></article>
      </section>}

      {view === 'changes' && <section className="table-panel changes-view"><header><div><small>Memento audit</small><h2>Cluster and database alterations</h2></div><span>{data?.changes.length ?? 0} events in selected range</span></header><div className="table-scroll"><table><thead><tr><th>Timestamp</th><th>Operation</th><th>Entity / database</th><th>Command</th><th>Principal</th></tr></thead><tbody>{data?.changes.map((change, index) => <tr key={`${change.activityId}-${change.event}-${index}`}><td>{new Date(change.timestamp).toLocaleString()}</td><td><span className="operation-tag">{change.event}</span></td><td><strong>{change.entityName}</strong><small>{change.database}</small></td><td className="command-cell">{change.changeCommand}</td><td>{change.principal}</td></tr>)}</tbody></table></div></section>}
    </main>
  );
}
