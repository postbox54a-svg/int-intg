export const LAYER_IDS = ['quakes', 'flights', 'alerts', 'news', 'ships'] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export interface LayerDef {
  id: LayerId;
  name: string;
  /** Hex colour used for the panel swatch and default map styling. */
  colour: string;
  /** Worker module name under apps/ingest/workers/ (without extension). */
  worker: string;
  /** Redis TTL for features in this layer, seconds. */
  ttlSeconds: number;
  /** Env vars the worker needs; if any is missing the worker is skipped. */
  requiredEnv: readonly string[];
  phase: number;
}

export const LAYERS: readonly LayerDef[] = [
  { id: 'quakes', name: 'Earthquakes', colour: '#ff6b3d', worker: 'quakes', ttlSeconds: 7 * 24 * 3600, requiredEnv: [], phase: 2 },
  { id: 'flights', name: 'Flights', colour: '#4fc3f7', worker: 'flights', ttlSeconds: 60, requiredEnv: [], phase: 3 },
  { id: 'alerts', name: 'Weather & disaster alerts', colour: '#ffd54f', worker: 'alerts', ttlSeconds: 24 * 3600, requiredEnv: [], phase: 4 },
  { id: 'news', name: 'News', colour: '#ba68c8', worker: 'news', ttlSeconds: 6 * 3600, requiredEnv: [], phase: 5 },
  { id: 'ships', name: 'Ships', colour: '#4db6ac', worker: 'ships', ttlSeconds: 15 * 60, requiredEnv: ['AISSTREAM_API_KEY'], phase: 6 },
];

export function getLayer(id: string): LayerDef | undefined {
  return LAYERS.find((l) => l.id === id);
}

export function isLayerId(id: string): id is LayerId {
  return (LAYER_IDS as readonly string[]).includes(id);
}

/** Redis pub/sub channel and key helpers, shared by ingest and tests. */
export const channelFor = (layer: LayerId) => `layer:${layer}`;
export const featureKey = (layer: LayerId, id: string) => `feat:${layer}:${id}`;
