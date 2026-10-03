import { INDIA_BBOX, inBBox, isValidCoord } from '@ind-intg/shared';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { HttpError, isMilitary, type Aircraft, type FlightProvider } from './aircraft.js';

export const OPENSKY_API_URL = 'https://opensky-network.org/api';
export const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

const M_TO_FT = 3.28084;
const MS_TO_KT = 1.94384;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * OpenSky /states/all -> civil aircraft inside INDIA_BBOX. State vector indices: 0 icao24, 1 callsign,
 * 4 last_contact, 5 lon, 6 lat, 7 baro_altitude (m), 8 on_ground, 9 velocity (m/s), 10 true_track, 14 squawk.
 */
export function parseOpenSky(json: unknown): Aircraft[] {
  const states = (json as { states?: unknown })?.states;
  if (states === null) return []; // OpenSky returns null when nothing is in the box
  if (!Array.isArray(states)) throw new Error('OpenSky response has no states array');
  const out: Aircraft[] = [];
  for (const s of states as unknown[][]) {
    if (!Array.isArray(s)) continue;
    const hex = str(s[0])?.toLowerCase();
    const callsign = str(s[1]) ?? '';
    const [lon, lat] = [s[5], s[6]];
    const ts = num(s[4]);
    if (!hex || ts == null || !isValidCoord(lat, lon) || !inBBox(lat as number, lon as number)) continue;
    if (isMilitary(hex, callsign)) continue;
    const onGround = s[8] === true;
    const altM = num(s[7]);
    const speed = num(s[9]);
    out.push({
      id: hex,
      layer: 'flights',
      lat: lat as number,
      lon: lon as number,
      ts: ts * 1000,
      props: {
        callsign,
        altFt: onGround || altM == null ? null : Math.round(altM * M_TO_FT),
        onGround,
        speedKt: speed == null ? null : Math.round(speed * MS_TO_KT),
        track: num(s[10]),
        squawk: str(s[14]),
        type: null,
        reg: null,
        source: 'opensky',
      },
    });
  }
  return out;
}

interface Token {
  value: string;
  expiresAt: number;
}

/** OpenSky with OAuth2 client credentials; the access token is cached until shortly before it expires. */
export function openSkyProvider(opts: {
  clientId: string;
  clientSecret: string;
  apiUrl?: string;
  tokenUrl?: string;
}): FlightProvider {
  const { clientId, clientSecret, apiUrl = OPENSKY_API_URL, tokenUrl = OPENSKY_TOKEN_URL } = opts;
  let token: Token | null = null;

  const getToken = async (): Promise<string> => {
    if (token && token.expiresAt > Date.now() + 30_000) return token.value;
    const res = await fetch(tokenUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) throw new HttpError(res.status, null, `OpenSky token -> HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return token.value;
  };

  return {
    name: 'opensky',
    async fetch() {
      if (apiUrl.startsWith('file:')) return parseOpenSky(JSON.parse(await readFile(fileURLToPath(apiUrl), 'utf8')));
      const b = INDIA_BBOX;
      const url = `${apiUrl}/states/all?lamin=${b.minLat}&lomin=${b.minLon}&lamax=${b.maxLat}&lomax=${b.maxLon}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${await getToken()}` } });
      if (res.status === 401) token = null;
      if (!res.ok) {
        const retry = Number(res.headers.get('x-rate-limit-retry-after-seconds') ?? res.headers.get('retry-after'));
        throw new HttpError(res.status, Number.isFinite(retry) && retry > 0 ? retry * 1000 : null, `OpenSky -> HTTP ${res.status}`);
      }
      return parseOpenSky(await res.json());
    },
  };
}
