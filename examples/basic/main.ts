import maplibregl from 'maplibre-gl';
import { PostgreSQLControl } from '../../src/index';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [-74, 40.72],
  zoom: 10,
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

map.on('load', () => {
  const postgresqlControl = new PostgreSQLControl({
    title: 'PostgreSQL',
    collapsed: false,
    panelWidth: 360,
    apiBaseUrl: 'http://localhost:3000',
    sourceId: 'default',
    initialQuery: `SELECT *
FROM "pg"."public"."features"
LIMIT 1000`,
    geometryColumn: 'geom',
    geometryFormat: 'auto',
  });

  map.addControl(postgresqlControl, 'top-right');
  map.addControl(new maplibregl.GlobeControl(), 'top-right');

  postgresqlControl.on('statechange', (event) => {
    console.log('PostgreSQL state changed:', event.state);
  });
});
