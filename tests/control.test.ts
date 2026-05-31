import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgreSQLControl } from '../src';

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
  decodeBase64: vi.fn(() => new Uint8Array([1, 2, 3])),
  listSources: vi.fn(async () => [{ id: 'default', label: 'Default' }]),
  listTables: vi.fn(async () => [
    {
      schemaName: 'public',
      tableName: 'nyc_neighborhoods',
      qualifiedName: '"pg"."public"."nyc_neighborhoods"',
      displayName: 'public.nyc_neighborhoods',
    },
    {
      schemaName: 'public',
      tableName: 'nyc_subway_stations',
      qualifiedName: '"pg"."public"."nyc_subway_stations"',
      displayName: 'public.nyc_subway_stations',
    },
  ]),
  listColumns: vi.fn(async (_apiBaseUrl: string, _sourceId: string, _schemaName: string, tableName: string) =>
    tableName.includes('subway')
      ? [
          { name: 'OBJECTID', type: 'DOUBLE', nullable: true },
          { name: 'NAME', type: 'VARCHAR', nullable: true },
          { name: 'geom', type: 'GEOMETRY', nullable: true },
        ]
      : [
          { name: 'BORONAME', type: 'VARCHAR', nullable: true },
          { name: 'NAME', type: 'VARCHAR', nullable: true },
          { name: 'geom', type: 'GEOMETRY', nullable: true },
        ]
  ),
  runQuery: vi.fn(async () => ({
    schema: [
      { name: 'id', type: 'INTEGER', nullable: true },
      { name: 'geom', type: 'GEOMETRY', nullable: true },
    ],
    geometryColumn: 'geom',
    geometryFormat: 'geometry',
    totalRows: 1,
    rows: [{ id: 1 }],
    wkbBase64: ['AQID'],
    indices: [0],
  })),
}));

