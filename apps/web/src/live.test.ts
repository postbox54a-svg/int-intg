import type { Feature } from '@ind-intg/shared';
import { describe, expect, it } from 'vitest';
import { LiveStore, diffLayers } from './live';
import { QUAKES, toFeatureCollection } from './map/layers';

const quake = (id: string, props: Record<string, unknown> = {}): Feature => ({ id, layer: 'quakes', lat: 25.1, lon: 94.7, ts: 0, props });

describe('LiveStore', () => {
  it('applies snapshot, then upserts and removals', () => {
    const s = new LiveStore();
    expect(s.apply({ type: 'upsert', layer: 'quakes', features: [quake('x')] })).toBe(false); // before snapshot
    s.apply({ type: 'snapshot', layer: 'quakes', features: [quake('a'), quake('b')] });
    s.apply({ type: 'upsert', layer: 'quakes', features: [quake('a', { mag: 5 }), quake('c')] });
    s.apply({ type: 'remove', layer: 'quakes', ids: ['b'] });
    expect(s.data().quakes?.map((f) => [f.id, f.props.mag])).toEqual([
      ['a', 5],
      ['c', undefined],
    ]);
    s.drop('quakes');
    expect(s.data()).toEqual({});
  });
});

describe('diffLayers', () => {
  it('subscribes newly enabled layers and unsubscribes disabled ones', () => {
    expect(diffLayers(new Set(['quakes', 'ships']), new Set(['quakes', 'flights']))).toEqual({
      subscribe: ['flights'],
      unsubscribe: ['ships'],
    });
  });
});

describe('quake rendering', () => {
  it('builds GeoJSON points with props, id and ts', () => {
    const fc = toFeatureCollection([quake('a', { mag: 4.6 })]);
    expect(fc.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [94.7, 25.1] },
      properties: { mag: 4.6, id: 'a', ts: 0 },
    });
  });

  it('popup shows place, magnitude, depth and IST time', () => {
    const rows = QUAKES.popup({ place: '28 km ESE of Ukhrul, India', mag: 4.6, magType: 'mb', depthKm: 52.3, ts: Date.UTC(2026, 0, 1, 6) });
    expect(rows).toEqual([
      ['Place', '28 km ESE of Ukhrul, India'],
      ['Magnitude', 'M 4.6 (mb)'],
      ['Depth', '52 km'],
      ['Time', expect.stringContaining('11:30:00 IST')],
    ]);
    expect(QUAKES.popup({})[1]).toEqual(['Magnitude', 'n/a']);
  });

  it('only links to https sources', () => {
    expect(QUAKES.link?.({ url: 'https://earthquake.usgs.gov/x' })).toBe('https://earthquake.usgs.gov/x');
    expect(QUAKES.link?.({ url: 'javascript:alert(1)' })).toBeNull();
  });
});
