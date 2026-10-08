import { inBBox, isValidCoord, type Feature } from '@ind-intg/shared';

/** AIS ship type 35: military operations. Never shown. */
export const MILITARY_SHIP_TYPE = 35;

export type ShipCategory = 'cargo' | 'tanker' | 'passenger' | 'fishing' | 'tug' | 'highspeed' | 'pleasure' | 'special' | 'other';

/** AIS ship type code -> display category. */
export function shipCategory(type: number | null): ShipCategory {
  if (type == null) return 'other';
  if (type >= 70 && type <= 79) return 'cargo';
  if (type >= 80 && type <= 89) return 'tanker';
  if (type >= 60 && type <= 69) return 'passenger';
  if (type === 30) return 'fishing';
  if (type === 31 || type === 32 || type === 52) return 'tug';
  if (type >= 40 && type <= 49) return 'highspeed';
  if (type === 36 || type === 37) return 'pleasure';
  if (type >= 50 && type <= 59) return 'special';
  return 'other';
}

export interface ShipProps extends Record<string, unknown> {
  mmsi: string;
  name: string | null;
  callsign: string | null;
  shipType: number | null;
  category: ShipCategory;
  destination: string | null;
  /** Speed over ground, knots. */
  sog: number | null;
  /** Course over ground, degrees. */
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  lengthM: number | null;
}

export type Ship = Feature<ShipProps>;

export type AisMessage =
  | { kind: 'position'; mmsi: string; lat: number; lon: number; ts: number; sog: number | null; cog: number | null; heading: number | null; navStatus: number | null; name: string | null }
  | { kind: 'static'; mmsi: string; name: string | null; callsign: string | null; shipType: number | null; destination: string | null; lengthM: number | null };

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.replace(/@+$/, '').trim() ? v.replace(/@+$/, '').trim() : null);

/** AISStream "time_utc" looks like "2026-10-03 09:41:12.123456789 +0000 UTC". */
function parseTime(v: unknown): number | null {
  const m = typeof v === 'string' ? v.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d+)?/) : null;
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}${m[3] ? m[3].slice(0, 4) : ''}Z`);
  return Number.isFinite(t) ? t : null;
}

/** One AISStream JSON message -> position or static data; anything else (or malformed) -> null. */
export function parseAisMessage(raw: unknown, now = Date.now()): AisMessage | null {
  const m = raw as { MessageType?: unknown; MetaData?: Record<string, unknown>; Message?: Record<string, Record<string, unknown>> };
  const meta = m?.MetaData ?? {};
  const mmsiNum = num(meta.MMSI);
  if (mmsiNum == null || typeof m.MessageType !== 'string') return null;
  const mmsi = String(mmsiNum);
  const body = m.Message?.[m.MessageType];
  if (!body) return null;

  if (m.MessageType === 'PositionReport' || m.MessageType === 'StandardClassBPositionReport') {
    const lat = num(body.Latitude) ?? num(meta.latitude);
    const lon = num(body.Longitude) ?? num(meta.longitude);
    if (!isValidCoord(lat, lon)) return null;
    // AIS "not available" sentinels: SOG 102.3, COG 360, heading 511.
    const sog = num(body.Sog);
    const cog = num(body.Cog);
    const heading = num(body.TrueHeading);
    return {
      kind: 'position',
      mmsi,
      lat: lat!,
      lon: lon!,
      ts: parseTime(meta.time_utc) ?? now,
      sog: sog != null && sog < 102.3 ? sog : null,
      cog: cog != null && cog < 360 ? cog : null,
      heading: heading != null && heading < 360 ? heading : null,
      navStatus: num(body.NavigationalStatus),
      name: str(meta.ShipName),
    };
  }
  if (m.MessageType === 'ShipStaticData') {
    const dim = (body.Dimension ?? {}) as Record<string, unknown>;
    const length = (num(dim.A) ?? 0) + (num(dim.B) ?? 0);
    return {
      kind: 'static',
      mmsi,
      name: str(body.Name) ?? str(meta.ShipName),
      callsign: str(body.CallSign),
      shipType: num(body.Type),
      destination: str(body.Destination),
      lengthM: length > 0 ? length : null,
    };
  }
  return null;
}

type Static = Extract<AisMessage, { kind: 'static' }>;
type Position = Extract<AisMessage, { kind: 'position' }>;

/**
 * Merges position reports and static data by MMSI. A ship becomes a Feature once it has a position inside
 * INDIA_BBOX; ships whose static data says type 35 (military) are dropped, including ones already shown.
 */
export class ShipTracker {
  private statics = new Map<string, Static & { at: number }>();
  private positions = new Map<string, Position>();
  private dirty = new Set<string>();
  private dropped = new Set<string>();

  apply(msg: AisMessage, now = Date.now()) {
    if (msg.kind === 'static') {
      this.statics.set(msg.mmsi, { ...msg, at: now });
      if (msg.shipType === MILITARY_SHIP_TYPE) {
        if (this.positions.delete(msg.mmsi)) this.dropped.add(msg.mmsi);
        this.dirty.delete(msg.mmsi);
        return;
      }
      if (this.positions.has(msg.mmsi)) this.dirty.add(msg.mmsi);
      return;
    }
    if (!inBBox(msg.lat, msg.lon) || this.statics.get(msg.mmsi)?.shipType === MILITARY_SHIP_TYPE) return;
    this.positions.set(msg.mmsi, msg);
    this.dirty.add(msg.mmsi);
  }

  /** Features changed since the last call, and MMSIs to remove (reclassified as military). */
  flush(): { changed: Ship[]; removed: string[] } {
    const changed = [...this.dirty].map((mmsi) => this.feature(mmsi)).filter((s): s is Ship => !!s);
    const removed = [...this.dropped];
    this.dirty.clear();
    this.dropped.clear();
    return { changed, removed };
  }

  /** Forgets ships not heard from within `maxAgeMs` (their Redis keys expire on their own). */
  prune(now: number, maxAgeMs: number) {
    for (const [mmsi, p] of this.positions) if (p.ts < now - maxAgeMs) this.positions.delete(mmsi);
    for (const [mmsi, s] of this.statics) if (s.at < now - maxAgeMs * 4) this.statics.delete(mmsi);
  }

  get size() {
    return this.positions.size;
  }

  private feature(mmsi: string): Ship | null {
    const p = this.positions.get(mmsi);
    if (!p) return null;
    const s = this.statics.get(mmsi);
    const shipType = s?.shipType ?? null;
    return {
      id: mmsi,
      layer: 'ships',
      lat: p.lat,
      lon: p.lon,
      ts: p.ts,
      props: {
        mmsi,
        name: s?.name ?? p.name,
        callsign: s?.callsign ?? null,
        shipType,
        category: shipCategory(shipType),
        destination: s?.destination ?? null,
        sog: p.sog,
        cog: p.cog,
        heading: p.heading,
        navStatus: p.navStatus,
        lengthM: s?.lengthM ?? null,
      },
    };
  }
}
