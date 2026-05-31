# MapLibre GL PostgreSQL

A MapLibre GL JS control for querying and visualizing geospatial data from PostgreSQL through a DuckDB-backed API.

## Features

- Collapsible MapLibre control with a compact toolbar button.
- Server-managed PostgreSQL sources, so connection strings stay out of the browser.
- DuckDB native backend using the PostgreSQL and spatial extensions.
- SQL editor, table selector, geometry column selector, CRS transform inputs, and layer options.
- WKB result transport with GeoArrow and deck.gl rendering over MapLibre.
- Feature picking with attribute popups.
- React wrapper and state hook.
- Vite library build with ESM and CommonJS outputs.

## Architecture

The browser package does not connect directly to PostgreSQL. Browser DuckDB WASM cannot reliably use the PostgreSQL scanner extension because browser WASM cannot open native PostgreSQL socket connections. This package uses a small example backend:

```text
MapLibre control -> HTTP API -> native DuckDB -> PostgreSQL extension -> PostgreSQL
                                -> spatial WKB -> browser GeoArrow/deck.gl
```

The backend attaches configured PostgreSQL sources as read-only DuckDB catalogs.

## Installation

```bash
npm install maplibre-gl-postgresql
```

## Quick Start

```typescript
import maplibregl from 'maplibre-gl';
import { PostgreSQLControl } from 'maplibre-gl-postgresql';
import 'maplibre-gl-postgresql/style.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [-74, 40.72],
  zoom: 10,
});

map.on('load', () => {
  map.addControl(
    new PostgreSQLControl({
      title: 'PostgreSQL',
      apiBaseUrl: 'http://localhost:3000',
      sourceId: 'default',
      initialQuery: `SELECT *
FROM "pg"."public"."features"
LIMIT 1000`,
      geometryColumn: 'geom',
    }),
    'top-right'
  );
});
```

## Backend

The example backend lives in `server/`.

```bash
npm --prefix server install
POSTGRESQL_SOURCES='[{"id":"default","label":"Default","connectionString":"dbname=postgres user=postgres host=127.0.0.1"}]' \
  npm --prefix server run dev
```

API endpoints:

- `GET /api/sources`
- `GET /api/sources/:sourceId/tables`
- `GET /api/sources/:sourceId/tables/:schemaName/:tableName/columns`
- `POST /api/query`

`POST /api/query` accepts `sourceId`, `sql`, optional geometry settings, and `limit`. It returns schema metadata, rows, row indices, total row count, and base64 WKB values for rendering.

## React

```tsx
import { PostgreSQLControlReact, usePostgreSQLState } from 'maplibre-gl-postgresql/react';

const { state } = usePostgreSQLState({ collapsed: false });

{map && (
  <PostgreSQLControlReact
    map={map}
    collapsed={state.collapsed}
    apiBaseUrl="http://localhost:3000"
    sourceId="default"
    geometryColumn="geom"
    onQuery={(nextState) => console.log(nextState)}
  />
)}
```

## Development

```bash
npm install
npm --prefix server install
npm test
npm run build
npm run build:examples
npm run server:test
npm run server:build
```

## Docker

```bash
docker build -t maplibre-gl-postgresql .
docker run -p 3000:3000 \
  -e POSTGRESQL_SOURCES='[{"id":"default","label":"Default","connectionString":"dbname=postgres user=postgres host=host.docker.internal"}]' \
  maplibre-gl-postgresql
```

Open `http://localhost:3000/maplibre-gl-postgresql/`.

## Notes

Use read-only PostgreSQL users for browser-facing deployments. The example backend attaches sources with DuckDB `READ_ONLY`, but database-level permissions should still be scoped appropriately.
