import { useEffect, useRef, useState } from 'react';
import type { ClientMessage, Feature, LayerId, ServerMessage } from '@ind-intg/shared';

export type LayerData = Partial<Record<LayerId, Feature[]>>;

/** Client-side copy of the subscribed layers, updated from snapshot + delta messages. */
export class LiveStore {
  private layers = new Map<LayerId, Map<string, Feature>>();

  apply(msg: ServerMessage): boolean {
    switch (msg.type) {
      case 'snapshot':
        this.layers.set(msg.layer, new Map(msg.features.map((f) => [f.id, f])));
        return true;
      case 'upsert': {
        const layer = this.layers.get(msg.layer);
        if (!layer) return false; // not subscribed (yet): the snapshot will include it
        for (const f of msg.features) layer.set(f.id, f);
        return true;
      }
      case 'remove': {
        const layer = this.layers.get(msg.layer);
        if (!layer) return false;
        for (const id of msg.ids) layer.delete(id);
        return true;
      }
      default:
        return false;
    }
  }

  drop(layer: LayerId) {
    return this.layers.delete(layer);
  }

  data(): LayerData {
    const out: LayerData = {};
    for (const [id, layer] of this.layers) out[id] = [...layer.values()];
    return out;
  }
}

/** Layers to (un)subscribe so the server matches `wanted`. */
export function diffLayers(current: ReadonlySet<LayerId>, wanted: ReadonlySet<LayerId>) {
  return {
    subscribe: [...wanted].filter((l) => !current.has(l)),
    unsubscribe: [...current].filter((l) => !wanted.has(l)),
  };
}

const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

/**
 * Keeps one WebSocket to the gateway, subscribed to exactly the enabled layers. Reconnects with
 * exponential backoff and re-subscribes; renders are batched to one per animation frame.
 */
export function useLiveFeatures(enabled: ReadonlySet<LayerId>) {
  const [data, setData] = useState<LayerData>({});
  const [connected, setConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const subscribed = useRef(new Set<LayerId>());
  const store = useRef(new LiveStore());
  const wanted = useRef(enabled);
  wanted.current = enabled;

  const sync = () => {
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const { subscribe, unsubscribe } = diffLayers(subscribed.current, wanted.current);
    const sendMsg = (m: ClientMessage) => socket.send(JSON.stringify(m));
    if (unsubscribe.length) {
      sendMsg({ type: 'unsubscribe', layers: unsubscribe });
      unsubscribe.forEach((l) => {
        subscribed.current.delete(l);
        store.current.drop(l);
      });
      setData(store.current.data());
    }
    if (subscribe.length) {
      sendMsg({ type: 'subscribe', layers: subscribe });
      subscribe.forEach((l) => subscribed.current.add(l));
    }
  };

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    const flush = () => {
      frame = undefined;
      setData(store.current.data());
    };
    const connect = () => {
      const socket = new WebSocket(wsUrl());
      ws.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setConnected(true);
        subscribed.current.clear();
        sync();
      };
      socket.onmessage = (ev) => {
        if (store.current.apply(JSON.parse(ev.data as string) as ServerMessage) && frame === undefined) {
          frame = requestAnimationFrame(flush);
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (closed) return;
        const delay = Math.min(30_000, 1000 * 2 ** attempt++);
        retry = setTimeout(connect, delay);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      if (frame !== undefined) cancelAnimationFrame(frame);
      ws.current?.close();
    };
  }, []);

  useEffect(sync, [enabled]);

  return { data, connected };
}
