import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Clock3, Cpu, Database, Gauge, HardDrive, RefreshCw, Search,
  Server, ShieldCheck, SlidersHorizontal, TableProperties, Workflow,
} from 'lucide-react';

import { MetricCard } from '@/components/MetricCard';
import { KqlViewer, type KqlEntry } from '@/components/KqlViewer';
import { SearchableFilter } from '@/components/SearchableFilter';
import { TrendChart } from '@/components/TrendChart';
import { assessChange } from '@/services/changeAssessment';
import { getClusters, getHealth } from '@/services/healthApi';
import { assessQueryOptimization } from '@/services/queryOptimization';
import type { Cluster, HealthResponse, TopQuery } from '@/types/health';

const DEFAULT_SOURCE = 'TRD-KQ4G7ZJYKTK1KNXV5B';
const RANGE_OPTIONS = [
  { label: '6 hours', value: '6h', days: 0.25 },
  { label: '24 hours', value: '24h', days: 1 },
  { label: '3 days', value: '3d', days: 3 },
  { label: '7 days', value: '7d', days: 7 },
  { label: '14 days', value: '14d', days: 14 },
  { label: '28 days', value: '28d', days: 28 },
  { label: '3 months', value: '3m', days: 90 },
  { label: '6 months', value: '6m', days: 180 },
  { label: '12 months', value: '12m', days: 365 },
  { label: 'All available', value: 'all', days: null },
  { label: 'Custom UTC range', value: 'custom', days: null },
];
const OPERATION_OPTIONS = [
  'ALTER-TABLE-EXTENTS-MERGE-POLICY',
  'ALTER-TABLE-RETENTION-POLICY',
  'ALTER-FUNCTION',
  'ALTER-DATABASE-SYSTEM-PROPERTIES',
  'ALTER-SYSTEM-PROPERTIES',
].map((value) => ({ label: value, value }));

type View = 'overview' | 'workload' | 'changes';