function createMapStub() {
  const mapContainer = document.createElement('div');
  document.body.appendChild(mapContainer);
  const controls = new Set<unknown>();

  return {
    mapContainer,
    map: {
      getContainer: () => mapContainer,
      addControl: (control: unknown) => controls.add(control),
      removeControl: (control: unknown) => controls.delete(control),
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

describe('PostgreSQLControl', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('creates the compact button and floating panel', () => {
    const { map, mapContainer } = createMapStub();
    const control = new PostgreSQLControl({ title: 'PostgreSQL', collapsed: true });

    const container = control.onAdd(map as never);

    expect(container.querySelector('.postgresql-control-toggle')).toBeTruthy();
    expect(mapContainer.querySelector('.postgresql-control-panel')).toBeTruthy();
    expect(control.getState().collapsed).toBe(true);
  });

  it('emits expand and collapse events when toggled', () => {
    const { map } = createMapStub();
    const control = new PostgreSQLControl();
    const expandHandler = vi.fn();
    const collapseHandler = vi.fn();

    control.on('expand', expandHandler);
    control.on('collapse', collapseHandler);
    control.onAdd(map as never);

    control.expand();
    control.collapse();

    expect(expandHandler).toHaveBeenCalledTimes(1);
    expect(collapseHandler).toHaveBeenCalledTimes(1);
  });

  it('keeps the panel open on outside document clicks', () => {
    const { map } = createMapStub();
    const control = new PostgreSQLControl({ collapsed: false });
    control.onAdd(map as never);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(control.getState().collapsed).toBe(false);
  });

  it('removes panel and button on cleanup', () => {
    const { map, mapContainer } = createMapStub();
    const control = new PostgreSQLControl();
    const container = control.onAdd(map as never);
    mapContainer.appendChild(container);

    control.onRemove();

    expect(mapContainer.querySelector('.postgresql-control-panel')).toBeNull();
    expect(container.parentNode).toBeNull();
  });

  it('renders source controls, SQL textarea, and pickable toggle', () => {
    const { map, mapContainer } = createMapStub();
    const control = new PostgreSQLControl({
      pickable: false,
      collapsed: false,
    });

    control.onAdd(map as never);

    const apiInput = mapContainer.querySelector<HTMLInputElement>('.postgresql-control-api-url');
    const sourceSelect = mapContainer.querySelector<HTMLSelectElement>('.postgresql-control-source');
    const sqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.postgresql-control-sql');
    const pickableInput = mapContainer.querySelector<HTMLInputElement>(
      '.postgresql-control-check input[type="checkbox"]'
    );

    expect(apiInput?.value).toBe('http://localhost:3000');
    expect(sourceSelect).toBeTruthy();
    expect(sqlInput?.value).toContain('SELECT');
    expect(pickableInput?.checked).toBe(false);

    control.setPickable(true);

    expect(control.getState().pickable).toBe(true);
  });

  it('renders layer name and before_id inputs for query options', () => {
    const { map, mapContainer } = createMapStub();
    const control = new PostgreSQLControl({
      beforeId: 'settlement-label',
      collapsed: false,
      layerName: 'Cities',
    });

    control.onAdd(map as never);

    const inputs = Array.from(mapContainer.querySelectorAll<HTMLInputElement>('.postgresql-control-input'));

    expect(inputs.some((input) => input.value === 'Cities')).toBe(true);
    expect(inputs.some((input) => input.value === 'settlement-label')).toBe(true);
  });

  it('renders table and geometry selectors and updates SQL when a table is selected', async () => {
    const { map, mapContainer } = createMapStub();
    const control = new PostgreSQLControl({ collapsed: false });
    control.onAdd(map as never);
    await vi.waitFor(() => expect(control.getState().sources).toHaveLength(1));

    Object.assign(control as unknown as { tables: unknown[]; selectedTable: string | null; tableColumns: unknown[]; geometryColumn: string }, {
      tables: [
        {
          schemaName: 'public',
          tableName: 'nyc_neighborhoods',
          qualifiedName: '"pg"."public"."nyc_neighborhoods"',
          displayName: 'public.nyc_neighborhoods',
        },
        {
          schemaName: 'public',
          tableName: 'nyc_subway_stations',
          qualifiedName: '"pg"."public"."nyc_subway_stations"',
          displayName: 'public.nyc_subway_stations',
        },
      ],
      sourceId: 'default',
      selectedTable: '"pg"."public"."nyc_neighborhoods"',
      tableColumns: [
        { name: 'BORONAME', type: 'VARCHAR', nullable: true },
        { name: 'NAME', type: 'VARCHAR', nullable: true },
        { name: 'geom', type: 'GEOMETRY', nullable: true },
      ],
      geometryColumn: 'geom',
    });
    control.setPickable(true);

    const tableSelect = mapContainer.querySelector<HTMLSelectElement>('.postgresql-control-table');
    const geometrySelect = mapContainer.querySelector<HTMLSelectElement>('.postgresql-control-geometry-column');
    const sqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.postgresql-control-sql');

    expect(tableSelect?.options).toHaveLength(3);
    expect(geometrySelect?.value).toBe('geom');
    tableSelect!.value = '"pg"."public"."nyc_subway_stations"';
    tableSelect!.dispatchEvent(new Event('change'));

    expect(sqlInput?.value).toContain('SELECT');
    await vi.waitFor(() => {
      const nextSqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.postgresql-control-sql');
      expect(nextSqlInput?.value).toContain('"pg"."public"."nyc_subway_stations"');
    });
  });

  it('clears query-specific controls when SQL is emptied', () => {
    const { map, mapContainer } = createMapStub();
    const control = new PostgreSQLControl({ collapsed: false });
    control.onAdd(map as never);

    Object.assign(control as unknown as { tables: unknown[]; selectedTable: string | null; tableColumns: unknown[]; geometryColumn: string; layerName: string }, {
      tables: [
        {
          schemaName: 'public',
          tableName: 'nyc_streets',
          qualifiedName: '"pg"."public"."nyc_streets"',
          displayName: 'public.nyc_streets',
        },
      ],
      sourceId: 'default',
      selectedTable: '"pg"."public"."nyc_streets"',
      tableColumns: [
        { name: 'ID', type: 'INTEGER', nullable: true },
        { name: 'geom', type: 'GEOMETRY', nullable: true },
      ],
      geometryColumn: 'geom',
      layerName: 'nyc_streets',
    });
    control.setPickable(true);

    const sqlInput = mapContainer.querySelector<HTMLTextAreaElement>('.postgresql-control-sql')!;
    sqlInput.value = '';
    sqlInput.dispatchEvent(new Event('input'));

    const nextTableSelect = mapContainer.querySelector<HTMLSelectElement>('.postgresql-control-table');
    const nextGeometrySelect = mapContainer.querySelector<HTMLSelectElement>('.postgresql-control-geometry-column');
    const runButton = Array.from(mapContainer.querySelectorAll<HTMLButtonElement>('.postgresql-control-button')).find(
      (button) => button.textContent === 'Run query'
    );

    expect(nextTableSelect?.value).toBe('');
    expect(nextGeometrySelect).toBeNull();
    expect(runButton?.disabled).toBe(true);
    expect(control.getState().query).toBe('');
    expect(control.getState().selectedTable).toBeNull();
  });
});
