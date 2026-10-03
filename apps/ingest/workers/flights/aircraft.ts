import type { Feature } from '@ind-intg/shared';

export interface FlightProps extends Record<string, unknown> {
  callsign: string;
  /** Barometric altitude in feet; null when unknown or on the ground. */
  altFt: number | null;
  onGround: boolean;
  speedKt: number | null;
  /** Track over ground, degrees clockwise from north. */
  track: number | null;
  squawk: string | null;
  type: string | null;
  reg: string | null;
  source: 'adsb.lol' | 'opensky';
}

export type Aircraft = Feature<FlightProps>;

/** A source of aircraft inside INDIA_BBOX. Implementations throw HttpError on non-2xx responses. */
export interface FlightProvider {
  name: string;
  fetch(): Promise<Aircraft[]>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Known military ICAO 24-bit address blocks (hex, inclusive). Not exhaustive: most militaries do not publish
 * theirs, so this is a backstop behind the source's own military flag and the no-callsign rule.
 */
export const MILITARY_HEX_RANGES: readonly [number, number][] = [
  [0xadf7c8, 0xafffff], // United States
  [0x43c000, 0x43cfff], // United Kingdom
  [0x3aa000, 0x3affff], // France
  [0x3b7000, 0x3bffff], // France
  [0x3ea000, 0x3ebfff], // Germany
  [0x3f4000, 0x3fbfff], // Germany
];

export function isMilitaryHex(hex: string): boolean {
  const n = parseInt(hex, 16);
  return Number.isFinite(n) && MILITARY_HEX_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

/** Military aircraft are never shown: no callsign, a military hex block, or flagged military by the source. */
export function isMilitary(hex: string, callsign: string, flaggedMilitary = false): boolean {
  return flaggedMilitary || !callsign || isMilitaryHex(hex);
}
