import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const queryRoot = fileURLToPath(new URL('../queries/', import.meta.url));
const sourcePattern = /^[A-Z0-9][A-Z0-9._-]{2,127}$/i;
const operationPattern = /^[A-Z0-9][A-Z0-9._-]{0,79}$/i;
const intervalPattern = /^(5m|15m|30m|1h)$/;

export interface QueryBindings {
  source?: string;
  start?: string;
  end?: string;
  interval?: string;
  operation?: string;
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function loadQuery(name: string, bindings: QueryBindings = {}): Promise<string> {
  const template = await readFile(`${queryRoot}${name}.kql`, 'utf8');
  const replacements: Record<string, string> = {};

  if (bindings.source) {
    if (!sourcePattern.test(bindings.source)) throw new Error('Invalid cluster source identifier.');
    replacements.source = quote(bindings.source);
  }
  if (bindings.operation) {
    if (!operationPattern.test(bindings.operation)) throw new Error('Invalid operation filter.');
    replacements.operation = quote(bindings.operation);
  } else {
    replacements.operation = '""';
  }
  if (bindings.start) replacements.start = `datetime(${new Date(bindings.start).toISOString()})`;
  if (bindings.end) replacements.end = `datetime(${new Date(bindings.end).toISOString()})`;
  if (bindings.interval) {
    if (!intervalPattern.test(bindings.interval)) throw new Error('Invalid aggregation interval.');
    replacements.interval = bindings.interval;
  }

  return Object.entries(replacements).reduce(
    (query, [key, value]) => query.replaceAll(`{{${key}}}`, value),
    template,
  );
}