function compact(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function percent(value: number) {
  return `${value.toFixed(1)}%`;
}

function utcInputValue(date: Date) {
  return date.toISOString().slice(0, 19);
}

function bytes(value: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let scaled = Math.abs(value);
  let unitIndex = 0;
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024;
    unitIndex += 1;
  }
  const signed = value < 0 ? -scaled : scaled;
  return `${signed.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function maxOf<T>(rows: T[], selector: (row: T) => number | null | undefined) {
  const values = rows.map(selector).filter((value): value is number => Number.isFinite(value));
  return values.length ? Math.max(...values) : 0;
}

function averageOf<T>(rows: T[], selector: (row: T) => number | null | undefined) {
  const values = rows.map(selector).filter((value): value is number => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function scanRatio(scanned: number, total: number) {
  return total ? `${(100 * scanned / total).toFixed(1)}%` : 'Unavailable';
}

function kqlEntries(data: HealthResponse | null, names: (keyof HealthResponse['kql'])[]): KqlEntry[] {
  return names.flatMap((name) => data?.kql?.[name] ? [{ label: name, text: data.kql[name] }] : []);
}

function TopQueryRows({ query, index }: { query: TopQuery; index: number }) {
  const optimization = assessQueryOptimization(query);
  return <Fragment key={`${query.query}-${index}`}>
    <tr>
      <td><strong>{query.application || 'Unknown'}</strong><small>{query.workloadGroup || 'default'}</small></td>
      <td className="query-cell"><span>{query.query || 'Query text unavailable'}</span><details className="query-details"><summary>View KQL and optimization</summary><div className="query-details__body"><section><h3>{optimization.textAvailable ? 'KQL' : 'Query text'}</h3><pre>{query.query || 'Query text unavailable'}</pre></section><section><h3>Optimization assessment</h3><ul>{optimization.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></section><dl><div><dt>Rows scanned</dt><dd>{compact(query.scannedRows)} / {compact(query.totalRows)} ({scanRatio(query.scannedRows, query.totalRows)})</dd></div><div><dt>Extents scanned</dt><dd>{compact(query.scannedExtents)} / {compact(query.totalExtents)} ({scanRatio(query.scannedExtents, query.totalExtents)})</dd></div><div><dt>CPU / execution</dt><dd>{query.executions ? compact(query.totalCpuMs / query.executions) : '0'} ms</dd></div><div><dt>Peak memory</dt><dd>{bytes(query.peakMemoryBytes)}</dd></div></dl></div></details></td>
      <td>{compact(query.executions)}</td><td>{compact(query.totalCpuMs)} ms</td><td>{compact(query.p95DurationMs)} ms</td><td>{bytes(query.peakMemoryBytes)}</td><td>{query.failures}</td>
    </tr>
  </Fragment>;
}

export function HomePage() {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [customer, setCustomer] = useState('');
  const [capacity, setCapacity] = useState('');
  const [operation, setOperation] = useState('');
  const [application, setApplication] = useState('');
  const [workloadGroup, setWorkloadGroup] = useState('');
  const [range, setRange] = useState('28d');
  const [customRange, setCustomRange] = useState(() => ({
    start: utcInputValue(new Date(Date.now() - 28 * 86_400_000)),
    end: utcInputValue(new Date()),
  }));
  const [appliedCustomRange, setAppliedCustomRange] = useState(customRange);
  const [view, setView] = useState<View>('overview');
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const filtersTouchedRef = useRef(false);

  const mergeClusters = (matches: Cluster[]) => {
    setClusters((current) => {
      const bySource = new Map(current.map((cluster) => [cluster.source, cluster]));
      matches.forEach((cluster) => bySource.set(cluster.source, cluster));
      return [...bySource.values()];
    });
  };

  const searchCatalog = async (field: 'customer' | 'capacity' | 'cluster', search: string) => {
    try {
      const matches = await getClusters(undefined, {
        field,
        search,
        customer: field === 'customer' ? '' : customer,
        capacity: field === 'cluster' ? capacity : '',
      });
      mergeClusters(matches);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to search cluster filters.');
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const loadClusters = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          setClusters(await getClusters(controller.signal));
          return;
        } catch (reason) {
          if (controller.signal.aborted) return;
          if (attempt === 2) setError(reason instanceof Error ? reason.message : 'Unable to load cluster filters.');
          else await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    };
    void loadClusters();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!source) {
      setData(null);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    const end = new Date();
    const selectedRange = RANGE_OPTIONS.find((option) => option.value === range) ?? RANGE_OPTIONS[5];
    const custom = selectedRange.value === 'custom';
    const selectedEnd = custom ? new Date(`${appliedCustomRange.end}Z`) : end;
    const start = custom
      ? new Date(`${appliedCustomRange.start}Z`)
      : selectedRange.days === null ? new Date(0) : new Date(end.getTime() - selectedRange.days * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(selectedEnd.getTime()) || start >= selectedEnd) {
      setLoading(false);
      setError('UTC start must be earlier than UTC end.');
      return;
    }
    setLoading(true);
    setError('');
    getHealth(source, start, selectedEnd, operation, controller.signal)
      .then((response) => {
        setData(response);
        const cluster = response.metadata[0];
        if (cluster) {
          if (!filtersTouchedRef.current) {
            setCustomer(cluster.customerName ?? '');
            setCapacity(cluster.capacityId ?? '');
          }
          setClusters((current) => current.some((item) => item.source === cluster.source) ? current : [cluster, ...current]);
        }
      })
      .catch((reason: Error) => {
        if (reason.name !== 'AbortError') setError(reason.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [source, range, operation, refreshKey, appliedCustomRange]);

  const customerOptions = useMemo(() => [...new Set(clusters.map((cluster) => cluster.customerName).filter(Boolean))].sort(), [clusters]);
  const capacityOptions = useMemo(() => [...new Set(clusters.filter((cluster) => !customer || cluster.customerName === customer).map((cluster) => cluster.capacityId).filter(Boolean))].sort(), [clusters, customer]);
  const clusterOptions = useMemo(() => clusters.filter((cluster) =>
    (!customer || cluster.customerName === customer) && (!capacity || cluster.capacityId === capacity),
  ), [clusters, customer, capacity]);

  const metrics = useMemo(() => {
    if (!data) return { cpu: 0, cache: 0, hotHitBytes: 0, hotMissBytes: 0, failures: 0, disk: 0, queries: 0, score: 0 };
    const cpu = maxOf(data.cpu.filter((point) => !point.IsAdmin), (point) => point.p95Cpu);
    const cache = averageOf(data.cache, (point) => point.hotHitRatio);
    const hotHitBytes = data.cache.reduce((sum, point) => sum + point.hotHitBytes, 0);
    const hotMissBytes = data.cache.reduce((sum, point) => sum + point.hotMissBytes, 0);
    const queryCount = data.queries.reduce((sum, point) => sum + point.queryCount, 0);
    const failed = data.queries.reduce((sum, point) => sum + point.failedQueries, 0);
    const failures = queryCount ? 100 * failed / queryCount : 0;
    const disk = maxOf(data['disk-queue'], (point) => point.p95DiskQueue);
    const score = Math.max(0, Math.round(100 - Math.max(0, cpu - 65) * 1.2 - failures * 4 - Math.max(0, disk - 2) * 3 - Math.max(0, 80 - cache) * 0.35));
    return { cpu, cache, hotHitBytes, hotMissBytes, failures, disk, queries: queryCount, score };
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

  const assessedChanges = useMemo(() => (data?.changes ?? []).map((change) => ({
    change,
    assessment: assessChange(change),
  })), [data]);
  const userChangeCount = assessedChanges.filter(({ assessment }) => assessment.kind === 'user').length;
  const automationChangeCount = assessedChanges.filter(({ assessment }) => assessment.kind === 'automation').length;
  const nativeChangeCount = assessedChanges.filter(({ assessment }) => assessment.kind === 'native').length;

  const topQueries = data?.['top-queries'] ?? [];
  const applicationOptions = [...new Set(topQueries.map((query) => query.application || 'Unknown'))].sort();
  const workloadOptions = [...new Set(topQueries
    .filter((query) => !application || (query.application || 'Unknown') === application)
    .map((query) => query.workloadGroup || 'default'))].sort();
  const filteredTopQueries = topQueries.filter((query) =>
    (!application || (query.application || 'Unknown') === application)
    && (!workloadGroup || (query.workloadGroup || 'default') === workloadGroup));

  const selectApplication = (value: string) => {
    setApplication(value);
    if (value && !topQueries.some((query) =>
      (query.application || 'Unknown') === value
      && (!workloadGroup || (query.workloadGroup || 'default') === workloadGroup))) {
      setWorkloadGroup('');
    }
  };

  const selectCustomer = (value: string) => {
    filtersTouchedRef.current = true;
    setCustomer(value);
    setCapacity('');
    if (!value) return;
    const match = clusters.find((cluster) => cluster.customerName === value);
    if (match) setSource(match.source);
  };

  const selectCapacity = (value: string) => {
    filtersTouchedRef.current = true;
    setCapacity(value);
    if (!value) return;
    const match = clusters.find((cluster) => cluster.capacityId === value && (!customer || cluster.customerName === customer));
    if (match) {
      setCustomer(match.customerName ?? '');
      setSource(match.source);
    }
  };

  const selectCluster = (value: string) => {
    filtersTouchedRef.current = true;
    if (!value) {
      setSource('');
      setData(null);
      setError('');
      return;
    }
    const match = clusters.find((cluster) => cluster.source === value) ?? (data?.metadata[0]?.source === value ? data.metadata[0] : undefined);
    setSource(value);
    if (match) {
      setCustomer(match.customerName ?? '');
      setCapacity(match.capacityId ?? '');
    }
  };

  const metadata = data?.metadata[0];
  const clusterFilterOptions = clusterOptions.map((cluster) => ({
    label: `${cluster.clusterName || cluster.source} · ${cluster.kind} · ${cluster.source}`,
    value: cluster.source,
  }));
  const metadataMatchesFilters = metadata
    && (!customer || metadata.customerName === customer)
    && (!capacity || metadata.capacityId === capacity);
  if (source && !clusterFilterOptions.some((option) => option.value === source) && metadataMatchesFilters) {
    clusterFilterOptions.unshift({ label: `${metadata?.clusterName || source} · ${metadata?.kind || 'Kusto'} · ${source}`, value: source });
  }

  return (
    <main className="health-app">
      <header className="app-header">
        <div className="app-brand"><span><Activity size={20} /></span><div><strong>Cluster Health</strong><small>Kusto investigation workbench</small></div></div>
        <div className="connection-state"><span /> Live · Kuskus</div>
      </header>

      <section className="filter-band" aria-label="Analysis filters">
        <SearchableFilter label="Customer" options={customerOptions.map((value) => ({ label: value, value }))} placeholder="All customers" value={customer} onChange={selectCustomer} onSearch={(query) => searchCatalog('customer', query)} />
        <SearchableFilter label="Capacity ID" options={capacityOptions.map((value) => ({ label: value, value }))} placeholder="All capacities" value={capacity} onChange={selectCapacity} onSearch={(query) => searchCatalog('capacity', query)} />
        <SearchableFilter className="filter-wide" label="Cluster" options={clusterFilterOptions} placeholder="All clusters" value={source} onChange={selectCluster} onSearch={(query) => searchCatalog('cluster', query)} />
        <SearchableFilter label="Operation" options={OPERATION_OPTIONS} placeholder="All alterations" value={operation} onChange={setOperation} allowCustomValue />
        <label><span>Time range</span><select value={range} onChange={(event) => setRange(event.target.value)}>{RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <button className="icon-button refresh-button" disabled={!source} onClick={() => setRefreshKey((value) => value + 1)} title="Refresh analysis" aria-label="Refresh analysis"><RefreshCw size={18} className={loading ? 'spin' : ''} /></button>
        {range === 'custom' && <div className="custom-time-range"><label><span>UTC start</span><input type="datetime-local" step="1" value={customRange.start} max={customRange.end} onChange={(event) => setCustomRange((current) => ({ ...current, start: event.target.value }))} /></label><label><span>UTC end</span><input type="datetime-local" step="1" value={customRange.end} min={customRange.start} onChange={(event) => setCustomRange((current) => ({ ...current, end: event.target.value }))} /></label><button type="button" onClick={() => setAppliedCustomRange(customRange)}>Apply range</button></div>}
      </section>

      <section className="context-strip">
        <div><Server size={16} /><span>{source ? metadata?.clusterName || source : 'No cluster selected'}</span></div>
        <div><Database size={16} /><span>{source ? `${metadata?.serviceOffering || 'Kusto'} · ${metadata?.region || 'Region unavailable'}` : 'Select a cluster to analyze'}</span></div>
        <div><Cpu size={16} /><span>{source ? metadata ? `${metadata.machineCount} × ${metadata.machineSku}` : 'Loading topology' : 'Topology unavailable'}</span></div>
        <div><Clock3 size={16} /><span>{data ? `Updated ${new Date(data.generatedAt).toLocaleTimeString()}` : source ? 'Waiting for data' : 'Analysis paused'}</span></div>
      </section>

      {error && <div className="error-banner"><AlertTriangle size={18} /><span>{error}</span></div>}

      <nav className="view-tabs" aria-label="Dashboard views">
        <button className={view === 'overview' ? 'active' : ''} onClick={() => setView('overview')}><Gauge size={16} />Overview</button>
        <button className={view === 'workload' ? 'active' : ''} onClick={() => setView('workload')}><Workflow size={16} />Workload</button>
        <button className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}><TableProperties size={16} />Changes <span>{data?.changes.length ?? 0}</span></button>
      </nav>

      {!source && <section className="empty-analysis"><Server size={24} /><h2>Select a cluster</h2><span>Choose a cluster to load health metrics and diagnostic history.</span></section>}

      {source && view === 'overview' && <>
        <section className="metric-grid" aria-label="Health indicators">
          <MetricCard label="Health score" value={loading ? '—' : `${metrics.score}/100`} detail="Heuristic triage score" tone={metrics.score >= 85 ? 'good' : metrics.score >= 65 ? 'warn' : 'critical'} icon={ShieldCheck} queries={kqlEntries(data, ['cpu', 'cache', 'queries', 'disk-queue'])} />
          <MetricCard label="CPU P95" value={loading ? '—' : percent(metrics.cpu)} detail="Engine nodes · peak interval" tone={metrics.cpu < 75 ? 'good' : metrics.cpu < 90 ? 'warn' : 'critical'} icon={Cpu} queries={kqlEntries(data, ['cpu'])} />
          <MetricCard label="Hot-cache hits" value={loading || !metrics.cache ? '—' : percent(metrics.cache)} detail="Shard bytes served hot" tone={!metrics.cache ? 'neutral' : metrics.cache >= 80 ? 'good' : 'warn'} icon={Database} queries={kqlEntries(data, ['cache'])} />
          <MetricCard label="Query failures" value={loading ? '—' : percent(metrics.failures)} detail={`${compact(metrics.queries)} query completions`} tone={metrics.failures < 1 ? 'good' : metrics.failures < 2 ? 'warn' : 'critical'} icon={Search} queries={kqlEntries(data, ['queries'])} />
          <MetricCard label="Disk queue P95" value={loading ? '—' : metrics.disk.toFixed(1)} detail="Peak interval across nodes" tone={metrics.disk < 2 ? 'good' : metrics.disk < 5 ? 'warn' : 'critical'} icon={HardDrive} queries={kqlEntries(data, ['disk-queue'])} />
        </section>

        <section className="overview-layout">
          <div className="charts-column">
            <article className="panel"><header><div><small>Compute</small><h2>CPU pressure</h2></div><div className="tile-actions"><span>P95 and average, engine nodes</span><KqlViewer title="CPU pressure" queries={kqlEntries(data, ['cpu'])} /></div></header><TrendChart data={(data?.cpu.filter((point) => !point.IsAdmin) ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'avgCpu', label: 'Average', color: '#237b73' }, { key: 'p95Cpu', label: 'P95', color: '#d17b30' }]} formatter={(value) => `${value.toFixed(0)}%`} threshold={80} /></article>
            <div className="chart-pair">
              <article className="panel"><header><div><small>Cache</small><h2>Hot-cache hit ratio</h2></div><KqlViewer title="Hot-cache hit ratio" queries={kqlEntries(data, ['cache'])} /></header><TrendChart data={(data?.cache ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'hotHitRatio', label: 'Hot hit ratio', color: '#237b73' }]} formatter={(value) => `${value.toFixed(2)}%`} threshold={80} /></article>
              <article className="panel"><header><div><small>Cache volume</small><h2>Hot-cache usage</h2></div><div className="tile-actions"><span>{bytes(metrics.hotHitBytes)} served hot · {bytes(metrics.hotMissBytes)} missed</span><KqlViewer title="Hot-cache usage" queries={kqlEntries(data, ['cache'])} /></div></header><TrendChart data={(data?.cache ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'hotHitBytes', label: 'Hot hits', color: '#237b73' }, { key: 'hotMissBytes', label: 'Hot misses', color: '#c7564d' }]} formatter={bytes} /></article>
            </div>
            <article className="panel"><header><div><small>Queries</small><h2>Latency P95</h2></div><KqlViewer title="Latency P95" queries={kqlEntries(data, ['queries'])} /></header><TrendChart data={(data?.queries ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'p95DurationMs', label: 'P95 duration', color: '#3975a5' }]} formatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value.toFixed(0)}ms`} /></article>
          </div>
          <aside className="findings-panel"><header><SlidersHorizontal size={17} /><div><small>Automated triage</small><h2>Investigation findings</h2></div><KqlViewer title="Investigation findings" queries={kqlEntries(data, ['cpu', 'cache', 'queries', 'disk-queue', 'changes'])} /></header>{findings.map((finding) => <div className={`finding finding--${finding.level}`} key={finding.title}><span /><div><strong>{finding.title}</strong><p>{finding.detail}</p></div></div>)}<p className="method-note">Thresholds are triage aids, not service limits. Validate against the cluster baseline and incident timeline.</p></aside>
        </section>
      </>}

      {source && view === 'workload' && <section className="workload-view">
        <article className="panel disk-panel"><header><div><small>Storage</small><h2>Disk queue pressure</h2></div><div className="tile-actions"><span>Compare with cache misses and merge windows</span><KqlViewer title="Disk queue pressure" queries={kqlEntries(data, ['disk-queue'])} /></div></header><TrendChart data={(data?.['disk-queue'] ?? []) as unknown as Record<string, unknown>[]} lines={[{ key: 'avgDiskQueue', label: 'Average', color: '#3975a5' }, { key: 'p95DiskQueue', label: 'P95', color: '#c7564d' }]} threshold={2} /></article>
        <article className="table-panel"><header><div><small>Resource consumers</small><h2>Top queries by total CPU</h2></div><div className="tile-actions"><span>Expand a query for KQL, scan evidence, and optimization ideas</span><KqlViewer title="Top queries by total CPU" queries={kqlEntries(data, ['top-queries'])} /></div></header><div className="workload-filters"><label><span>Application</span><select value={application} onChange={(event) => selectApplication(event.target.value)}><option value="">All applications</option>{applicationOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label><span>Workload</span><select value={workloadGroup} onChange={(event) => setWorkloadGroup(event.target.value)}><option value="">All workloads</option>{workloadOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><span>{filteredTopQueries.length} of {topQueries.length} queries</span></div><div className="table-scroll"><table><thead><tr><th>Application / workload</th><th>Query and analysis</th><th>Executions</th><th>Total CPU</th><th>P95 duration</th><th>Peak memory</th><th>Failures</th></tr></thead><tbody>{filteredTopQueries.map((query, index) => <TopQueryRows query={query} index={index} key={`${query.query}-${index}`} />)}</tbody></table></div></article>
      </section>}

      {source && view === 'changes' && <section className="table-panel changes-view"><header><div><small>Memento audit</small><h2>Cluster and database alterations</h2></div><div className="tile-actions"><span>{data?.changes.length ?? 0} {operation ? 'matching' : 'prioritized'} events shown</span><KqlViewer title="Cluster and database alterations" queries={kqlEntries(data, ['changes'])} /></div></header><div className="change-review-summary" role="region" aria-label="Change assessment summary"><strong>{userChangeCount} likely user {userChangeCount === 1 ? 'change' : 'changes'}</strong><span>{automationChangeCount} automation</span><span>{nativeChangeCount} native maintenance</span></div><div className="table-scroll"><table><thead><tr><th>Assessment</th><th>Timestamp</th><th>Operation</th><th>Entity / database</th><th>Command</th><th>Principal</th></tr></thead><tbody>{assessedChanges.map(({ change, assessment }, index) => <tr className={`change-row change-row--${assessment.kind}`} key={`${change.activityId}-${change.event}-${index}`}><td><span className={`assessment-tag assessment-tag--${assessment.kind}`}>{assessment.label}</span><small className="assessment-reason">{assessment.reason}</small></td><td>{new Date(change.timestamp).toLocaleString()}</td><td><span className="operation-tag">{change.event}</span></td><td><strong>{change.entityName}</strong><small>{change.database}</small></td><td className="command-cell">{change.changeCommand}</td><td>{change.principal || 'Unavailable'}</td></tr>)}</tbody></table></div></section>}
    </main>
  );
}
