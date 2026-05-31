import type {
  PostgreSQLColumn,
  PostgreSQLGeometryFormat,
  PostgreSQLSource,
  PostgreSQLTable,
} from '../core/types';

export interface PostgreSQLQueryRequest {
  sourceId: string;
  sql: string;
  geometryColumn?: string;
  geometryFormat?: PostgreSQLGeometryFormat;
  sourceCrs?: string;
  targetCrs?: string;
  limit?: number;
  layerName?: string;
}

export interface PostgreSQLQueryResponse {
  schema: PostgreSQLColumn[];
  geometryColumn: string | null;
  geometryFormat: Exclude<PostgreSQLGeometryFormat, 'auto'> | null;
  totalRows: number;
  rows: Record<string, unknown>[];
  wkbBase64: string[];
  indices: number[];
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : response.statusText;
    throw new Error(message);
  }
  return payload as T;
}

export async function listSources(apiBaseUrl: string): Promise<PostgreSQLSource[]> {
  const response = await fetch(joinUrl(apiBaseUrl, '/api/sources'));
  const payload = await readJson<{ sources: PostgreSQLSource[] }>(response);
  return payload.sources;
}

export async function listTables(apiBaseUrl: string, sourceId: string): Promise<PostgreSQLTable[]> {
  const response = await fetch(joinUrl(apiBaseUrl, `/api/sources/${encodeURIComponent(sourceId)}/tables`));
  const payload = await readJson<{ tables: PostgreSQLTable[] }>(response);
  return payload.tables;
}

export async function listColumns(
  apiBaseUrl: string,
  sourceId: string,
  schemaName: string,
  tableName: string
): Promise<PostgreSQLColumn[]> {
  const response = await fetch(
    joinUrl(
      apiBaseUrl,
      `/api/sources/${encodeURIComponent(sourceId)}/tables/${encodeURIComponent(schemaName)}/${encodeURIComponent(
        tableName
      )}/columns`
    )
  );
  const payload = await readJson<{ columns: PostgreSQLColumn[] }>(response);
  return payload.columns;
}

export async function runQuery(
  apiBaseUrl: string,
  request: PostgreSQLQueryRequest
): Promise<PostgreSQLQueryResponse> {
  const response = await fetch(joinUrl(apiBaseUrl, '/api/query'), {
    body: JSON.stringify(request),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  return readJson<PostgreSQLQueryResponse>(response);
}

export function decodeBase64(value: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
  return Uint8Array.from(Buffer.from(value, 'base64'));
}
