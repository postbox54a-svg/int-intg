import type { LayerId } from './layers.js';

/** The one shape every worker normalises its source data into. */
export interface Feature<P extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable id, unique within a layer (e.g. USGS event id, ICAO hex, MMSI). */
  id: string;
  layer: LayerId;
  lat: number;
  lon: number;
  /** Observation time, epoch milliseconds (UTC). Display in IST. */
  ts: number;
  props: P;
}

export function isValidCoord(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}
