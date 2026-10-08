import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureStore } from '../src/store.js';
import type { Logger } from '../src/worker.js';
import { createShipsWorker, subscription, type SocketLike } from './ships.js';
import { ShipTracker, parseAisMessage, shipCategory, type Ship } from './ships/ais.js';

const lines = readFileSync(new URL('../../../fixtures/aisstream-messages.synthetic.jsonl', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('AIS parsing', () => {
  it('parses position reports (with not-available sentinels) and static data', () => {
    const pos = lines.find((l) => l.MessageType === 'PositionReport');
    expect(parseAisMessage(pos)).toMatchObject({ kind: 'position', mmsi: String(pos.MetaData.MMSI), ts: Date.UTC(2026, 9, 3, 15) });
    const stat = parseAisMessage(lines.find((l) => l.MessageType === 'ShipStaticData'));
    expect(stat).toMatchObject({ kind: 'static' });
    expect((stat as { name: string }).name).not.toMatch(/@/);
    const stopped = parseAisMessage({ MessageType: 'PositionReport', MetaData: { MMSI: 1 }, Message: { PositionReport: { Latitude: 18, Longitude: 72, Sog: 102.3, Cog: 360, TrueHeading: 511 } } });
    expect(stopped).toMatchObject({ sog: null, cog: null, heading: null });
    expect(parseAisMessage({ MessageType: 'AidsToNavigationReport', MetaData: { MMSI: 2 }, Message: { AidsToNavigationReport: {} } })).toBeNull();
    expect(parseAisMessage({ MessageType: 'PositionReport', MetaData: {} })).toBeNull();
  });

  it('categorises ship types', () => {
    expect([70, 84, 60, 30, 52, 36, 99, null].map(shipCategory)).toEqual(['cargo', 'tanker', 'passenger', 'fishing', 'tug', 'pleasure', 'other', 'other']);
  });
});

describe('ShipTracker (fixture stream)', () => {
  const tracker = new ShipTracker();
  for (const l of lines) {
    const m = parseAisMessage(l);
    if (m) tracker.apply(m);
  }
  const { changed, removed } = tracker.flush();

  it('merges position + static by MMSI and keeps ships inside INDIA_BBOX', () => {
    expect(changed).toHaveLength(43);
    expect(changed.map((s) => s.id)).not.toContain('563000001'); // Singapore
    const withStatic = changed.find((s) => s.props.shipType != null)!;
    expect(withStatic.props).toMatchObject({ category: shipCategory(withStatic.props.shipType) });
    expect(withStatic.props.callsign).toMatch(/^AV\d{4}$/);
    expect(changed.find((s) => s.id === '419999001')!.props.name).toBe('GOA SUNSET'); // class B, name from metadata
  });

  it('drops ship type 35, removing it if it was already shown', () => {
    expect(changed.map((s) => s.id)).not.toContain('419999035');
    const t = new ShipTracker();
    t.apply(parseAisMessage(lines.find((l) => l.MetaData.MMSI === 419999035 && l.MessageType === 'PositionReport'))!);
    expect(t.flush().changed.map((s) => s.id)).toEqual(['419999035']);
    t.apply(parseAisMessage(lines.find((l) => l.MetaData.MMSI === 419999035 && l.MessageType === 'ShipStaticData'))!);
    expect(t.flush()).toEqual({ changed: [], removed: ['419999035'] });
    expect(removed).toEqual(['419999035']); // a remove for a never-stored id is a harmless no-op
  });
});

describe('AISStream session', () => {
  it('subscribes on open with the sea boxes', () => {
    const sub = subscription('KEY');
    expect(sub.APIKey).toBe('KEY');
    expect(sub.BoundingBoxes).toHaveLength(4);
    expect(sub.BoundingBoxes[0]).toEqual([
      [8, 66],
      [24, 78],
    ]);
  });

  function fakeSocket() {
    const sent: string[] = [];
    const ws: SocketLike = { onopen: null, onmessage: null, onclose: null, onerror: null, send: (d) => sent.push(d), close: () => ws.onclose?.({ code: 1000 }) };
    return { ws, sent };
  }

  function setup(overrides = {}) {
    const merge = vi.fn(async () => ({ upserted: 0, removed: 0 }));
    const remove = vi.fn(async () => {});
    const { ws, sent } = fakeSocket();
    const worker = createShipsWorker({ merge, remove } as unknown as FeatureStore, log, {
      apiKey: 'KEY',
      url: 'wss://example.invalid',
      connect: () => ws,
      flushMs: 10,
      healthyAfterMs: 0,
      ...overrides,
    });
    return { worker, ws, sent, merge, remove };
  }

  it('reads continuously, flushes merged ships and ends healthy on close', async () => {
    const { worker, ws, sent, merge } = setup();
    const done = worker.tick();
    ws.onopen!();
    expect(JSON.parse(sent[0]!)).toMatchObject({ APIKey: 'KEY' });
    for (const l of lines) ws.onmessage!({ data: new TextEncoder().encode(JSON.stringify(l)).buffer });
    await new Promise((r) => setTimeout(r, 30));
    ws.close();
    await expect(done).resolves.toBeUndefined();
    const calls = merge.mock.calls as unknown as [string, Ship[], number][];
    const ships = calls.flatMap((c) => c[1]);
    expect(new Set(ships.map((s) => s.id)).size).toBe(43);
    expect(calls[0]![2]).toBe(15 * 60);
  });

  it('fails (so the runner backs off) on a server error such as a bad key', async () => {
    const { worker, ws } = setup();
    const done = worker.tick();
    ws.onopen!();
    ws.onmessage!({ data: JSON.stringify({ error: 'Api Key Is Not Valid' }) });
    await expect(done).rejects.toThrow(/Api Key Is Not Valid/);
  });

  it('reconnects when the stream goes idle', async () => {
    const { worker, ws } = setup({ idleTimeoutMs: 5 });
    const done = worker.tick();
    ws.onopen!();
    await expect(done).rejects.toThrow(/no messages/);
  });

  it('ends the session on a connection error even if close never fires', async () => {
    const { worker, ws } = setup();
    ws.close = () => {}; // like Node's WebSocket after a failed connect: no close event
    const done = worker.tick();
    ws.onerror!(new Error('Received network error or non-101 status code.'));
    await expect(done).rejects.toThrow(/network error/);
  });

  it('is skipped without AISSTREAM_API_KEY', () => {
    expect(setup().worker.requiredEnv).toEqual(['AISSTREAM_API_KEY']);
  });
});
