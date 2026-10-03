import { formatIST, type Feature } from '@ind-intg/shared';

/** Longest we dead-reckon past the last position report; after this the aircraft holds still until updated. */
export const MAX_EXTRAPOLATION_S = 30;
const KT_TO_MS = 0.514444;
const M_PER_DEG = 111_320;

/**
 * Position now, dead-reckoned from the last report along the track at ground speed, so aircraft
 * move smoothly between 10 s polls.
 */
export function interpolate(f: Feature, now: number): [lon: number, lat: number] {
  const { speedKt, track, onGround } = f.props as { speedKt?: number | null; track?: number | null; onGround?: boolean };
  if (onGround || typeof speedKt !== 'number' || typeof track !== 'number') return [f.lon, f.lat];
  const dt = Math.min(MAX_EXTRAPOLATION_S, Math.max(0, (now - f.ts) / 1000));
  const d = speedKt * KT_TO_MS * dt;
  const rad = (track * Math.PI) / 180;
  const lat = f.lat + (d * Math.cos(rad)) / M_PER_DEG;
  const lon = f.lon + (d * Math.sin(rad)) / (M_PER_DEG * Math.cos((f.lat * Math.PI) / 180));
  return [lon, lat];
}

const EMERGENCY: Record<string, string> = { '7500': 'hijack', '7600': 'radio failure', '7700': 'emergency' };

export function isEmergency(f: Feature): boolean {
  return typeof f.props.squawk === 'string' && f.props.squawk in EMERGENCY;
}

/** RGBA for the icon: emergencies red, on-ground grey, otherwise the layer colour. */
export function flightColour(f: Feature): [number, number, number, number] {
  if (isEmergency(f)) return [255, 82, 82, 255];
  if (f.props.onGround) return [139, 152, 165, 200];
  return [79, 195, 247, 235];
}

export function flightPopup(p: Record<string, unknown>): [string, string][] {
  const squawk = typeof p.squawk === 'string' ? p.squawk : null;
  const rows: [string, string][] = [
    ['Callsign', typeof p.callsign === 'string' && p.callsign ? p.callsign : 'n/a'],
    ['Altitude', p.onGround ? 'On ground' : typeof p.altFt === 'number' ? `${p.altFt.toLocaleString('en-IN')} ft` : 'n/a'],
    ['Speed', typeof p.speedKt === 'number' ? `${Math.round(p.speedKt)} kt` : 'n/a'],
    ['Squawk', squawk ? (EMERGENCY[squawk] ? `${squawk} (${EMERGENCY[squawk]})` : squawk) : 'n/a'],
  ];
  const typeReg = [p.type, p.reg].filter((v): v is string => typeof v === 'string' && !!v).join(' · ');
  if (typeReg) rows.push(['Aircraft', typeReg]);
  if (typeof p.ts === 'number') rows.push(['Last seen', `${formatIST(p.ts)} IST`]);
  if (typeof p.source === 'string') rows.push(['Source', p.source]);
  return rows;
}

/** White airplane silhouette pointing north; tinted per aircraft with IconLayer mask mode. */
export const PLANE_ICON = {
  url:
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24"><path fill="#fff" d="M12 1.5c.8 0 1.4.9 1.4 2v5.6l8.1 4.7v2.1l-8.1-2.4v5l2.2 1.6V22L12 21l-3.6 1v-1.9l2.2-1.6v-5l-8.1 2.4v-2.1l8.1-4.7V3.5c0-1.1.6-2 1.4-2z"/></svg>',
    ),
  width: 64,
  height: 64,
  anchorY: 32,
  mask: true,
};
