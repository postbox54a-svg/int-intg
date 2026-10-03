import { describe, expect, it } from 'vitest';
import { INDIA_BBOX, LAYERS, LAYER_IDS, formatIST, getLayer, inBBox, isValidCoord } from './index.js';

describe('INDIA_BBOX', () => {
  it('matches the spec (lat 5–37 N, lon 66–98 E)', () => {
    expect(INDIA_BBOX).toEqual({ minLat: 5, minLon: 66, maxLat: 37, maxLon: 98 });
  });
  it('contains Delhi, Chennai and Port Blair; excludes London', () => {
    expect(inBBox(28.61, 77.21)).toBe(true);
    expect(inBBox(13.08, 80.27)).toBe(true);
    expect(inBBox(11.62, 92.73)).toBe(true);
    expect(inBBox(51.5, -0.12)).toBe(false);
  });
});

describe('layer registry', () => {
  it('has one entry per layer id with unique colours', () => {
    expect(LAYERS.map((l) => l.id).sort()).toEqual([...LAYER_IDS].sort());
    expect(new Set(LAYERS.map((l) => l.colour)).size).toBe(LAYERS.length);
  });
  it('looks layers up by id', () => {
    expect(getLayer('quakes')?.worker).toBe('quakes');
    expect(getLayer('cctv')).toBeUndefined();
  });
});

describe('helpers', () => {
  it('validates coordinates', () => {
    expect(isValidCoord(20, 78)).toBe(true);
    expect(isValidCoord(Number.NaN, 78)).toBe(false);
    expect(isValidCoord('20', 78)).toBe(false);
  });
  it('formats times in IST (UTC+5:30)', () => {
    expect(formatIST(Date.UTC(2026, 0, 1, 0, 0, 0), false)).toBe('05:30:00');
  });
});
