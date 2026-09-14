import { AzureCliCredential, ManagedIdentityCredential } from '@azure/identity';

const clusterUrl = process.env.KUSTO_CLUSTER_URL ?? 'https://kuskushead.westeurope.kusto.windows.net';
const database = process.env.KUSTO_DATABASE ?? 'Kuskus';
const credential = process.env.KUSTO_AUTH_MODE === 'managed-identity'
  ? process.env.AZURE_CLIENT_ID
    ? new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID)
    : new ManagedIdentityCredential()
  : new AzureCliCredential();

interface KustoColumn {
  ColumnName: string;
}

interface KustoTable {
  TableKind?: string;
  TableName?: string;
  Columns: KustoColumn[];
  Rows: unknown[][];
}

interface KustoResponse {
  Tables?: KustoTable[];
}

export type KustoRow = Record<string, unknown>;

export async function queryKusto(query: string): Promise<KustoRow[]> {
  const token = await credential.getToken('https://kusto.kusto.windows.net/.default');
  if (!token) throw new Error('Unable to acquire an Azure Data Explorer token. Run az login.');

  const response = await fetch(`${clusterUrl}/v1/rest/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ db: database, csl: query }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Kusto query failed (${response.status}): ${detail.slice(0, 1200)}`);
  }

  const payload = await response.json() as KustoResponse | KustoTable[];
  const tables = Array.isArray(payload) ? payload : (payload.Tables ?? []);
  const table = tables.find((candidate) => candidate.TableKind === 'PrimaryResult') ?? tables[0];
  if (!table) return [];

  const columns = table.Columns.map((column) => column.ColumnName);
  return table.Rows.map((values) => Object.fromEntries(
    columns.map((column, index) => [column, values[index]]),
  ));
}