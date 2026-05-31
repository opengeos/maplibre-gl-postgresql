import { describe, expect, it } from 'vitest';
import {
  buildAttachSql,
  buildCountQuery,
  buildResultQuery,
  cleanSql,
  detectGeometryColumn,
  escapeLiteral,
  quoteIdentifier,
  type PostgreSQLColumn,
} from '../src/sql.js';

const schema: PostgreSQLColumn[] = [
  { name: 'id', type: 'INTEGER', nullable: false },
  { name: 'name', type: 'VARCHAR', nullable: true },
  { name: 'geom', type: 'GEOMETRY', nullable: true },
];

describe('server SQL helpers', () => {
  it('escapes literals and quotes identifiers', () => {
    expect(escapeLiteral("Bob's db")).toBe("Bob''s db");
    expect(quoteIdentifier('weird"name')).toBe('"weird""name"');
  });

  it('builds read-only Postgres attach SQL', () => {
    expect(buildAttachSql("dbname='demo'", 'pg')).toBe('ATTACH \'dbname=\'\'demo\'\'\' AS "pg" (TYPE postgres, READ_ONLY)');
  });

  it('builds count and WKB result queries', () => {
    const sql = 'SELECT id, name, geom FROM "pg"."public"."features";';

    expect(cleanSql(sql)).not.toMatch(/;$/);
    expect(buildCountQuery(sql)).toContain('COUNT(*)');
    expect(
      buildResultQuery({
        sql,
        schema,
        geometryColumn: 'geom',
        geometryFormat: 'geometry',
        limit: 100,
      })
    ).toContain('ST_AsWKB(q."geom") AS __wkb');
  });

  it('detects likely geometry columns', () => {
    expect(detectGeometryColumn(schema)).toBe('geom');
  });
});
