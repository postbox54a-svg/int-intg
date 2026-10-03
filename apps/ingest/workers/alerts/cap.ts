import { XMLParser } from 'fast-xml-parser';

export interface RssItem {
  title: string;
  link: string;
  pubDate: string | null;
}

export interface CapArea {
  areaDesc: string;
  /** Rings as [lon, lat] pairs (GeoJSON order), closed. */
  polygons: [number, number][][];
}

export interface CapInfo {
  language: string;
  event: string;
  severity: string;
  urgency: string;
  certainty: string;
  effective: number | null;
  expires: number | null;
  senderName: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  areas: CapArea[];
}

export interface CapAlert {
  identifier: string;
  sender: string;
  sent: number | null;
  status: string;
  msgType: string;
  /** Identifiers this alert updates or cancels (from CAP `references`: "sender,identifier,sent ..."). */
  references: string[];
  info: CapInfo[];
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => ['item', 'info', 'area', 'polygon', 'circle', 'geocode'].includes(name),
});

const text = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
};
const time = (v: unknown): number | null => {
  const t = Date.parse(text(v) ?? '');
  return Number.isFinite(t) ? t : null;
};

export function parseRss(xml: string): RssItem[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: Record<string, unknown>[] } } };
  const items = doc.rss?.channel?.item;
  if (!Array.isArray(items)) throw new Error('RSS has no channel/item');
  return items.flatMap((i) => {
    const link = text(i.link);
    return link ? [{ title: text(i.title) ?? '', link, pubDate: text(i.pubDate) }] : [];
  });
}

/** CAP "lat,lon lat,lon …" -> closed [lon, lat] ring; null if malformed. */
export function parsePolygon(s: string): [number, number][] | null {
  const ring = s
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number));
  if (ring.length < 4 || ring.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n)))) return null;
  const out = ring.map(([lat, lon]) => [lon!, lat!] as [number, number]);
  const [first, last] = [out[0]!, out.at(-1)!];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push(first);
  return out;
}

/** CAP "lat,lon radiusKm" -> 32-gon ring. */
export function circleToPolygon(s: string, sides = 32): [number, number][] | null {
  const m = s.trim().match(/^(-?[\d.]+),(-?[\d.]+)\s+([\d.]+)$/);
  if (!m) return null;
  const [lat, lon, r] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!(r > 0)) return null;
  const ring: [number, number][] = [];
  for (let i = 0; i <= sides; i++) {
    const a = (2 * Math.PI * (i % sides)) / sides;
    ring.push([lon + (r * Math.sin(a)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (r * Math.cos(a)) / 111.32]);
  }
  return ring;
}

export function parseCap(xml: string): CapAlert {
  const a = (parser.parse(xml) as { alert?: Record<string, unknown> }).alert;
  const identifier = text(a?.identifier);
  if (!a || !identifier) throw new Error('not a CAP alert');
  const infos = (a.info as Record<string, unknown>[] | undefined) ?? [];
  return {
    identifier,
    sender: text(a.sender) ?? '',
    sent: time(a.sent),
    status: text(a.status) ?? '',
    msgType: text(a.msgType) ?? '',
    references: (text(a.references) ?? '')
      .split(/\s+/)
      .map((r) => r.split(',')[1])
      .filter((id): id is string => !!id),
    info: infos.map((i) => ({
      language: text(i.language) ?? 'en-US',
      event: text(i.event) ?? 'Alert',
      severity: text(i.severity) ?? 'Unknown',
      urgency: text(i.urgency) ?? 'Unknown',
      certainty: text(i.certainty) ?? 'Unknown',
      effective: time(i.effective) ?? time(i.onset),
      expires: time(i.expires),
      senderName: text(i.senderName),
      headline: text(i.headline),
      description: text(i.description),
      instruction: text(i.instruction),
      areas: ((i.area as Record<string, unknown>[] | undefined) ?? []).map((ar) => ({
        areaDesc: text(ar.areaDesc) ?? '',
        polygons: [
          ...((ar.polygon as unknown[] | undefined) ?? []).map((p) => parsePolygon(text(p) ?? '')),
          ...((ar.circle as unknown[] | undefined) ?? []).map((c) => circleToPolygon(text(c) ?? '')),
        ].filter((r): r is [number, number][] => r !== null),
      })),
    })),
  };
}

/** The English info block if there is one (SACHET often adds a Hindi or regional-language block), else the first. */
export function pickInfo(alert: CapAlert): CapInfo | undefined {
  return alert.info.find((i) => i.language.toLowerCase().startsWith('en')) ?? alert.info[0];
}
