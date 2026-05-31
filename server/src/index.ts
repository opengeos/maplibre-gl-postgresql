import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { getSource, parseSources, publicSources } from './config.js';
import { listPostgreSQLColumns, listPostgreSQLTables, queryPostgreSQL } from './duckdb.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const sources = parseSources();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

if (process.env.STATIC_DIR) {
  const staticDir = path.resolve(process.env.STATIC_DIR);
  app.use('/maplibre-gl-postgresql', express.static(staticDir));
  app.get('/', (_request, response) => {
    response.redirect('/maplibre-gl-postgresql/');
  });
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/sources', (_request, response) => {
  response.json({ sources: publicSources(sources) });
});

app.get('/api/sources/:sourceId/tables', async (request, response, next) => {
  try {
    const source = getSource(sources, request.params.sourceId);
    response.json({ tables: await listPostgreSQLTables(source) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sources/:sourceId/tables/:schemaName/:tableName/columns', async (request, response, next) => {
  try {
    const source = getSource(sources, request.params.sourceId);
    response.json({
      columns: await listPostgreSQLColumns(source, request.params.schemaName, request.params.tableName),
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/query', async (request, response, next) => {
  try {
    const sourceId = String(request.body?.sourceId ?? '');
    const sql = String(request.body?.sql ?? '');
    if (!sourceId || !sql.trim()) {
      response.status(400).json({ error: 'sourceId and sql are required' });
      return;
    }
    const source = getSource(sources, sourceId);
    response.json(
      await queryPostgreSQL(source, {
        sourceId,
        sql,
        geometryColumn: request.body.geometryColumn,
        geometryFormat: request.body.geometryFormat,
        sourceCrs: request.body.sourceCrs,
        targetCrs: request.body.targetCrs,
        limit: request.body.limit,
        layerName: request.body.layerName,
      })
    );
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const statusCode =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? Number((error as { statusCode: unknown }).statusCode)
      : 500;
  const message = error instanceof Error ? error.message : String(error);
  response.status(Number.isFinite(statusCode) ? statusCode : 500).json({ error: message });
});

app.listen(port, () => {
  console.log(`maplibre-gl-postgresql server listening on http://localhost:${port}`);
});
