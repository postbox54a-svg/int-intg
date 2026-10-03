export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Mainland India + EEZ. */
export const INDIA_BBOX: BBox = { minLat: 5, minLon: 66, maxLat: 37, maxLon: 98 };

/** Extra sea boxes used for the AIS subscription (Phase 6). Approximate EEZ extents. */
export const SEA_BOXES: Record<'arabianSea' | 'bayOfBengal' | 'andamanNicobar' | 'lakshadweep', BBox> = {
  arabianSea: { minLat: 8, minLon: 66, maxLat: 24, maxLon: 78 },
  bayOfBengal: { minLat: 8, minLon: 78, maxLat: 23, maxLon: 92.5 },
  andamanNicobar: { minLat: 6, minLon: 91.5, maxLat: 14.5, maxLon: 95 },
  lakshadweep: { minLat: 7.5, minLon: 71, maxLat: 14, maxLon: 74.5 },
};

export function inBBox(lat: number, lon: number, box: BBox = INDIA_BBOX): boolean {
  return lat >= box.minLat && lat <= box.maxLat && lon >= box.minLon && lon <= box.maxLon;
}

/** India Standard Time (Asia/Kolkata) formatter for display. */
export function formatIST(ts: number, withDate = true): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    ...(withDate ? { day: '2-digit', month: 'short', year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(ts);
}
