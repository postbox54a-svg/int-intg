import { readFileSync } from 'node:fs';
import { channelFor, type Feature, type ServerMessage } from '@ind-intg/shared';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { parseUsgs } from '../workers/quakes.js';
import { Gateway } from './gateway.js';
import { FeatureStore } from './store.js';
import type { Logger } from './worker.js';

const fixture = JSON.parse(readFileSync(new URL('../../../fixtures/usgs-quakes.synthetic.geojson', import.meta.url), 'utf8'));
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('parseUsgs (fixture)', () => {
  const quakes = parseUsgs(fixture);

  it('keeps only events inside INDIA_BBOX', () => {
    expect(fixture.features).toHaveLength(15);
    expect(quakes).toHaveLength(12);
    expect(quakes.map((q) => q.id)).not.toContain('fx9001'); // Japan
  });

  it('normalises to Feature', () => {
    expect(quakes[0]).toEqual({
      id: 'fx0001',
      layer: 'quakes',
      lat: 25.12,
      lon: 94.71,
      ts: fixture.features[0].properties.time,
      props: {
        mag: 4.6,
        magType: 'mb',
        place: '28 km ESE of Ukhrul, India',
        depthKm: 52.3,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/fx0001',
        tsunami: false,
      },
    });
  });

  it('drops malformed entries and rejects a body without features', () => {
    expect(parseUsgs({ features: [{ id: 'x' }, { id: 'y', geometry: { type: 'Point', coordinates: ['a', 1] } }] })).toEqual([]);
    expect(() => parseUsgs({ error: 'nope' })).toThrow();
  });
});

/** Just enough of ioredis for FeatureStore. TTLs are recorded, not enforced. */
function fakeRedis() {
  const kv = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const published: { channel: string; msg: unknown }[] = [];
  const set = (k: string) => sets.get(k) ?? sets.set(k, new Set()).get(k)!;
  const redis = {
    async smembers(k: string) {
      return [...set(k)];
    },
    async mget(...keys: string[]) {
      return keys.map((k) => kv.get(k) ?? null);
    },
    async set(k: string, v: string) {
      kv.set(k, v);
    },
    async sadd(k: string, ...m: string[]) {
      m.forEach((x) => set(k).add(x));
    },
    async srem(k: string, ...m: string[]) {
      m.forEach((x) => set(k).delete(x));
    },
    async del(...keys: string[]) {
      keys.forEach((k) => kv.delete(k));
    },
    async publish(channel: string, msg: string) {
      published.push({ channel, msg: JSON.parse(msg) });
    },
  };
  return { redis: redis as unknown as Redis, kv, published };
}

const quake = (id: string, mag = 3): Feature => ({ id, layer: 'quakes', lat: 20, lon: 80, ts: 1, props: { mag } });

describe('FeatureStore', () => {
  it('publishes only new/changed features and removals', async () => {
    const { redis, published } = fakeRedis();
    const store = new FeatureStore(redis);

    expect(await store.sync('quakes', [quake('a'), quake('b')], 60)).toEqual({ upserted: 2, removed: 0 });
    expect(await store.sync('quakes', [quake('a'), quake('b')], 60)).toEqual({ upserted: 0, removed: 0 });
    expect(await store.sync('quakes', [quake('a', 4)], 60)).toEqual({ upserted: 1, removed: 1 });

    expect(published.map((p) => p.channel)).toEqual(Array(3).fill(channelFor('quakes')));
    expect(published[1]!.msg).toEqual({ type: 'upsert', layer: 'quakes', features: [quake('a', 4)] });
    expect(published[2]!.msg).toEqual({ type: 'remove', layer: 'quakes', ids: ['b'] });
    expect(await store.snapshot('quakes')).toEqual([quake('a', 4)]);
  });

  it('prunes expired ids from the snapshot', async () => {
    const { redis, kv } = fakeRedis();
    const store = new FeatureStore(redis);
    await store.sync('quakes', [quake('a'), quake('b')], 60);
    kv.delete('feat:quakes:a'); // TTL ran out
    expect((await store.snapshot('quakes')).map((f) => f.id)).toEqual(['b']);
  });
});

function client() {
  const msgs: ServerMessage[] = [];
  return { msgs, send: (d: string) => msgs.push(JSON.parse(d)) };
}

describe('Gateway', () => {
  const snap = async (layer: string) => (layer === 'quakes' ? [quake('a')] : []);

  it('sends hello, a snapshot on subscribe, then only subscribed deltas', async () => {
    const gw = new Gateway(snap, log);
    const c = client();
    gw.add(c);
    await gw.handle(c, JSON.stringify({ type: 'subscribe', layers: ['quakes', 'not-a-layer'] }));
    gw.broadcast({ type: 'upsert', layer: 'quakes', features: [quake('b')] });
    gw.broadcast({ type: 'upsert', layer: 'flights', features: [] });
    expect(c.msgs.map((m) => m.type)).toEqual(['hello', 'snapshot', 'upsert']);
    expect(c.msgs[1]).toEqual({ type: 'snapshot', layer: 'quakes', features: [quake('a')] });

    await gw.handle(c, JSON.stringify({ type: 'unsubscribe', layers: ['quakes'] }));
    gw.broadcast({ type: 'remove', layer: 'quakes', ids: ['a'] });
    expect(c.msgs).toHaveLength(3);
  });

  it('queues deltas that arrive while the snapshot loads, and sends them after it', async () => {
    let release!: () => void;
    const gw = new Gateway(() => new Promise((r) => (release = () => r([quake('a')]))), log);
    const c = client();
    gw.add(c);
    const pending = gw.handle(c, JSON.stringify({ type: 'subscribe', layers: ['quakes'] }));
    gw.broadcast({ type: 'remove', layer: 'quakes', ids: ['a'] });
    release();
    await pending;
    expect(c.msgs.map((m) => m.type)).toEqual(['hello', 'snapshot', 'remove']);
  });

  it('sends an empty snapshot when the store is down, and ignores junk', async () => {
    const gw = new Gateway(() => Promise.reject(new Error('redis down')), log);
    const c = client();
    gw.add(c);
    await gw.handle(c, 'not json');
    await gw.handle(c, JSON.stringify({ type: 'subscribe', layers: ['quakes'] }));
    expect(c.msgs.at(-1)).toEqual({ type: 'snapshot', layer: 'quakes', features: [] });
    gw.remove(c);
    expect(gw.size).toBe(0);
  });
});
