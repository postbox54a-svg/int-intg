import { SEA_BOXES, getLayer } from '@ind-intg/shared';
import type { FeatureStore } from '../src/store.js';
import type { Logger, Worker } from '../src/worker.js';
import { ShipTracker, parseAisMessage } from './ships/ais.js';

export const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';

/** The subset of WebSocket the session uses, so tests can drive it with a fake. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export const connectWebSocket = (url: string): SocketLike => {
  const ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  return ws as unknown as SocketLike;
};

/** AISStream subscription: the India sea boxes as [[lat, lon], [lat, lon]] corners. */
export function subscription(apiKey: string) {
  return {
    APIKey: apiKey,
    BoundingBoxes: Object.values(SEA_BOXES).map((b) => [
      [b.minLat, b.minLon],
      [b.maxLat, b.maxLon],
    ]),
    FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ShipStaticData'],
  };
}

const decoder = new TextDecoder();
function asText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return decoder.decode(data);
  if (data instanceof Uint8Array) return decoder.decode(data);
  return null;
}

export interface ShipsOptions {
  url?: string;
  apiKey?: string;
  connect?: (url: string) => SocketLike;
  flushMs?: number;
  openTimeoutMs?: number;
  /** Reconnect if no message arrives for this long. */
  idleTimeoutMs?: number;
  /** A session that lasted this long with traffic counts as healthy: reconnect at once, no backoff. */
  healthyAfterMs?: number;
}

/**
 * One persistent AISStream connection per tick: subscribes as soon as the socket opens (AISStream drops clients
 * that don't subscribe within 3 s), reads continuously, and flushes merged ships to the store every few seconds.
 * The tick ends when the socket closes; runWorker then reconnects (immediately after a healthy session, with
 * exponential backoff after a failed one).
 */
export function createShipsWorker(store: FeatureStore, log: Logger, opts: ShipsOptions = {}): Worker {
  const {
    url = process.env.AISSTREAM_URL || AISSTREAM_URL,
    apiKey = process.env.AISSTREAM_API_KEY ?? '',
    connect = connectWebSocket,
    flushMs = 5_000,
    openTimeoutMs = 10_000,
    idleTimeoutMs = 120_000,
    healthyAfterMs = 60_000,
  } = opts;
  const { ttlSeconds } = getLayer('ships')!;
  const tracker = new ShipTracker();

  const flush = async () => {
    const { changed, removed } = tracker.flush();
    tracker.prune(Date.now(), ttlSeconds * 1000);
    if (changed.length) await store.merge('ships', changed, ttlSeconds);
    if (removed.length) await store.remove('ships', removed);
    return changed.length;
  };

  return {
    layer: 'ships',
    intervalMs: 1_000,
    requiredEnv: ['AISSTREAM_API_KEY'],
    tick: () =>
      new Promise<void>((resolve, reject) => {
        const started = Date.now();
        let messages = 0;
        let lastMessage = Date.now();
        let serverError: string | null = null;
        let settled = false;
        const ws = connect(url);

        // Node's WebSocket may never fire `close` after a failed connect (it stays CLOSING), so every exit path
        // ends the session itself instead of waiting for onclose.
        const end = (reason: string, code?: number) => {
          serverError ??= reason;
          try {
            ws.close();
          } catch {
            // already closing
          }
          void finish({ code });
        };
        const openTimer = setTimeout(() => end(`no connection within ${openTimeoutMs} ms`), openTimeoutMs);
        const flushTimer = setInterval(() => {
          flush().catch((err) => log.warn({ layer: 'ships', err: String(err) }, 'ships flush failed'));
          if (Date.now() - lastMessage > idleTimeoutMs) end(`no messages for ${idleTimeoutMs} ms`);
        }, flushMs);

        const finish = async (ev: { code?: number; reason?: string }) => {
          if (settled) return;
          settled = true;
          clearTimeout(openTimer);
          clearInterval(flushTimer);
          await flush().catch(() => {});
          const lasted = Date.now() - started;
          log.info({ layer: 'ships', code: ev.code, messages, lastedMs: lasted, ships: tracker.size }, 'AISStream connection closed');
          if (!serverError && messages > 0 && lasted >= healthyAfterMs) resolve();
          else reject(new Error(`AISStream session ended: ${serverError ?? `code ${ev.code ?? '?'} ${ev.reason ?? ''}`.trim()}`));
        };

        ws.onopen = () => {
          clearTimeout(openTimer);
          ws.send(JSON.stringify(subscription(apiKey)));
          log.info({ layer: 'ships' }, 'AISStream connected and subscribed');
        };
        ws.onmessage = (ev) => {
          const text = asText(ev.data);
          if (!text) return;
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            return;
          }
          lastMessage = Date.now();
          if (typeof (json as { error?: unknown }).error === 'string') {
            end((json as { error: string }).error); // e.g. a bad API key
            return;
          }
          const msg = parseAisMessage(json);
          if (msg) {
            messages++;
            tracker.apply(msg);
          }
        };
        ws.onerror = () => end('network error', 1006);
        ws.onclose = (ev) => void finish(ev);
      }),
  };
}
