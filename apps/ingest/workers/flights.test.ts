import { readFileSync } from 'node:fs';
import { INDIA_BBOX } from '@ind-intg/shared';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../src/worker.js';
import { FlightSource } from './flights.js';
import { coverGrid, parseAdsbLol } from './flights/adsblol.js';
import { HttpError, isMilitary, isMilitaryHex, type Aircraft, type FlightProvider } from './flights/aircraft.js';
import { parseOpenSky } from './flights/opensky.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), 'utf8'));
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('military filter', () => {
  it('drops no-callsign, flagged and military-hex aircraft', () => {
    expect(isMilitary('800123', '')).toBe(true);
    expect(isMilitary('800123', 'AIC101', true)).toBe(true);
    expect(isMilitaryHex('ae1234')).toBe(true);
    expect(isMilitaryHex('43c010')).toBe(true);
    expect(isMilitary('800123', 'AIC101')).toBe(false);
  });
});

describe('parseAdsbLol (fixture)', () => {
  const json = fixture('adsblol-flights.synthetic.json');
  const now = 1_800_000_000_000;
  const flights = parseAdsbLol(json, now);

  it('keeps civil aircraft in INDIA_BBOX and filters military, blank callsigns, out-of-box and junk', () => {
    expect(json.ac).toHaveLength(64);
    expect(flights).toHaveLength(58);
    const ids = flights.map((f) => f.id);
    for (const dropped of ['800abc', '800def', '801234', 'ae1234', '76c111']) expect(ids).not.toContain(dropped);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('normalises to Feature with trimmed callsign and ground handling', () => {
    const f = flights[0]!;
    const raw = json.ac[0];
    expect(f).toMatchObject({ id: raw.hex, layer: 'flights', lat: raw.lat, lon: raw.lon, ts: now - raw.seen_pos * 1000 });
    expect(f.props).toMatchObject({ callsign: raw.flight.trim(), altFt: raw.alt_baro, speedKt: raw.gs, track: raw.track, source: 'adsb.lol' });
    const ground = flights.find((a) => a.props.onGround)!;
    expect(ground.props.altFt).toBeNull();
  });
});

describe('parseOpenSky (fixture)', () => {
  it('converts units and applies the same filters', () => {
    const flights = parseOpenSky(fixture('opensky-states.synthetic.json'));
    expect(flights).toHaveLength(10);
    const f = flights[0]!;
    expect(f.props.source).toBe('opensky');
    expect(f.props.callsign).not.toMatch(/\s$/);
    expect(Math.abs(f.props.altFt! - fixture('adsblol-flights.synthetic.json').ac[0].alt_baro)).toBeLessThan(2);
    expect(parseOpenSky({ time: 1, states: null })).toEqual([]);
  });
});

describe('coverGrid', () => {
  it('covers every point of INDIA_BBOX with 250 NM circles', () => {
    const radiusKm = 250 * 1.852;
    const grid = coverGrid(INDIA_BBOX, radiusKm);
    expect(grid.length).toBeLessThan(40);
    const distKm = (a: [number, number], b: [number, number]) => {
      const r = Math.PI / 180;
      const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
      return 2 * 6371 * Math.asin(Math.sqrt(h));
    };
    for (let lat = INDIA_BBOX.minLat; lat <= INDIA_BBOX.maxLat; lat += 0.5) {
      for (let lon = INDIA_BBOX.minLon; lon <= INDIA_BBOX.maxLon; lon += 0.5) {
        expect(Math.min(...grid.map((c) => distKm(c, [lat, lon])))).toBeLessThanOrEqual(radiusKm);
      }
    }
  });
});

describe('FlightSource', () => {
  const plane: Aircraft = {
    id: '800001',
    layer: 'flights',
    lat: 20,
    lon: 80,
    ts: 0,
    props: { callsign: 'AIC1', altFt: 30000, onGround: false, speedKt: 450, track: 90, squawk: null, type: null, reg: null, source: 'opensky' },
  };
  const provider = (name: string, impl: () => Promise<Aircraft[]>): FlightProvider & { fetch: ReturnType<typeof vi.fn> } => ({
    name,
    fetch: vi.fn(impl),
  });

  it('falls back to the next provider and backs off a rate-limited one', async () => {
    let now = 0;
    const primary = provider('adsb.lol', () => Promise.reject(new HttpError(429, 30_000, 'HTTP 429')));
    const fallback = provider('opensky', async () => [plane]);
    const source = new FlightSource([primary, fallback], log, () => now);

    expect(await source.fetch()).toEqual({ provider: 'opensky', aircraft: [plane] });
    now = 10_000; // still inside Retry-After
    await source.fetch();
    expect(primary.fetch).toHaveBeenCalledTimes(1);
    now = 31_000;
    await source.fetch();
    expect(primary.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws when every provider fails, so the worker backs off', async () => {
    const source = new FlightSource([provider('a', () => Promise.reject(new Error('down')))], log);
    await expect(source.fetch()).rejects.toThrow(/all flight providers failed/);
  });
});
