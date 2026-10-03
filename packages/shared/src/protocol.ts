import type { Feature } from './feature.js';
import { isLayerId, type LayerId } from './layers.js';

/** Published on a layer's Redis channel by its worker. */
export type LayerDelta =
  | { type: 'upsert'; layer: LayerId; features: Feature[] }
  | { type: 'remove'; layer: LayerId; ids: string[] };

/** Client -> gateway. */
export type ClientMessage = { type: 'subscribe'; layers: LayerId[] } | { type: 'unsubscribe'; layers: LayerId[] };

/** Gateway -> client: a full snapshot when a layer is subscribed, then deltas. */
export type ServerMessage = { type: 'hello'; layers: LayerId[] } | { type: 'snapshot'; layer: LayerId; features: Feature[] } | LayerDelta;

/** Parses and validates a client message; returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const { type, layers } = msg as { type?: unknown; layers?: unknown };
  if ((type !== 'subscribe' && type !== 'unsubscribe') || !Array.isArray(layers)) return null;
  return { type, layers: layers.filter((l): l is LayerId => typeof l === 'string' && isLayerId(l)) };
}
