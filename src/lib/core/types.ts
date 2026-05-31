import type { Map } from 'maplibre-gl';

export type PostgreSQLControlPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type PostgreSQLGeometryFormat = 'auto' | 'geometry' | 'wkb' | 'wkt';

export interface PostgreSQLColumn {
  name: string;
  type: string;
  nullable: boolean;
}

export interface PostgreSQLTable {
  schemaName: string;
  tableName: string;
  qualifiedName: string;
  displayName: string;
}

export interface PostgreSQLSource {
  id: string;
  label: string;
}

export interface PostgreSQLFeatureSelection {
  layerId: string;
  layerName: string;
  index: number;
  properties: Record<string, unknown>;
}

export interface PostgreSQLLayerState {
  id: string;
  name: string;
  beforeId: string | null;
  query: string;
  schema: PostgreSQLColumn[];
  geometryColumn: string | null;
  geometryFormat: Exclude<PostgreSQLGeometryFormat, 'auto'> | null;
  totalRows: number;
  loadedRows: number;
}

export interface PostgreSQLState {
  collapsed: boolean;
  panelWidth: number;
  apiBaseUrl: string;
  sourceId: string | null;
  sources: PostgreSQLSource[];
  tables: PostgreSQLTable[];
  selectedTable: string | null;
  tableColumns: PostgreSQLColumn[];
  query: string;
  schema: PostgreSQLColumn[];
  geometryColumn: string | null;
  geometryFormat: PostgreSQLGeometryFormat;
  resolvedGeometryFormat: Exclude<PostgreSQLGeometryFormat, 'auto'> | null;
  pageSize: number;
  totalRows: number;
  loadedRows: number;
  layer: PostgreSQLLayerState | null;
  loading: boolean;
  statusMessage: string;
  error: string | null;
  selectedFeature: PostgreSQLFeatureSelection | null;
  pickable: boolean;
}

export interface PostgreSQLControlOptions {
  collapsed?: boolean;
  position?: PostgreSQLControlPosition;
  title?: string;
  panelWidth?: number;
  className?: string;
  apiBaseUrl?: string;
  sourceId?: string;
  initialQuery?: string;
  geometryColumn?: string;
  geometryFormat?: PostgreSQLGeometryFormat;
  sourceCrs?: string;
  targetCrs?: string;
  pageSize?: number;
  fitBoundsOnLoad?: boolean;
  pickable?: boolean;
  layerName?: string;
  beforeId?: string;
  interleaved?: boolean;
}

export interface PostgreSQLControlReactProps extends PostgreSQLControlOptions {
  map: Map;
  onStateChange?: (state: PostgreSQLState) => void;
  onLoad?: (state: PostgreSQLState) => void;
  onQuery?: (state: PostgreSQLState) => void;
  onError?: (error: Error, state: PostgreSQLState) => void;
  onSelect?: (selection: PostgreSQLFeatureSelection | null, state: PostgreSQLState) => void;
}

export type PostgreSQLControlEvent =
  | 'collapse'
  | 'expand'
  | 'statechange'
  | 'loadstart'
  | 'progress'
  | 'load'
  | 'query'
  | 'error'
  | 'select';

export interface PostgreSQLControlEventData {
  type: PostgreSQLControlEvent;
  state: PostgreSQLState;
  error?: Error;
  selection?: PostgreSQLFeatureSelection | null;
}

export type PostgreSQLControlEventHandler = (event: PostgreSQLControlEventData) => void;

export type PluginControlOptions = PostgreSQLControlOptions;
export type PluginState = PostgreSQLState;
export type PluginControlReactProps = PostgreSQLControlReactProps;
export type PluginControlEvent = PostgreSQLControlEvent;
export type PluginControlEventHandler = PostgreSQLControlEventHandler;
