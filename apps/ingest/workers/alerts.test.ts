import { readFileSync } from 'node:fs';
import type { Feature } from '@ind-intg/shared';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureStore } from '../src/store.js';
import type { Logger } from '../src/worker.js';
import { capToFeature, createAlertsWorker, type AlertProps } from './alerts.js';
import { circleToPolygon, parseCap, parsePolygon, parseRss, pickInfo } from './alerts/cap.js';
import { DistrictIndex } from './alerts/districts.js';

const dir = new URL('../../../fixtures/sachet/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const districts = DistrictIndex.load();
const NOW = Date.parse('2026-10-03T12:00:00+05:30');
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const feature = (file: string) => {
  const r = capToFeature(parseCap(read(file)), districts, NOW);
  if ('drop' in r) throw new Error(`${file} dropped: ${r.drop}`);
  return r;
};

describe('CAP parsing', () => {
  it('reads the RSS item links', () => {
    expect(parseRss(read('rss.xml')).map((i) => i.link)).toContain('cap-polygon.xml');
  });

  it('parses a CAP 1.2 alert and prefers the English info block', () => {
    const alert = parseCap(read('cap-polygon.xml'));
    expect(alert).toMatchObject({ identifier: 'FX-SACHET-0001', status: 'Actual', msgType: 'Alert' });
    expect(alert.info).toHaveLength(2);
    const info = pickInfo(alert)!;
    expect(info).toMatchObject({ language: 'en-IN', event: 'Heavy Rainfall', severity: 'Severe', senderName: 'IMD Thiruvananthapuram (fixture)' });
    expect(info.expires).toBe(Date.parse('2027-10-03T08:00:00+05:30'));
    expect(info.areas[0]!.polygons[0]![0]).toEqual([76.2, 9.9]); // lat,lon -> [lon, lat]
  });

  it('decodes entities and reads references', () => {
    expect(pickInfo(parseCap(read('cap-districts.xml')))!.event).toBe('Thunderstorm & Lightning');
    expect(parseCap(read('cap-update.xml')).references).toEqual(['FX-SACHET-0007']);
  });

  it('closes polygons, converts circles and rejects junk', () => {
    expect(parsePolygon('10,76 11,76 11,77')).toBeNull();
    expect(parsePolygon('10,76 11,76 11,77 10,77')!.at(-1)).toEqual([76, 10]);
    const ring = circleToPolygon('19.4,86.4 150')!;
    expect(ring).toHaveLength(33);
    expect(ring[0]![1]).toBeCloseTo(19.4 + 150 / 111.32, 5);
    expect(() => parseCap('<rss/>')).toThrow();
  });
});

describe('district join', () => {
  it('matches names to Census 2011 districts', () => {
    const m = districts.match('Pune, Satara, Kolhapur');
    expect(m.matched).toEqual(['Pune, Maharashtra', 'Satara, Maharashtra', 'Kolhapur, Maharashtra']);
    expect(m.coords.length).toBeGreaterThanOrEqual(3);
  });

  it('resolves names shared by two states only when a state is named', () => {
    expect(districts.match('Bilaspur').matched).toEqual([]);
    expect(districts.match('Bilaspur', 'Heat wave in Bilaspur district of Chhattisgarh').matched).toEqual(['Bilaspur, Chhattisgarh']);
    expect(districts.match('Bilaspur (Himachal Pradesh)').matched).toEqual(['Bilaspur, Himachal Pradesh']);
  });

  it('reports districts created after 2011 as unmatched', () => {
    expect(districts.match('Vijayanagara, Bellary')).toMatchObject({ matched: ['Bellary, Karnataka'], unmatched: ['Vijayanagara'] });
  });
});

describe('capToFeature', () => {
  it('keeps polygon alerts as MultiPolygon features inside INDIA_BBOX', () => {
    const f = feature('cap-polygon.xml');
    expect(f).toMatchObject({ id: 'FX-SACHET-0001', layer: 'alerts', props: { severity: 'Severe', geometrySource: 'polygon' } });
    expect(f.props.geometry.type).toBe('MultiPolygon');
    expect(f.lat).toBeCloseTo(10.55, 1);
  });

  it('joins district-only alerts to district polygons', () => {
    expect(feature('cap-districts.xml').props).toMatchObject({ geometrySource: 'district', event: 'Thunderstorm & Lightning' });
    expect(feature('cap-circle.xml').props.severity).toBe('Extreme');
  });

  it('drops expired, exercise and cancel messages', () => {
    const drop = (file: string) => capToFeature(parseCap(read(file)), districts, NOW);
    expect(drop('cap-expired.xml')).toEqual({ drop: 'expired' });
    expect(drop('cap-exercise.xml')).toEqual({ drop: 'status Exercise' });
  });
});

describe('alerts worker (fixture feed)', () => {
  it('syncs live alerts, drops superseded ones and expires each at its own time', async () => {
    const sync = vi.fn(async () => ({ upserted: 0, removed: 0 }));
    const worker = createAlertsWorker({ sync } as unknown as FeatureStore, log, new URL('rss.xml', dir).href, districts);
    await worker.tick();
    const [layer, features, ttl] = sync.mock.calls[0] as unknown as [string, Feature<AlertProps>[], (f: Feature) => number];
    expect(layer).toBe('alerts');
    // 9 items: expired, exercise and the superseded FX-SACHET-0007 are dropped.
    expect(features.map((f) => f.id).sort()).toEqual(['FX-SACHET-0001', 'FX-SACHET-0002', 'FX-SACHET-0003', 'FX-SACHET-0004', 'FX-SACHET-0005', 'FX-SACHET-0008']);
    expect(ttl(features[0]!)).toBeLessThanOrEqual(24 * 3600);
    expect(ttl({ ...features[0]!, props: { ...features[0]!.props, expires: Date.now() + 60_000 } })).toBeLessThan(65);
  });
});
