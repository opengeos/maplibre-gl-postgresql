import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { Map } from 'maplibre-gl';
import { PostgreSQLControlReact, usePostgreSQLState } from '../../src/react';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, toggle } = usePostgreSQLState({ collapsed: false });

  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-74, 40.72],
      zoom: 10,
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstance.addControl(new maplibregl.FullscreenControl(), 'top-right');

    mapInstance.on('load', () => setMap(mapInstance));

    return () => mapInstance.remove();
  }, []);

  const handleStateChange = (newState: typeof state) => {
    console.log('PostgreSQL state changed:', newState);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      <button
        onClick={toggle}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1,
          padding: '8px 16px',
          background: '#4a90d9',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {state.collapsed ? 'Expand' : 'Collapse'} Panel
      </button>

      {map && (
        <PostgreSQLControlReact
          map={map}
          title="PostgreSQL"
          collapsed={state.collapsed}
          panelWidth={360}
          apiBaseUrl="http://localhost:3000"
          sourceId="default"
          initialQuery={`SELECT *
FROM "pg"."public"."features"
LIMIT 1000`}
          geometryColumn="geom"
          geometryFormat="auto"
          onStateChange={handleStateChange}
        />
      )}
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
