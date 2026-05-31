import maplibregl, { type IControl, type Map as MapLibreMap } from 'maplibre-gl';
import type { GeoArrowResult } from '@walkthru-earth/objex-utils';
import {
  decodeBase64,
  listColumns,
  listSources,
  listTables,
  runQuery,
} from '../postgresql/api';
import { DEFAULT_API_BASE_URL, DEFAULT_PAGE_SIZE, DEFAULT_PANEL_WIDTH, DEFAULT_QUERY, DEFAULT_TITLE } from '../postgresql/constants';
import {
  buildTableQuery,
  cleanSql,
  detectGeometryColumn,
  formatDisplayValue,
  friendlyError,
} from '../postgresql/utils';
import type { PostgreSQLRenderer, PostgreSQLPickInfo } from '../postgresql/renderer';
import type {
  PostgreSQLColumn,
  PostgreSQLControlEvent,
  PostgreSQLControlEventData,
  PostgreSQLControlEventHandler,
  PostgreSQLControlOptions,
  PostgreSQLFeatureSelection,
  PostgreSQLGeometryFormat,
  PostgreSQLLayerState,
  PostgreSQLSource,
  PostgreSQLState,
  PostgreSQLTable,
} from './types';

const DEFAULT_OPTIONS: Required<
  Omit<
    PostgreSQLControlOptions,
    'sourceId' | 'initialQuery' | 'geometryColumn' | 'layerName' | 'beforeId' | 'sourceCrs' | 'targetCrs'
  >
> = {
  collapsed: true,
  position: 'top-right',
  title: DEFAULT_TITLE,
  panelWidth: DEFAULT_PANEL_WIDTH,
  className: '',
  apiBaseUrl: DEFAULT_API_BASE_URL,
  geometryFormat: 'auto',
  pageSize: DEFAULT_PAGE_SIZE,
  fitBoundsOnLoad: true,
  pickable: true,
  interleaved: true,
};

type EventHandlersMap = globalThis.Map<PostgreSQLControlEvent, Set<PostgreSQLControlEventHandler>>;

interface LoadedPostgreSQLLayer {
  id: string;
  name: string;
  beforeId: string | null;
  query: string;
  schema: PostgreSQLColumn[];
  geometryColumn: string | null;
  geometryFormat: Exclude<PostgreSQLGeometryFormat, 'auto'> | null;
  totalRows: number;
  rows: Record<number, Record<string, unknown>>;
  geoArrowResults: GeoArrowResult[];
}

export class PostgreSQLControl implements IControl {
  private map?: MapLibreMap;
  private mapContainer?: HTMLElement;
  private container?: HTMLElement;
  private panel?: HTMLElement;
  private content?: HTMLElement;
  private renderer?: PostgreSQLRenderer;
  private popup: maplibregl.Popup | null = null;
  private options: Required<
    Omit<
      PostgreSQLControlOptions,
      'sourceId' | 'initialQuery' | 'geometryColumn' | 'layerName' | 'beforeId' | 'sourceCrs' | 'targetCrs'
    >
  > &
    Pick<
      PostgreSQLControlOptions,
      'sourceId' | 'initialQuery' | 'geometryColumn' | 'layerName' | 'beforeId' | 'sourceCrs' | 'targetCrs'
    >;
  private eventHandlers: EventHandlersMap = new globalThis.Map();
  private resizeHandler: (() => void) | null = null;
  private mapResizeHandler: (() => void) | null = null;

  private collapsed: boolean;
  private apiBaseUrl: string;
  private sources: PostgreSQLSource[] = [];
  private sourceId: string | null = null;
  private tables: PostgreSQLTable[] = [];
  private selectedTable: string | null = null;
  private tableColumns: PostgreSQLColumn[] = [];
  private queryText: string;
  private geometryColumn: string;
  private geometryFormat: PostgreSQLGeometryFormat;
  private sourceCrs: string;
  private targetCrs: string;
  private layerName: string;
  private beforeId: string;
  private layer: LoadedPostgreSQLLayer | null = null;
  private loading = false;
  private statusMessage = '';
  private error: string | null = null;
  private selectedFeature: PostgreSQLFeatureSelection | null = null;
  private pickable: boolean;

