import express from 'express';
import { z } from 'zod';

import { queryKusto } from './kusto.js';
import { loadQuery } from './queries.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

const healthRequest = z.object({
  source: z.string().min(3).max(128),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  operation: z.string().max(80).optional().default(''),
}).refine(({ start, end }) => new Date(start) < new Date(end), 'Start must be before end.');

function intervalFor(start: string, end: string): string {
  const hours = (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
  if (hours <= 12) return '5m';
  if (hours <= 48) return '15m';
  if (hours <= 168) return '30m';
  return '1h';
}

function normalizeCluster(row: Record<string, unknown>) {
  return {
    source: row.Source,
    clusterName: row.AzureServiceInstance,
    customerName: row.TenantName,
    customerAccount: row.Account,
    capacityId: row.CapacityId,
    kind: row.Kind,
    region: row.Region,
    machineCount: row.MachineCount,
    machineSku: row.MachineSKU,
    state: row.State,
    serviceOffering: row.ServiceOffering,
    lastUpdated: row.LastUpdated,
  };
}

app.get('/api/healthz', (_request, response) => {
  response.json({ status: 'ok', database: process.env.KUSTO_DATABASE ?? 'Kuskus' });
});

app.get('/api/clusters', async (_request, response, next) => {
  try {
    const rows = await queryKusto(await loadQuery('clusters'));
    response.json(rows.map(normalizeCluster));
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', async (request, response, next) => {
  try {
    const input = healthRequest.parse(request.query);
    const bindings = { ...input, interval: intervalFor(input.start, input.end) };
    const queryNames = ['metadata', 'cpu', 'memory', 'disk-queue', 'cache', 'queries', 'changes', 'top-queries'] as const;
    const results = await Promise.all(queryNames.map(async (name) => [
      name,
      await queryKusto(await loadQuery(name, bindings)),
    ] as const));

    const data = Object.fromEntries(results);
    response.json({
      source: input.source,
      range: { start: input.start, end: input.end, interval: bindings.interval },
      generatedAt: new Date().toISOString(),
      ...data,
      metadata: (data.metadata ?? []).map(normalizeCluster),
    });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.';
  console.error(message);
  response.status(error instanceof z.ZodError ? 400 : 500).json({ error: message });
});

app.listen(port, () => {
  console.log(`Kusto health API listening on http://localhost:${port}`);
});