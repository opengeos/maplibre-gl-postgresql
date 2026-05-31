import { DuckDBInstance } from '@duckdb/node-api';
import type { PostgreSQLSourceConfig } from './config.js';
import {
  buildAttachSql,
  buildCountQuery,
  buildResultQuery,
  cleanSql,
  detectGeometryColumn,
  detectGeometryFormat,
  quoteIdentifier,
  type PostgreSQLColumn,
  type PostgreSQLGeometryFormat,
} from './sql.js';

const ATTACH_ALIAS = 'pg';

interface RowReader {
  columnNames(): string[];
  getRows(): unknown[][];
}

interface DuckDBConnectionLike {
  closeSync?: () => void;
  disconnectSync?: () => void;
  run: (sql: string) => Promise<unknown>;
  runAndReadAll: (sql: string) => Promise<RowReader>;
}

export interface PostgreSQLTableInfo {
  schemaName: string;
  tableName: string;
  qualifiedName: string;
  displayName: string;
}

export interface QueryOptions {
  sourceId: string;
  sql: string;
  geometryColumn?: string;
  geometryFormat?: PostgreSQLGeometryFormat;
  sourceCrs?: string;
  targetCrs?: string;
  limit?: number;
  layerName?: string;
}

export interface QueryResult {
  schema: PostgreSQLColumn[];
  geometryColumn: string | null;
  geometryFormat: Exclude<PostgreSQLGeometryFormat, 'auto'> | null;
  totalRows: number;
  rows: Record<string, unknown>[];
  wkbBase64: string[];
  indices: number[];
}

let instancePromise: Promise<unknown> | null = null;

async function getInstance(): Promise<{ connect: () => Promise<DuckDBConnectionLike> }> {
  instancePromise ??= DuckDBInstance.create(':memory:');
  return instancePromise as Promise<{ connect: () => Promise<DuckDBConnectionLike> }>;
}

async function withConnection<T>(source: PostgreSQLSourceConfig, task: (connection: DuckDBConnectionLike) => Promise<T>): Promise<T> {
  const instance = await getInstance();
  const connection = await instance.connect();
  try {
    await connection.run('INSTALL postgres');
    await connection.run('LOAD postgres');
    await connection.run('INSTALL spatial');
    await connection.run('LOAD spatial');
    await connection.run(buildAttachSql(source.connectionString, ATTACH_ALIAS));
    return await task(connection);
  } finally {
    connection.closeSync?.();
    connection.disconnectSync?.();
  }
}

function rowsToObjects(reader: RowReader): Record<string, unknown>[] {
  const names = reader.columnNames();
  return reader.getRows().map((row) =>
    Object.fromEntries(names.map((name, index) => [name, normalizeValue(row[index])]))
  );
}

function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  return value;
}

function toBase64(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('base64');
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64');
  return null;
}

export async function listPostgreSQLTables(source: PostgreSQLSourceConfig): Promise<PostgreSQLTableInfo[]> {
  return withConnection(source, async (connection) => {
    const reader = await connection.runAndReadAll(
      `SELECT schema_name, table_name
       FROM duckdb_tables()
       WHERE database_name = '${ATTACH_ALIAS}'
       ORDER BY schema_name, table_name`
    );
    return rowsToObjects(reader).map((row) => {
      const schemaName = String(row.schema_name);
      const tableName = String(row.table_name);
      return {
        schemaName,
        tableName,
        qualifiedName: `${quoteIdentifier(ATTACH_ALIAS)}.${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`,
        displayName: `${schemaName}.${tableName}`,
      };
    });
  });
}

export async function listPostgreSQLColumns(
  source: PostgreSQLSourceConfig,
  schemaName: string,
  tableName: string
): Promise<PostgreSQLColumn[]> {
  return withConnection(source, async (connection) => {
    const reader = await connection.runAndReadAll(
      `DESCRIBE SELECT * FROM ${quoteIdentifier(ATTACH_ALIAS)}.${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`
    );
    return rowsToObjects(reader).map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      nullable: String(row.null) === 'YES',
    }));
  });
}

export async function queryPostgreSQL(source: PostgreSQLSourceConfig, options: QueryOptions): Promise<QueryResult> {
  const sourceSql = cleanSql(options.sql);
  const limit = Math.max(1, Math.min(Number(options.limit ?? 10000), 100000));
  if (!sourceSql) throw Object.assign(new Error('SQL query is required'), { statusCode: 400 });

  return withConnection(source, async (connection) => {
    const schemaReader = await connection.runAndReadAll(`DESCRIBE SELECT * FROM (${sourceSql}) AS q`);
    const schema = rowsToObjects(schemaReader).map((row) => ({
      name: String(row.column_name),
      type: String(row.column_type),
      nullable: String(row.null) === 'YES',
    }));
    const geometryColumn = detectGeometryColumn(schema, options.geometryColumn, options.geometryFormat ?? 'auto');
    if (!geometryColumn) {
      throw Object.assign(new Error('No geometry, WKB, or WKT column was detected in the query result'), {
        statusCode: 400,
      });
    }
    const geometryFormat = detectGeometryFormat(
      schema.find((column) => column.name === geometryColumn),
      options.geometryFormat ?? 'auto'
    );
    if (!geometryFormat) {
      throw Object.assign(new Error(`Could not determine geometry format for column "${geometryColumn}"`), {
        statusCode: 400,
      });
    }

    const countReader = await connection.runAndReadAll(buildCountQuery(sourceSql));
    const totalRows = Number(rowsToObjects(countReader)[0]?.cnt ?? -1);
    const resultReader = await connection.runAndReadAll(
      buildResultQuery({
        sql: sourceSql,
        schema,
        geometryColumn,
        geometryFormat,
        sourceCrs: options.sourceCrs,
        targetCrs: options.targetCrs,
        limit,
      })
    );
    const columnNames = resultReader.columnNames();
    const wkbIndex = columnNames.indexOf('__wkb');
    const rows: Record<string, unknown>[] = [];
    const wkbBase64: string[] = [];
    const indices: number[] = [];

    resultReader.getRows().forEach((row, rowIndex) => {
      const wkb = toBase64(row[wkbIndex]);
      if (!wkb) return;
      wkbBase64.push(wkb);
      indices.push(rowIndex);
      rows.push(
        Object.fromEntries(
          columnNames
            .map((name, index) => [name, normalizeValue(row[index])] as const)
            .filter(([name]) => name !== '__wkb')
        )
      );
    });

    return {
      schema,
      geometryColumn,
      geometryFormat,
      totalRows,
      rows,
      wkbBase64,
      indices,
    };
  });
}
