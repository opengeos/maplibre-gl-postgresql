export type PostgreSQLGeometryFormat = 'auto' | 'geometry' | 'wkb' | 'wkt';

export interface PostgreSQLColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function cleanSql(sql: string): string {
  return sql.trim().replace(/;+$/, '').trim();
}

export function buildAttachSql(connectionString: string, alias: string): string {
  return `ATTACH '${escapeLiteral(connectionString)}' AS ${quoteIdentifier(alias)} (TYPE postgres, READ_ONLY)`;
}

export function detectGeometryFormat(
  column: PostgreSQLColumn | undefined,
  requestedFormat: PostgreSQLGeometryFormat
): Exclude<PostgreSQLGeometryFormat, 'auto'> | null {
  if (!column) return null;
  if (requestedFormat !== 'auto') return requestedFormat;
  const type = column.type.toUpperCase();
  const name = column.name.toLowerCase();
  if (type.startsWith('GEOMETRY')) return 'geometry';
  if (type.includes('BLOB') || type.includes('BYTEA') || type.includes('BINARY') || type.includes('WKB')) return 'wkb';
  if (type.includes('VARCHAR') || type.includes('TEXT') || type.includes('STRING')) {
    if (name.includes('wkt') || name.includes('geom') || name.includes('geometry')) return 'wkt';
  }
  return null;
}

export function detectGeometryColumn(
  schema: PostgreSQLColumn[],
  requestedColumn?: string,
  requestedFormat: PostgreSQLGeometryFormat = 'auto'
): string | null {
  if (requestedColumn && schema.some((column) => column.name === requestedColumn)) return requestedColumn;
  const ranked = schema
    .map((column) => {
      const type = column.type.toUpperCase();
      const name = column.name.toLowerCase();
      let score = 0;
      if (type.startsWith('GEOMETRY')) score += 100;
      if (name === 'geometry' || name === 'geom') score += 60;
      if (name.includes('wkb') || name.includes('wkt')) score += 50;
      if (type.includes('BLOB') || type.includes('BYTEA') || type.includes('BINARY')) score += 20;
      if (type.includes('VARCHAR') || type.includes('TEXT') || type.includes('STRING')) score += 10;
      if (detectGeometryFormat(column, requestedFormat)) score += 5;
      return { column, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.column.name ?? null;
}

export function buildCountQuery(sql: string): string {
  return `SELECT COUNT(*) AS cnt FROM (${cleanSql(sql)}) AS q`;
}

export function buildResultQuery({
  sql,
  schema,
  geometryColumn,
  geometryFormat,
  sourceCrs,
  targetCrs,
  limit,
}: {
  sql: string;
  schema: PostgreSQLColumn[];
  geometryColumn: string;
  geometryFormat: Exclude<PostgreSQLGeometryFormat, 'auto'>;
  sourceCrs?: string;
  targetCrs?: string;
  limit: number;
}): string {
  const sourceSql = cleanSql(sql);
  const selectedColumns = schema
    .filter((column) => column.name !== geometryColumn && !column.name.startsWith('__'))
    .map((column) => `q.${quoteIdentifier(column.name)}`);
  const displaySelect = selectedColumns.length ? `${selectedColumns.join(', ')}, ` : '';
  const geometry = `q.${quoteIdentifier(geometryColumn)}`;
  const baseGeometry =
    geometryFormat === 'geometry'
      ? geometry
      : geometryFormat === 'wkt'
        ? `ST_GeomFromText(${geometry})`
        : `ST_GeomFromWKB(${geometry})`;
  const transformedGeometry =
    sourceCrs?.trim() && sourceCrs.trim() !== (targetCrs?.trim() || 'EPSG:4326')
      ? `ST_Transform(${baseGeometry}, '${escapeLiteral(sourceCrs.trim())}', '${escapeLiteral(
          targetCrs?.trim() || 'EPSG:4326'
        )}', true)`
      : baseGeometry;
  return `SELECT ${displaySelect}ST_AsWKB(${transformedGeometry}) AS __wkb FROM (${sourceSql}) AS q LIMIT ${limit}`;
}

export function buildTableQuery({
  schemaName,
  tableName,
  schema,
  geometryColumn,
  sourceCrs,
  targetCrs,
  limit,
}: {
  schemaName: string;
  tableName: string;
  schema: PostgreSQLColumn[];
  geometryColumn: string;
  sourceCrs?: string;
  targetCrs?: string;
  limit: number;
}): string {
  const selectedColumns = schema
    .filter((column) => column.name !== geometryColumn)
    .map((column) => quoteIdentifier(column.name));
  const source = sourceCrs?.trim();
  const target = targetCrs?.trim() || 'EPSG:4326';
  const geometryExpression =
    source && source !== target
      ? `ST_Transform(${quoteIdentifier(geometryColumn)}, '${escapeLiteral(source)}', '${escapeLiteral(target)}', true) AS ${quoteIdentifier(geometryColumn)}`
      : quoteIdentifier(geometryColumn);
  return `SELECT ${[...selectedColumns, geometryExpression].join(', ')}\nFROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(
    tableName
  )}\nLIMIT ${limit}`;
}
