import { getLayer, inBBox, isValidCoord, type Feature } from '@ind-intg/shared';
import { loadJson } from '../src/source.js';
import type { FeatureStore } from '../src/store.js';
import type { Logger, Worker } from '../src/worker.js';

export const USGS_FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';

export interface QuakeProps extends Record<string, unknown> {
  mag: number | null;
  magType: string | null;
  place: string | null;
  depthKm: number | null;
  url: string | null;
  tsunami: boolean;
}

interface UsgsFeature {
  id?: unknown;
  properties?: { mag?: unknown; magType?: unknown; place?: unknown; time?: unknown; url?: unknown; tsunami?: unknown; type?: unknown };
  geometry?: { type?: unknown; coordinates?: unknown };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' ? v : null);

/** USGS GeoJSON -> Features inside INDIA_BBOX. Malformed entries are dropped, never thrown on. */
export function parseUsgs(json: unknown): Feature<QuakeProps>[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) throw new Error('USGS response has no features array');
  const out: Feature<QuakeProps>[] = [];
  for (const raw of features as UsgsFeature[]) {
    const coords = raw.geometry?.type === 'Point' ? raw.geometry.coordinates : null;
    if (!Array.isArray(coords)) continue;
    const [lon, lat, depth] = coords as unknown[];
    const p = raw.properties ?? {};
    const ts = num(p.time);
    if (typeof raw.id !== 'string' || ts == null || !isValidCoord(lat, lon)) continue;
    if (!inBBox(lat as number, lon as number)) continue;
    out.push({
      id: raw.id,
      layer: 'quakes',
      lat: lat as number,
      lon: lon as number,
      ts,
      props: {
        mag: num(p.mag),
        magType: str(p.magType),
        place: str(p.place),
        depthKm: num(depth),
        url: str(p.url),
        tsunami: p.tsunami === 1,
      },
    });
  }
  return out;
}

export function createQuakesWorker(store: FeatureStore, log: Logger, url = process.env.USGS_FEED_URL || USGS_FEED_URL): Worker {
  const { ttlSeconds } = getLayer('quakes')!;
  return {
    layer: 'quakes',
    intervalMs: 60_000,
    async tick() {
      const features = parseUsgs(await loadJson(url));
      const { upserted, removed } = await store.sync('quakes', features, ttlSeconds);
      log.info({ layer: 'quakes', total: features.length, upserted, removed }, 'quakes synced');
    },
  };
}
