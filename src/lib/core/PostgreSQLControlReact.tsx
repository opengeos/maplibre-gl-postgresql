import { useEffect, useRef } from 'react';
import { PostgreSQLControl } from './PostgreSQLControl';
import type { PostgreSQLControlReactProps } from './types';

export function PostgreSQLControlReact({
  map,
  onStateChange,
  onLoad,
  onQuery,
  onError,
  onSelect,
  ...options
}: PostgreSQLControlReactProps): null {
  const controlRef = useRef<PostgreSQLControl | null>(null);
  const previousApiBaseUrlRef = useRef(options.apiBaseUrl);
  const previousSourceIdRef = useRef(options.sourceId);
  const previousInitialQueryRef = useRef(options.initialQuery);

  useEffect(() => {
    if (!map) return;

    const control = new PostgreSQLControl(options);
    controlRef.current = control;

    if (onStateChange) {
      control.on('statechange', (event) => onStateChange(event.state));
    }
    if (onLoad) {
      control.on('load', (event) => onLoad(event.state));
    }
    if (onQuery) {
      control.on('query', (event) => onQuery(event.state));
    }
    if (onError) {
      control.on('error', (event) => onError(event.error ?? new Error('PostgreSQL operation failed'), event.state));
    }
    if (onSelect) {
      control.on('select', (event) => onSelect(event.selection ?? null, event.state));
    }

    map.addControl(control, options.position || 'top-right');

    return () => {
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
      controlRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || options.collapsed === undefined) return;
    if (options.collapsed) control.collapse();
    else control.expand();
  }, [options.collapsed]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || !options.apiBaseUrl || previousApiBaseUrlRef.current === options.apiBaseUrl) return;
    previousApiBaseUrlRef.current = options.apiBaseUrl;
    control.setApiBaseUrl(options.apiBaseUrl);
  }, [options.apiBaseUrl]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || !options.sourceId || previousSourceIdRef.current === options.sourceId) return;
    previousSourceIdRef.current = options.sourceId;
    control.selectSource(options.sourceId).catch(() => {});
  }, [options.sourceId]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control || !options.initialQuery || previousInitialQueryRef.current === options.initialQuery) return;
    previousInitialQueryRef.current = options.initialQuery;
    control.executeQuery(options.initialQuery).catch(() => {});
  }, [options.initialQuery]);

  return null;
}

export const PluginControlReact = PostgreSQLControlReact;
