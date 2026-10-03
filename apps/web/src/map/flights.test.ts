import type { Feature } from '@ind-intg/shared';
import { describe, expect, it } from 'vitest';
import { MAX_EXTRAPOLATION_S, flightColour, flightPopup, interpolate } from './flights';

const plane = (props: Record<string, unknown>): Feature => ({ id: '800001', layer: 'flights', lat: 20, lon: 80, ts: 0, props });

describe('interpolate', () => {
  it('moves along the track at ground speed', () => {
    // 360 kt ≈ 185 m/s; 10 s due north ≈ 1852 m ≈ 0.01664° of latitude.
    const [lon, lat] = interpolate(plane({ speedKt: 360, track: 0 }), 10_000);
    expect(lon).toBeCloseTo(80, 6);
    expect(lat - 20).toBeCloseTo(1852 / 111_320, 4);
    const [lonE] = interpolate(plane({ speedKt: 360, track: 90 }), 10_000);
    expect(lonE).toBeGreaterThan(80);
  });

  it('caps extrapolation and holds aircraft on the ground or without speed/track', () => {
    const far = interpolate(plane({ speedKt: 360, track: 0 }), 3_600_000);
    const capped = interpolate(plane({ speedKt: 360, track: 0 }), MAX_EXTRAPOLATION_S * 1000);
    expect(far).toEqual(capped);
    expect(interpolate(plane({ speedKt: 12, track: 0, onGround: true }), 10_000)).toEqual([80, 20]);
    expect(interpolate(plane({ speedKt: null, track: 0 }), 10_000)).toEqual([80, 20]);
  });
});

describe('flight popup and colour', () => {
  it('shows callsign, altitude, speed and squawk', () => {
    expect(flightPopup({ callsign: 'AIC101', altFt: 35000, speedKt: 452.4, squawk: '2311', type: 'A20N', reg: 'VT-ABC', source: 'adsb.lol' })).toEqual([
      ['Callsign', 'AIC101'],
      ['Altitude', '35,000 ft'],
      ['Speed', '452 kt'],
      ['Squawk', '2311'],
      ['Aircraft', 'A20N · VT-ABC'],
      ['Source', 'adsb.lol'],
    ]);
    expect(flightPopup({ callsign: 'IGO1', onGround: true, squawk: '7700' })).toContainEqual(['Altitude', 'On ground']);
    expect(flightPopup({ callsign: 'IGO1', squawk: '7700' })).toContainEqual(['Squawk', '7700 (emergency)']);
  });

  it('colours emergencies red and grounded aircraft grey', () => {
    expect(flightColour(plane({ squawk: '7700' }))[0]).toBe(255);
    expect(flightColour(plane({ onGround: true }))).toEqual([139, 152, 165, 200]);
  });
});
