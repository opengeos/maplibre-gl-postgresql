export interface PostgreSQLSourceConfig {
  id: string;
  label: string;
  connectionString: string;
}

export interface PublicPostgreSQLSource {
  id: string;
  label: string;
}

export function parseSources(value = process.env.POSTGRESQL_SOURCES): PostgreSQLSourceConfig[] {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('POSTGRESQL_SOURCES must be a JSON array');
  }
  return parsed.map((source, index) => {
    if (!source || typeof source !== 'object') {
      throw new Error(`POSTGRESQL_SOURCES[${index}] must be an object`);
    }
    const candidate = source as Record<string, unknown>;
    const id = String(candidate.id ?? '').trim();
    const label = String(candidate.label ?? id).trim();
    const connectionString = String(candidate.connectionString ?? '').trim();
    if (!id || !label || !connectionString) {
      throw new Error(`POSTGRESQL_SOURCES[${index}] requires id, label, and connectionString`);
    }
    return { id, label, connectionString };
  });
}

export function publicSources(sources: PostgreSQLSourceConfig[]): PublicPostgreSQLSource[] {
  return sources.map(({ id, label }) => ({ id, label }));
}

export function getSource(sources: PostgreSQLSourceConfig[], sourceId: string): PostgreSQLSourceConfig {
  const source = sources.find((item) => item.id === sourceId);
  if (!source) {
    throw Object.assign(new Error(`Unknown PostgreSQL source "${sourceId}"`), { statusCode: 404 });
  }
  return source;
}