  constructor(options?: Partial<PostgreSQLControlOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.collapsed = this.options.collapsed;
    this.apiBaseUrl = this.options.apiBaseUrl;
    this.sourceId = this.options.sourceId ?? null;
    this.pickable = this.options.pickable;
    this.queryText = this.options.initialQuery ?? DEFAULT_QUERY;
    this.geometryColumn = this.options.geometryColumn ?? '';
    this.geometryFormat = this.options.geometryFormat;
    this.sourceCrs = this.options.sourceCrs ?? '';
    this.targetCrs = this.options.targetCrs ?? 'EPSG:4326';
    this.layerName = this.options.layerName ?? '';
    this.beforeId = this.options.beforeId ?? '';
  }

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    this.mapContainer = map.getContainer();
    this.container = this.createContainer();
    this.panel = this.createPanel();
    this.content = this.panel.querySelector('.postgresql-control-content') as HTMLElement;
    this.mapContainer.appendChild(this.panel);
    this.setupEventListeners();

    if (!this.collapsed) {
      this.panel.classList.add('expanded');
      requestAnimationFrame(() => this.updatePanelPosition());
    }
    this.renderContent();

    this.loadSources().catch(() => {});

    return this.container;
  }

  onRemove(): void {
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
    if (this.mapResizeHandler && this.map) this.map.off('resize', this.mapResizeHandler);

    this.popup?.remove();
    this.renderer?.remove();
    this.panel?.parentNode?.removeChild(this.panel);
    this.container?.parentNode?.removeChild(this.container);
    this.map = undefined;
    this.mapContainer = undefined;
    this.container = undefined;
    this.panel = undefined;
    this.content = undefined;
    this.renderer = undefined;
    this.eventHandlers.clear();
  }

  getState(): PostgreSQLState {
    return {
      collapsed: this.collapsed,
      panelWidth: this.options.panelWidth,
      apiBaseUrl: this.apiBaseUrl,
      sourceId: this.sourceId,
      sources: this.sources.map((source) => ({ ...source })),
      tables: this.tables.map((table) => ({ ...table })),
      selectedTable: this.selectedTable,
      tableColumns: this.tableColumns.map((column) => ({ ...column })),
      query: this.queryText,
      schema: this.layer ? [...this.layer.schema] : [],
      geometryColumn: this.layer?.geometryColumn ?? (this.geometryColumn || null),
      geometryFormat: this.geometryFormat,
      resolvedGeometryFormat: this.layer?.geometryFormat ?? null,
      pageSize: this.options.pageSize,
      totalRows: this.layer?.totalRows ?? -1,
      loadedRows: this.layer ? Object.keys(this.layer.rows).length : 0,
      layer: this.layer ? this.toLayerState(this.layer) : null,
      loading: this.loading,
      statusMessage: this.statusMessage,
      error: this.error,
      selectedFeature: this.selectedFeature,
      pickable: this.pickable,
    };
  }

  toggle(): void {
    this.collapsed = !this.collapsed;
    if (this.panel) {
      if (this.collapsed) {
        this.panel.classList.remove('expanded');
        this.emit('collapse');
      } else {
        this.panel.classList.add('expanded');
        this.updatePanelPosition();
        this.emit('expand');
      }
    }
    this.emit('statechange');
  }

  expand(): void {
    if (this.collapsed) this.toggle();
  }

  collapse(): void {
    if (!this.collapsed) this.toggle();
  }

  on(event: PostgreSQLControlEvent, handler: PostgreSQLControlEventHandler): void {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, new Set());
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: PostgreSQLControlEvent, handler: PostgreSQLControlEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  getMap(): MapLibreMap | undefined {
    return this.map;
  }

  getContainer(): HTMLElement | undefined {
    return this.container;
  }

  setApiBaseUrl(apiBaseUrl: string): void {
    this.apiBaseUrl = apiBaseUrl.trim() || DEFAULT_API_BASE_URL;
    this.loadSources().catch(() => {});
  }

  setPickable(pickable: boolean): void {
    this.pickable = pickable;
    this.renderer?.setPickable(pickable);
    if (!pickable) {
      this.selectedFeature = null;
      this.popup?.remove();
      this.popup = null;
      this.renderer?.setSelectedFeature(null, null);
    }
    void this.renderLayer();
    this.renderContent();
    this.emit('statechange');
  }

  async loadSources(): Promise<void> {
    this.emit('loadstart');
    this.setLoading('Loading PostgreSQL sources...');
    try {
      this.sources = await listSources(this.apiBaseUrl);
      const nextSourceId = this.sourceId ?? this.sources[0]?.id ?? null;
      if (nextSourceId) {
        await this.selectSource(nextSourceId);
      } else {
        this.loading = false;
        this.statusMessage = '';
        this.renderContent();
        this.emit('statechange');
      }
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async selectSource(sourceId: string): Promise<void> {
    const source = this.sources.find((item) => item.id === sourceId);
    if (!source) {
      throw new Error(`Unknown PostgreSQL source "${sourceId}"`);
    }
    this.emit('loadstart');
    this.setLoading(`Loading ${source.label}...`);
    try {
      this.sourceId = source.id;
      this.layer = null;
      this.selectedFeature = null;
      this.popup?.remove();
      this.popup = null;
      this.renderer?.clear();
      this.tables = await listTables(this.apiBaseUrl, source.id);
      this.selectedTable = this.findSelectedTableFromQuery(this.queryText)?.qualifiedName ?? this.tables[0]?.qualifiedName ?? null;
      this.tableColumns = this.selectedTable ? await this.getSelectedTableColumns(this.selectedTable) : [];
      this.geometryColumn = this.pickDefaultGeometryColumn(this.tableColumns);
      await this.setQueryFromFirstTable();
      this.loading = false;
      this.statusMessage = '';
      this.error = null;
      this.renderContent();
      this.emit('load');
      this.emit('statechange');
      if (this.options.initialQuery) {
        await this.executeQuery(this.options.initialQuery);
      }
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async executeQuery(sql = this.queryText): Promise<void> {
    if (!this.sourceId) {
      throw new Error('Select a PostgreSQL source before running a query');
    }
    const sourceSql = cleanSql(sql);
    if (!sourceSql) return;

    await this.runTask('Running query...', async () => {
      const rows: Record<number, Record<string, unknown>> = {};
      const result = await runQuery(this.apiBaseUrl, {
        sourceId: this.sourceId!,
        sql: sourceSql,
        geometryColumn: this.geometryColumn || undefined,
        geometryFormat: this.geometryFormat,
        sourceCrs: this.sourceCrs || undefined,
        targetCrs: this.targetCrs || undefined,
        limit: this.options.pageSize,
        layerName: this.layerName || undefined,
      });
      const wkbs = result.wkbBase64.map(decodeBase64);
      const indices = result.indices;
      result.rows.forEach((row, rowIndex) => {
        const index = indices[rowIndex] ?? rowIndex;
        rows[index] = {
          __index: index,
          __layer: this.layerName || 'PostgreSQL query',
          ...Object.fromEntries(Object.entries(row).map(([key, value]) => [key, formatDisplayValue(value)])),
        };
      });

      const attributes = new globalThis.Map([['__index', { values: indices, type: 'BIGINT' }]]);
      const geoArrowResults = wkbs.length
        ? (await import('@walkthru-earth/objex-utils')).buildGeoArrowTables(wkbs, attributes)
        : [];
      this.layer = {
        id: this.layer?.id ?? this.createLayerId(),
        name: this.layerName.trim() || 'PostgreSQL query',
        beforeId: this.beforeId.trim() || null,
        query: sourceSql,
        schema: result.schema,
        geometryColumn: result.geometryColumn,
        geometryFormat: result.geometryFormat,
        totalRows: result.totalRows,
        rows,
        geoArrowResults,
      };
      this.queryText = sourceSql;
      await this.renderLayer();
      if (this.options.fitBoundsOnLoad) this.fitToData(geoArrowResults);
      this.emit('query');
    });
  }

  clear(): void {
    this.layer = null;
    this.loading = false;
    this.statusMessage = '';
    this.error = null;
    this.selectedFeature = null;
    this.popup?.remove();
    this.popup = null;
    this.renderer?.clear();
    this.renderContent();
    this.emit('statechange');
  }

  private async setQueryFromFirstTable(): Promise<void> {
    if (this.options.initialQuery && cleanSql(this.queryText) === cleanSql(this.options.initialQuery)) return;
    if (this.queryText !== DEFAULT_QUERY) return;
    if (this.tables.length > 0) {
      await this.applySelectedTable(this.tables[0].qualifiedName);
    } else {
      this.queryText = `SELECT *\nFROM "public"."your_table"\nLIMIT ${this.options.pageSize}`;
    }
  }

  private async applySelectedTable(qualifiedName: string): Promise<void> {
    const table = this.tables.find((item) => item.qualifiedName === qualifiedName);
    if (!table) return;
    this.selectedTable = table.qualifiedName;
    this.tableColumns = await this.getSelectedTableColumns(table.qualifiedName);
    this.geometryColumn = this.pickDefaultGeometryColumn(this.tableColumns);
    this.queryText = this.buildSelectedTableQuery();
    this.layerName = table.tableName;
  }

  private async getSelectedTableColumns(qualifiedName: string): Promise<PostgreSQLColumn[]> {
    if (!this.sourceId) return [];
    const table = this.tables.find((item) => item.qualifiedName === qualifiedName);
    if (!table) return [];
    return listColumns(this.apiBaseUrl, this.sourceId, table.schemaName, table.tableName);
  }

  private clearQueryEditorState(): void {
    this.queryText = '';
    this.selectedTable = null;
    this.tableColumns = [];
    this.geometryColumn = '';
    this.layerName = '';
    this.layer = null;
    this.selectedFeature = null;
    this.popup?.remove();
    this.popup = null;
    this.renderer?.clear();
  }

  private buildSelectedTableQuery(): string {
    if (!this.selectedTable) return this.queryText;
    const geometryColumn = this.geometryColumn || this.pickDefaultGeometryColumn(this.tableColumns);
    if (!geometryColumn) {
      return `SELECT *\nFROM ${this.selectedTable}\nLIMIT ${this.options.pageSize}`;
    }
    return buildTableQuery({
      tableName: this.selectedTable,
      schema: this.tableColumns,
      geometryColumn,
      sourceCrs: this.sourceCrs,
      targetCrs: this.targetCrs,
      limit: this.options.pageSize,
    });
  }

  private pickDefaultGeometryColumn(columns: PostgreSQLColumn[]): string {
    const exact = columns.find((column) => ['geom', 'geometry'].includes(column.name.toLowerCase()));
    return exact?.name ?? detectGeometryColumn(columns, this.geometryColumn || undefined, this.geometryFormat) ?? '';
  }

  private findSelectedTableFromQuery(sql: string): PostgreSQLTable | null {
    const normalized = sql.replace(/"/g, '').toLowerCase();
    return (
      this.tables.find((table) => {
        const unquotedQualified = `${table.schemaName}.${table.tableName}`.toLowerCase();
        const quotedQualified = table.qualifiedName.replace(/"/g, '').toLowerCase();
        return normalized.includes(unquotedQualified) || normalized.includes(quotedQualified);
      }) ?? null
    );
  }

  private async runTask(message: string, task: () => Promise<void>): Promise<void> {
    try {
      this.setLoading(message);
      await task();
      this.loading = false;
      this.statusMessage = '';
      this.error = null;
      this.renderContent();
      this.emit('statechange');
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  private async getRenderer(): Promise<PostgreSQLRenderer | null> {
    if (!this.map) return null;
    if (!this.renderer) {
      const { PostgreSQLRenderer } = await import('../postgresql/renderer');
      this.renderer = new PostgreSQLRenderer(this.map, {
        onSelect: (selection) => this.handleMapSelect(selection),
        interleaved: this.options.interleaved,
      });
      this.renderer.setPickable(this.pickable);
    }
    return this.renderer;
  }

  private async renderLayer(): Promise<void> {
    if (!this.layer) {
      this.renderer?.clear();
      return;
    }
    const renderer = await this.getRenderer();
    if (!renderer) return;
    renderer.setPickable(this.pickable);
    renderer.setSelectedFeature(this.selectedFeature?.layerId ?? null, this.selectedFeature?.index ?? null);
    renderer.setData([
      {
        id: this.layer.id,
        name: this.layer.name,
        beforeId: this.layer.beforeId,
        results: this.layer.geoArrowResults,
      },
    ]);
  }

  private fitToData(results: GeoArrowResult[]): void {
    if (!this.map || !results.length) return;
    const minX = Math.min(...results.map((result) => result.bounds[0]));
    const minY = Math.min(...results.map((result) => result.bounds[1]));
    const maxX = Math.max(...results.map((result) => result.bounds[2]));
    const maxY = Math.max(...results.map((result) => result.bounds[3]));
    const bounds: [number, number, number, number] = [minX, minY, maxX, maxY];
    if (bounds.some((value) => !Number.isFinite(value))) return;
    const [west, south, east, north] = bounds;
    if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90) {
      return;
    }
    if (Math.abs(east - west) < 1e-9 && Math.abs(north - south) < 1e-9) {
      this.map.flyTo({ center: [west, south], zoom: Math.max(this.map.getZoom(), 12), duration: 500 });
    } else {
      this.map.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        { padding: 60, maxZoom: 15, duration: 500 }
      );
    }
  }

  private handleMapSelect(selection: PostgreSQLPickInfo | null): void {
    if (!this.pickable || !selection || !this.layer) {
      this.selectedFeature = null;
      this.popup?.remove();
      this.popup = null;
      this.renderer?.setSelectedFeature(null, null);
      this.renderContent();
      this.emit('select', { selection: null });
      this.emit('statechange');
      return;
    }

    this.selectedFeature = {
      layerId: this.layer.id,
      layerName: this.layer.name,
      index: selection.index,
      properties: this.layer.rows[selection.index] ?? { __index: selection.index },
    };
    this.renderer?.setSelectedFeature(this.layer.id, selection.index);
    void this.renderLayer();
    this.showAttributePopup(selection.coordinate);
    this.renderContent();
    this.emit('select', { selection: this.selectedFeature });
    this.emit('statechange');
  }

  private showAttributePopup(coordinate: [number, number] | null): void {
    if (!this.map || !this.selectedFeature || !coordinate) return;
    const rows = Object.entries(this.selectedFeature.properties)
      .filter(([key]) => !key.startsWith('__'))
      .slice(0, 8)
      .map(([key, value]) => `<tr><th>${this.escapeHtml(key)}</th><td>${this.escapeHtml(String(value ?? ''))}</td></tr>`)
      .join('');
    this.popup?.remove();
    this.popup = new maplibregl.Popup({
      className: 'postgresql-attribute-popup',
      closeButton: true,
      closeOnClick: false,
      maxWidth: '320px',
    })
      .setLngLat(coordinate)
      .setHTML(
        `<div class="postgresql-popup"><strong>${this.escapeHtml(this.selectedFeature.layerName)}</strong><table>${rows}</table></div>`
      )
      .addTo(this.map);
  }

  private setLoading(message: string): void {
    this.loading = true;
    this.statusMessage = message;
    this.error = null;
    this.renderContent();
    this.emit('progress');
    this.emit('statechange');
  }

  private handleError(error: unknown): void {
    const info = friendlyError(error);
    const actualError = error instanceof Error ? error : new Error(String(error));
    this.loading = false;
    this.statusMessage = '';
    this.error = [info.detail, info.suggestion].filter(Boolean).join(' ');
    this.renderContent();
    this.emit('error', { error: actualError });
    this.emit('statechange');
  }

  private emit(event: PostgreSQLControlEvent, extra: Partial<PostgreSQLControlEventData> = {}): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    const eventData: PostgreSQLControlEventData = {
      type: event,
      state: this.getState(),
      ...extra,
    };
    handlers.forEach((handler) => handler(eventData));
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group postgresql-control${
      this.options.className ? ` ${this.options.className}` : ''
    }`;

    const toggleButton = document.createElement('button');
    toggleButton.className = 'postgresql-control-toggle';
    toggleButton.type = 'button';
    toggleButton.setAttribute('aria-label', this.options.title);
    toggleButton.innerHTML = `
      <span class="postgresql-control-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <ellipse cx="12" cy="5" rx="7" ry="3"/>
          <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5"/>
          <path d="M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/>
        </svg>
      </span>
    `;
    toggleButton.addEventListener('click', () => this.toggle());
    container.appendChild(toggleButton);
    return container;
  }

  private createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'postgresql-control-panel';
    panel.style.width = `${this.options.panelWidth}px`;

    const header = document.createElement('div');
    header.className = 'postgresql-control-header';

    const title = document.createElement('span');
    title.className = 'postgresql-control-title';
    title.textContent = this.options.title;

    const closeButton = document.createElement('button');
    closeButton.className = 'postgresql-control-close';
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Close panel');
    closeButton.innerHTML = '&times;';
    closeButton.addEventListener('click', () => this.collapse());

    const content = document.createElement('div');
    content.className = 'postgresql-control-content';

    header.appendChild(title);
    header.appendChild(closeButton);
    panel.appendChild(header);
    panel.appendChild(content);
    return panel;
  }

  private setupEventListeners(): void {
    this.resizeHandler = () => {
      if (!this.collapsed) this.updatePanelPosition();
    };
    window.addEventListener('resize', this.resizeHandler);

    this.mapResizeHandler = () => {
      if (!this.collapsed) this.updatePanelPosition();
    };
    this.map?.on('resize', this.mapResizeHandler);
  }

  private getControlPosition(): 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
    const parent = this.container?.parentElement;
    if (!parent) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';
    return 'top-right';
  }

  private updatePanelPosition(): void {
    if (!this.container || !this.panel || !this.mapContainer) return;
    const button = this.container.querySelector('.postgresql-control-toggle');
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this.mapContainer.getBoundingClientRect();
    const position = this.getControlPosition();
    const top = buttonRect.top - mapRect.top;
    const bottom = mapRect.bottom - buttonRect.bottom;
    const left = buttonRect.left - mapRect.left;
    const right = mapRect.right - buttonRect.right;
    const gap = 5;

    this.panel.style.top = '';
    this.panel.style.bottom = '';
    this.panel.style.left = '';
    this.panel.style.right = '';

    if (position === 'top-left') {
      this.panel.style.top = `${top + buttonRect.height + gap}px`;
      this.panel.style.left = `${left}px`;
    } else if (position === 'top-right') {
      this.panel.style.top = `${top + buttonRect.height + gap}px`;
      this.panel.style.right = `${right}px`;
    } else if (position === 'bottom-left') {
      this.panel.style.bottom = `${bottom + buttonRect.height + gap}px`;
      this.panel.style.left = `${left}px`;
    } else {
      this.panel.style.bottom = `${bottom + buttonRect.height + gap}px`;
      this.panel.style.right = `${right}px`;
    }
  }

  private renderContent(): void {
    if (!this.content) return;
    this.content.replaceChildren();
    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.renderLoadSection());
    fragment.appendChild(this.renderQuerySection());
    fragment.appendChild(this.renderStatusSection());
    if (this.layer) {
      fragment.appendChild(this.renderResultSection());
    }
    if (this.selectedFeature) {
      fragment.appendChild(this.renderSelectionSection());
    }
    this.content.appendChild(fragment);
  }

  private renderLoadSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'postgresql-control-section';

    const sourceLabel = document.createElement('label');
    sourceLabel.className = 'postgresql-control-label';
    sourceLabel.textContent = 'PostgreSQL source';
    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'postgresql-control-input postgresql-control-source';
    sourceSelect.disabled = this.loading || this.sources.length === 0;
    if (this.sources.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No sources available';
      sourceSelect.appendChild(option);
    }
    this.sources.forEach((source) => {
      const option = document.createElement('option');
      option.value = source.id;
      option.textContent = source.label;
      option.selected = source.id === this.sourceId;
      sourceSelect.appendChild(option);
    });
    sourceSelect.addEventListener('change', () => {
      if (sourceSelect.value) this.selectSource(sourceSelect.value).catch((error) => this.handleError(error));
    });
    sourceLabel.appendChild(sourceSelect);
    section.appendChild(sourceLabel);

    const apiLabel = document.createElement('label');
    apiLabel.className = 'postgresql-control-label';
    apiLabel.textContent = 'API base URL';
    const apiRow = document.createElement('div');
    apiRow.className = 'postgresql-control-row';
    const apiInput = document.createElement('input');
    apiInput.className = 'postgresql-control-input postgresql-control-api-url';
    apiInput.type = 'text';
    apiInput.value = this.apiBaseUrl;
    apiInput.disabled = this.loading;
    apiInput.addEventListener('input', () => {
      this.apiBaseUrl = apiInput.value.trim() || DEFAULT_API_BASE_URL;
    });
    const refreshButton = document.createElement('button');
    refreshButton.className = 'postgresql-control-button';
    refreshButton.type = 'button';
    refreshButton.textContent = 'Refresh';
    refreshButton.disabled = this.loading;
    refreshButton.addEventListener('click', () => this.loadSources().catch(() => {}));
    apiRow.appendChild(apiInput);
    apiRow.appendChild(refreshButton);
    apiLabel.appendChild(apiRow);
    section.appendChild(apiLabel);

    const pickableLabel = document.createElement('label');
    pickableLabel.className = 'postgresql-control-check';
    const pickableInput = document.createElement('input');
    pickableInput.type = 'checkbox';
    pickableInput.checked = this.pickable;
    pickableInput.addEventListener('change', () => this.setPickable(pickableInput.checked));
    const pickableText = document.createElement('span');
    pickableText.textContent = 'Show attribute popup on feature click';
    pickableLabel.appendChild(pickableInput);
    pickableLabel.appendChild(pickableText);
    section.appendChild(pickableLabel);

    if (this.sourceId) {
      const clearButton = document.createElement('button');
      clearButton.className = 'postgresql-control-secondary-button';
      clearButton.type = 'button';
      clearButton.textContent = 'Clear';
      clearButton.disabled = this.loading;
      clearButton.addEventListener('click', () => this.clear());
      section.appendChild(clearButton);
    }

    return section;
  }

  private renderQuerySection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'postgresql-control-section';

    if (this.tables.length > 0) {
      const tableLabel = document.createElement('label');
      tableLabel.className = 'postgresql-control-label';
      tableLabel.textContent = 'Table';
      const tableSelect = document.createElement('select');
      tableSelect.className = 'postgresql-control-input postgresql-control-table';
      tableSelect.disabled = this.loading;
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a table';
      placeholder.selected = this.selectedTable === null;
      tableSelect.appendChild(placeholder);
      this.tables.forEach((table) => {
        const option = document.createElement('option');
        option.value = table.qualifiedName;
        option.textContent = table.displayName;
        option.selected = table.qualifiedName === this.selectedTable;
        tableSelect.appendChild(option);
      });
      tableSelect.addEventListener('change', () => {
        if (!tableSelect.value) {
          this.clearQueryEditorState();
          this.renderContent();
          this.emit('statechange');
          return;
        }
        this.applySelectedTable(tableSelect.value)
          .then(() => {
            this.renderContent();
            this.emit('statechange');
          })
          .catch((error) => this.handleError(error));
      });
      tableLabel.appendChild(tableSelect);
      section.appendChild(tableLabel);
    }

    const queryLabel = document.createElement('label');
    queryLabel.className = 'postgresql-control-label';
    queryLabel.textContent = 'SQL query';
    const textarea = document.createElement('textarea');
    textarea.className = 'postgresql-control-textarea postgresql-control-sql';
    textarea.rows = 7;
    textarea.value = this.queryText;
    textarea.disabled = this.loading;
    textarea.addEventListener('input', () => {
      if (!textarea.value.trim()) {
        this.clearQueryEditorState();
        this.renderContent();
        this.emit('statechange');
        return;
      }
      this.queryText = textarea.value;
    });
    queryLabel.appendChild(textarea);
    section.appendChild(queryLabel);

    if (!this.queryText.trim()) {
      const runButton = document.createElement('button');
      runButton.className = 'postgresql-control-button';
      runButton.type = 'button';
      runButton.textContent = 'Run query';
      runButton.disabled = true;
      section.appendChild(runButton);
      return section;
    }

    const fields = document.createElement('div');
    fields.className = 'postgresql-control-grid';
    fields.appendChild(this.createGeometryColumnField());
    fields.appendChild(this.createSelectField('Geometry format', this.geometryFormat, ['auto', 'geometry', 'wkb', 'wkt'], (value) => {
      this.geometryFormat = value as PostgreSQLGeometryFormat;
    }));
    fields.appendChild(this.createTextField('Source CRS', this.sourceCrs, (value) => {
      this.sourceCrs = value;
      if (this.selectedTable) this.queryText = this.buildSelectedTableQuery();
    }));
    fields.appendChild(this.createTextField('Target CRS', this.targetCrs, (value) => {
      this.targetCrs = value;
      if (this.selectedTable) this.queryText = this.buildSelectedTableQuery();
    }));
    fields.appendChild(this.createTextField('Layer name', this.layerName, (value) => {
      this.layerName = value;
    }));
    fields.appendChild(this.createTextField('before_id', this.beforeId, (value) => {
      this.beforeId = value;
    }));
    section.appendChild(fields);

    const runButton = document.createElement('button');
    runButton.className = 'postgresql-control-button';
    runButton.type = 'button';
    runButton.textContent = 'Run query';
    runButton.disabled = this.loading || !this.sourceId;
    runButton.addEventListener('click', () => this.executeQuery().catch(() => {}));
    section.appendChild(runButton);
    return section;
  }

  private createGeometryColumnField(): HTMLLabelElement {
    if (this.tableColumns.length === 0) {
      return this.createTextField('Geometry column', this.geometryColumn, (value) => {
        this.geometryColumn = value;
      });
    }

    const label = document.createElement('label');
    label.className = 'postgresql-control-label';
    label.textContent = 'Geometry column';
    const select = document.createElement('select');
    select.className = 'postgresql-control-input postgresql-control-geometry-column';
    select.disabled = this.loading;
    this.tableColumns.forEach((column) => {
      const option = document.createElement('option');
      option.value = column.name;
      option.textContent = column.name;
      option.selected = column.name === this.geometryColumn;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      this.geometryColumn = select.value;
      if (this.selectedTable) {
        this.queryText = this.buildSelectedTableQuery();
        this.renderContent();
        this.emit('statechange');
      }
    });
    label.appendChild(select);
    return label;
  }

  private createTextField(labelText: string, value: string, onInput: (value: string) => void): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'postgresql-control-label';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.className = 'postgresql-control-input';
    input.type = 'text';
    input.value = value;
    input.disabled = this.loading;
    input.addEventListener('input', () => onInput(input.value));
    label.appendChild(input);
    return label;
  }

  private createSelectField(
    labelText: string,
    value: string,
    values: string[],
    onChange: (value: string) => void
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'postgresql-control-label';
    label.textContent = labelText;
    const select = document.createElement('select');
    select.className = 'postgresql-control-input';
    select.disabled = this.loading;
    values.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      option.selected = item === value;
      select.appendChild(option);
    });
    select.addEventListener('change', () => onChange(select.value));
    label.appendChild(select);
    return label;
  }

  private renderStatusSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'postgresql-control-section';
    if (this.statusMessage) {
      const status = document.createElement('div');
      status.className = 'postgresql-control-status';
      status.textContent = this.statusMessage;
      section.appendChild(status);
    }
    if (this.error) {
      const error = document.createElement('div');
      error.className = 'postgresql-control-error';
      error.textContent = this.error;
      section.appendChild(error);
    }
    if (!section.childElementCount) {
      const placeholder = document.createElement('p');
      placeholder.className = 'postgresql-control-placeholder';
      placeholder.textContent = this.sourceId
        ? 'Run a SQL query that returns a geometry, WKB, or WKT column.'
        : 'Select a PostgreSQL source to query and visualize geospatial rows.';
      section.appendChild(placeholder);
    }
    return section;
  }

  private renderResultSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'postgresql-control-section postgresql-control-summary';
    const items: [string, string][] = [
      ['Source', this.sources.find((source) => source.id === this.sourceId)?.label ?? this.sourceId ?? ''],
      ['Layer', this.layer!.name],
      ['before_id', this.layer!.beforeId ?? ''],
      ['Rows', this.layer!.totalRows >= 0 ? this.layer!.totalRows.toLocaleString() : 'Unknown'],
      ['Loaded', Object.keys(this.layer!.rows).length.toLocaleString()],
      ['Geometry', this.layer!.geometryColumn ?? 'Not detected'],
      ['Format', this.layer!.geometryFormat ?? 'Not detected'],
    ];
    items.forEach(([label, value]) => {
      const row = document.createElement('div');
      row.className = 'postgresql-control-summary-row';
      const key = document.createElement('span');
      key.textContent = label;
      const val = document.createElement('strong');
      val.textContent = value;
      row.appendChild(key);
      row.appendChild(val);
      section.appendChild(row);
    });
    return section;
  }

  private renderSelectionSection(): HTMLElement {
    const section = document.createElement('div');
    section.className = 'postgresql-control-section';
    const title = document.createElement('div');
    title.className = 'postgresql-control-section-title';
    title.textContent = `Selected ${this.selectedFeature!.layerName} #${this.selectedFeature!.index + 1}`;
    section.appendChild(title);

    const list = document.createElement('dl');
    list.className = 'postgresql-control-properties';
    Object.entries(this.selectedFeature!.properties)
      .filter(([key]) => !key.startsWith('__'))
      .slice(0, 20)
      .forEach(([key, value]) => {
        const term = document.createElement('dt');
        term.textContent = key;
        const description = document.createElement('dd');
        description.textContent = String(value ?? '');
        list.appendChild(term);
        list.appendChild(description);
      });
    section.appendChild(list);
    return section;
  }

  private toLayerState(layer: LoadedPostgreSQLLayer): PostgreSQLLayerState {
    return {
      id: layer.id,
      name: layer.name,
      beforeId: layer.beforeId,
      query: layer.query,
      schema: [...layer.schema],
      geometryColumn: layer.geometryColumn,
      geometryFormat: layer.geometryFormat,
      totalRows: layer.totalRows,
      loadedRows: Object.keys(layer.rows).length,
    };
  }

  private createLayerId(): string {
    return `layer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => {
      const entities: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return entities[char] ?? char;
    });
  }
}

export const PluginControl = PostgreSQLControl;
