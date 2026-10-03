import { INDIA_BBOX, inBBox, isValidCoord, type BBox } from '@ind-intg/shared';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HttpError, isMilitary, type Aircraft, type FlightProvider } from './aircraft.js';

export const ADSBLOL_BASE_URL = 'https://api.adsb.lol';
/** Largest radius the adsb.lol point query accepts. */
const RADIUS_NM = 250;
const NM_KM = 1.852;
const KM_PER_DEG = 111.32;

/**
 * Centres of circles of `radiusKm` that together cover `box`: rows and columns spaced at radius·√2,
 * so each grid cell's square fits inside its circle. Columns widen with latitude.
 */
export function coverGrid(box: BBox, radiusKm: number): [lat: number, lon: number][] {
  const stepKm = radiusKm * Math.SQRT2;
  const latStep = stepKm / KM_PER_DEG;
  const rows = Math.ceil((box.maxLat - box.minLat) / latStep);
  const out: [number, number][] = [];
  for (let r = 0; r < rows; r++) {
    const lat0 = box.minLat + r * latStep;
    const lat1 = Math.min(box.maxLat, lat0 + latStep);
    // Use the row edge nearest the equator so the narrowest cell still fits.
    const cosLat = Math.cos((Math.min(Math.abs(lat0), Math.abs(lat1)) * Math.PI) / 180);
    const lonStep = stepKm / (KM_PER_DEG * cosLat);
    const cols = Math.ceil((box.maxLon - box.minLon) / lonStep);
    const colWidth = (box.maxLon - box.minLon) / cols;
    for (let c = 0; c < cols; c++) out.push([(lat0 + lat1) / 2, box.minLon + (c + 0.5) * colWidth]);
  }
  return out;
}

interface AdsbAircraft {
  hex?: unknown;
  flight?: unknown;
  lat?: unknown;
  lon?: unknown;
  alt_baro?: unknown;
  gs?: unknown;
  track?: unknown;
  squawk?: unknown;
  t?: unknown;
  r?: unknown;
  dbFlags?: unknown;
  seen_pos?: unknown;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** adsb.lol v2 (ADSBExchange-compatible) response -> civil aircraft inside INDIA_BBOX. */
export function parseAdsbLol(json: unknown, now = Date.now()): Aircraft[] {
  const ac = (json as { ac?: unknown })?.ac;
  if (!Array.isArray(ac)) throw new Error('adsb.lol response has no ac array');
  const out: Aircraft[] = [];
  for (const a of ac as AdsbAircraft[]) {
    const hex = str(a.hex)?.toLowerCase().replace(/^~/, '');
    const callsign = str(a.flight) ?? '';
    if (!hex || !isValidCoord(a.lat, a.lon) || !inBBox(a.lat as number, a.lon as number)) continue;
    // dbFlags bit 0 = military in the readsb/ADSBExchange database.
    if (isMilitary(hex, callsign, ((num(a.dbFlags) ?? 0) & 1) === 1)) continue;
    const onGround = a.alt_baro === 'ground';
    out.push({
      id: hex,
      layer: 'flights',
      lat: a.lat as number,
      lon: a.lon as number,
      ts: now - (num(a.seen_pos) ?? 0) * 1000,
      props: {
        callsign,
        altFt: onGround ? null : num(a.alt_baro),
        onGround,
        speedKt: num(a.gs),
        track: num(a.track),
        squawk: str(a.squawk),
        type: str(a.t),
        reg: str(a.r),
        source: 'adsb.lol',
      },
    });
  }
  return out;
}

async function getJson(url: string): Promise<unknown> {
  if (url.startsWith('file:')) return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new HttpError(res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null, `${url} -> HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Queries adsb.lol point-radius endpoints over a grid covering INDIA_BBOX and merges by hex.
 * A `file://` base URL is read as one complete response (fixture mode).
 */
export function adsbLolProvider(baseUrl = ADSBLOL_BASE_URL, concurrency = 4): FlightProvider {
  const grid = coverGrid(INDIA_BBOX, RADIUS_NM * NM_KM);
  return {
    name: 'adsb.lol',
    async fetch() {
      if (baseUrl.startsWith('file:')) return parseAdsbLol(await getJson(baseUrl));
      const byHex = new Map<string, Aircraft>();
      const queue = [...grid];
      const run = async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const [lat, lon] = p;
          const url = `${baseUrl}/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/${RADIUS_NM}`;
          for (const a of parseAdsbLol(await getJson(url))) byHex.set(a.id, a);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, run));
      return [...byHex.values()];
    },
  };
}
