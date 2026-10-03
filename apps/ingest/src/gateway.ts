import { LAYER_IDS, parseClientMessage, type Feature, type LayerDelta, type LayerId, type ServerMessage } from '@ind-intg/shared';
import type { Logger } from './worker.js';

export interface GatewayClient {
  send(data: string): void;
}

interface ClientState {
  layers: Set<LayerId>;
  /** Deltas that arrive while a layer's snapshot is loading; flushed right after the snapshot. */
  pending: Map<LayerId, LayerDelta[]>;
}

/**
 * WebSocket gateway: a client gets a snapshot of each layer it subscribes to, then only that layer's deltas.
 * Transport-agnostic so it can be tested without sockets or Redis.
 */
export class Gateway {
  private clients = new Map<GatewayClient, ClientState>();

  constructor(
    private snapshot: (layer: LayerId) => Promise<Feature[]>,
    private log: Logger,
  ) {}

  get size() {
    return this.clients.size;
  }

  add(client: GatewayClient) {
    this.clients.set(client, { layers: new Set(), pending: new Map() });
    send(client, { type: 'hello', layers: [...LAYER_IDS] });
  }

  remove(client: GatewayClient) {
    this.clients.delete(client);
  }

  async handle(client: GatewayClient, raw: string) {
    const state = this.clients.get(client);
    const msg = parseClientMessage(raw);
    if (!state || !msg) return;
    if (msg.type === 'unsubscribe') {
      for (const layer of msg.layers) {
        state.layers.delete(layer);
        state.pending.delete(layer);
      }
      return;
    }
    await Promise.all(
      msg.layers
        .filter((layer) => !state.layers.has(layer))
        .map(async (layer) => {
          state.layers.add(layer);
          state.pending.set(layer, []);
          let features: Feature[] = [];
          try {
            features = await this.snapshot(layer);
          } catch (err) {
            this.log.warn({ layer, err }, 'snapshot failed; sending empty snapshot');
          }
          const queued = state.pending.get(layer);
          state.pending.delete(layer);
          // Unsubscribed (or disconnected) while loading.
          if (!state.layers.has(layer) || !this.clients.has(client)) return;
          send(client, { type: 'snapshot', layer, features });
          for (const delta of queued ?? []) send(client, delta);
        }),
    );
  }

  broadcast(delta: LayerDelta) {
    for (const [client, state] of this.clients) {
      if (!state.layers.has(delta.layer)) continue;
      const queue = state.pending.get(delta.layer);
      if (queue) queue.push(delta);
      else send(client, delta);
    }
  }
}

function send(client: GatewayClient, msg: ServerMessage) {
  client.send(JSON.stringify(msg));
}
