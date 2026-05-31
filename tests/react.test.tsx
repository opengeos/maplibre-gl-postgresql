import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PostgreSQLControlReact } from '../src/react';

vi.mock('@deck.gl/mapbox', () => ({
  MapboxOverlay: class {
    setProps = vi.fn();
  },
}));

vi.mock('@geoarrow/deck.gl-geoarrow', () => ({
  GeoArrowPathLayer: class {},
  GeoArrowPolygonLayer: class {},
  GeoArrowScatterplotLayer: class {},
}));

vi.mock('../src/lib/postgresql/api', () => ({
  listSources: vi.fn(async () => [{ id: 'default', label: 'Default' }]),
  listTables: vi.fn(async () => []),
}));

function createMapStub() {
  const mapContainer = document.createElement('div');
  document.body.appendChild(mapContainer);
  const controls = new Set<unknown>();

  return {
    controls,
    map: {
      getContainer: () => mapContainer,
      addControl: vi.fn((control: unknown) => controls.add(control)),
      removeControl: vi.fn((control: unknown) => controls.delete(control)),
      hasControl: (control: unknown) => controls.has(control),
      on: vi.fn(),
      off: vi.fn(),
      triggerRepaint: vi.fn(),
      getCanvas: () => document.createElement('canvas'),
      getZoom: () => 2,
      fitBounds: vi.fn(),
      flyTo: vi.fn(),
    },
  };
}

describe('PostgreSQLControlReact', () => {
  it('mounts and removes a PostgreSQL control', () => {
    const { map, controls } = createMapStub();
    const { unmount } = render(<PostgreSQLControlReact map={map as never} title="PostgreSQL" />);

    expect(map.addControl).toHaveBeenCalledTimes(1);
    expect(controls.size).toBe(1);

    unmount();

    expect(map.removeControl).toHaveBeenCalledTimes(1);
    expect(controls.size).toBe(0);
  });

  it('forwards state changes', () => {
    const { map, controls } = createMapStub();
    const onStateChange = vi.fn();
    render(<PostgreSQLControlReact map={map as never} onStateChange={onStateChange} />);

    const control = Array.from(controls)[0] as { expand: () => void };
    control.expand();

    expect(onStateChange).toHaveBeenCalledWith(expect.objectContaining({ collapsed: false }));
  });
});
