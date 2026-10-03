import { getLayer, inBBox, type Feature } from '@ind-intg/shared';
import { loadText } from '../src/source.js';
import type { FeatureStore } from '../src/store.js';
import type { Logger, Worker } from '../src/worker.js';
import { parseCap, parseRss, pickInfo, type CapAlert } from './alerts/cap.js';
import { DistrictIndex, type MultiPolygonCoords } from './alerts/districts.js';

export const SACHET_RSS_URL = 'https://sachet.ndma.gov.in/cap_public_website/rss/rss_india.xml';
const MAX_ITEMS = 300;
const FETCH_CONCURRENCY = 4;

export interface AlertProps extends Record<string, unknown> {
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  sender: string;
  areaDesc: string;
  effective: number | null;
  expires: number | null;
  /** 'polygon' when the CAP message carried geometry; 'district' when joined to district boundaries. */
  geometrySource: 'polygon' | 'district';
  geometry: { type: 'MultiPolygon'; coordinates: MultiPolygonCoords };
}

const clip = (s: string | null, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Centre of the bounding box of all rings: where the alert sits for INDIA_BBOX filtering and the Feature lat/lon. */
function bboxCentre(coords: MultiPolygonCoords): [lat: number, lon: number] {
  let [minLon, minLat, maxLon, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const poly of coords) for (const ring of poly) for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
}

/**
 * CAP alert -> Feature, or a reason it was dropped. Expired, cancelled, non-Actual and unplaceable alerts are
 * dropped. Areas without a polygon are joined to district boundaries by name.
 */
export function capToFeature(alert: CapAlert, districts: DistrictIndex, now: number): Feature<AlertProps> | { drop: string } {
  const info = pickInfo(alert);
  if (!info) return { drop: 'no info block' };
  if (alert.status !== 'Actual') return { drop: `status ${alert.status}` };
  if (alert.msgType === 'Cancel') return { drop: 'cancel message' };
  if (info.expires != null && info.expires <= now) return { drop: 'expired' };

  const coords: MultiPolygonCoords = [];
  let geometrySource: AlertProps['geometrySource'] = 'polygon';
  const unmatched: string[] = [];
  for (const area of info.areas) {
    if (area.polygons.length) {
      coords.push(...area.polygons.map((ring) => [ring]));
    } else {
      const m = districts.match(area.areaDesc, info.headline ?? '');
      coords.push(...m.coords);
      unmatched.push(...m.unmatched);
      if (m.coords.length) geometrySource = 'district';
    }
  }
  if (!coords.length) return { drop: `no geometry (unmatched: ${unmatched.join(', ') || 'none'})` };
  const [lat, lon] = bboxCentre(coords);
  if (!inBBox(lat, lon)) return { drop: 'outside INDIA_BBOX' };

  return {
    id: alert.identifier,
    layer: 'alerts',
    lat,
    lon,
    ts: info.effective ?? alert.sent ?? now,
    props: {
      event: info.event,
      severity: info.severity,
      urgency: info.urgency,
      certainty: info.certainty,
      headline: clip(info.headline, 200),
      description: clip(info.description, 600),
      instruction: clip(info.instruction, 300),
      sender: info.senderName ?? alert.sender,
      areaDesc: clip(info.areas.map((a) => a.areaDesc).filter(Boolean).join('; '), 300) ?? '',
      effective: info.effective,
      expires: info.expires,
      geometrySource,
      geometry: { type: 'MultiPolygon', coordinates: coords },
    },
  };
}

export function createAlertsWorker(
  store: FeatureStore,
  log: Logger,
  rssUrl = process.env.SACHET_RSS_URL || SACHET_RSS_URL,
  districts = DistrictIndex.load(),
): Worker {
  const { ttlSeconds } = getLayer('alerts')!;
  // CAP messages never change once published, so each is fetched once and kept while it is in the feed.
  const cache = new Map<string, CapAlert>();

  return {
    layer: 'alerts',
    intervalMs: 5 * 60_000,
    async tick() {
      const items = parseRss(await loadText(rssUrl, 20_000)).slice(0, MAX_ITEMS);
      // Relative links resolve against the feed URL (fixtures use relative file names).
      const links = items.map((i) => new URL(i.link, rssUrl).href);
      const todo = links.filter((l) => !cache.has(l));
      let failed = 0;
      const run = async () => {
        for (let link = todo.shift(); link; link = todo.shift()) {
          try {
            cache.set(link, parseCap(await loadText(link, 15_000, 'application/xml')));
          } catch (err) {
            failed++; // not cached: retried on the next tick
            log.warn({ layer: 'alerts', link, err: String(err) }, 'CAP fetch/parse failed');
          }
        }
      };
      await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, run));
      for (const key of cache.keys()) if (!links.includes(key)) cache.delete(key);

      const now = Date.now();
      const alerts = links.map((l) => cache.get(l)).filter((a): a is CapAlert => !!a);
      const superseded = new Set(alerts.flatMap((a) => a.references));
      const features: Feature<AlertProps>[] = [];
      const dropped: Record<string, number> = {};
      for (const alert of alerts) {
        const r = superseded.has(alert.identifier) ? { drop: 'superseded' } : capToFeature(alert, districts, now);
        if ('drop' in r) dropped[r.drop.split(' (')[0]!] = (dropped[r.drop.split(' (')[0]!] ?? 0) + 1;
        else features.push(r);
      }
      const { upserted, removed } = await store.sync('alerts', features, (f) => {
        const expires = (f.props as AlertProps).expires;
        return expires == null ? ttlSeconds : Math.min(ttlSeconds, (expires - now) / 1000);
      });
      log.info({ layer: 'alerts', items: items.length, total: features.length, upserted, removed, failed, dropped }, 'alerts synced');
    },
  };
}
