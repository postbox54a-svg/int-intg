import { formatIST, type Feature, type LayerId } from '@ind-intg/shared';
import type { FeatureCollection, Geometry, MultiPolygon, Point } from 'geojson';
import type { LayerSpecification } from 'maplibre-gl';

type FC = FeatureCollection<Point>;

export function toFeatureCollection(features: Feature[] = []): FC {
  return {
    type: 'FeatureCollection',
    features: features.map((f) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
      properties: { ...f.props, id: f.id, ts: f.ts },
    })),
  };
}

export interface LayerRenderer {
  /** Map layers drawn from the GeoJSON source named after the layer id. */
  layers: LayerSpecification[];
  /** Extra GeoJSON source options, e.g. clustering. */
  source?: { cluster?: boolean; clusterRadius?: number; clusterMaxZoom?: number };
  /** Features -> source data; defaults to points at each feature's lat/lon. */
  toGeoJSON?(features: Feature[]): FeatureCollection<Geometry>;
  /** Rows for the click popup: [label, value]. */
  popup(props: Record<string, unknown>): [string, string][];
  link?(props: Record<string, unknown>): string | null;
}

export const QUAKES: LayerRenderer = {
  layers: [
    {
      id: 'quakes-circles',
      type: 'circle',
      source: 'quakes',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'mag'], 2], 2, 3, 4, 7, 6, 16, 8, 30],
        'circle-color': ['step', ['coalesce', ['get', 'depthKm'], 0], '#ff6b3d', 70, '#ffa94d', 300, '#ffd43b'],
        'circle-opacity': 0.75,
        'circle-stroke-color': '#0b0f14',
        'circle-stroke-width': 1,
      },
    },
  ],
  popup: (p) => [
    ['Place', typeof p.place === 'string' ? p.place : 'Unknown'],
    ['Magnitude', typeof p.mag === 'number' ? `M ${p.mag.toFixed(1)}${p.magType ? ` (${p.magType})` : ''}` : 'n/a'],
    ['Depth', typeof p.depthKm === 'number' ? `${Math.round(p.depthKm)} km` : 'n/a'],
    ['Time', typeof p.ts === 'number' ? `${formatIST(p.ts)} IST` : 'n/a'],
  ],
  link: (p) => (typeof p.url === 'string' && p.url.startsWith('https://') ? p.url : null),
};

/** CAP severities, most severe first, with their fill colours. */
export const SEVERITY_COLOURS: [string, string][] = [
  ['Extreme', '#d32f2f'],
  ['Severe', '#f57c00'],
  ['Moderate', '#fbc02d'],
  ['Minor', '#4fc3f7'],
];
const UNKNOWN_SEVERITY = '#8b98a5';
const severityColour: unknown[] = ['match', ['get', 'severity'], ...SEVERITY_COLOURS.flat(), UNKNOWN_SEVERITY];
// Higher sort key draws on top, so the most severe alert wins where areas overlap.
const severityRank: unknown[] = ['match', ['get', 'severity'], ...SEVERITY_COLOURS.flatMap(([s], i) => [s, SEVERITY_COLOURS.length - i]), 0];

/** Alerts carry their area in props.geometry (CAP polygon or joined district boundaries). */
export function alertsToGeoJSON(features: Feature[] = []): FeatureCollection<MultiPolygon> {
  return {
    type: 'FeatureCollection',
    features: features.flatMap((f) => {
      const { geometry, ...props } = f.props as { geometry?: MultiPolygon };
      return geometry?.type === 'MultiPolygon' ? [{ type: 'Feature' as const, geometry, properties: { ...props, id: f.id, ts: f.ts } }] : [];
    }),
  };
}

const istOrNa = (v: unknown) => (typeof v === 'number' ? `${formatIST(v)} IST` : 'n/a');

export const ALERTS: LayerRenderer = {
  toGeoJSON: alertsToGeoJSON,
  layers: [
    {
      id: 'alerts-fill',
      type: 'fill',
      source: 'alerts',
      layout: { 'fill-sort-key': severityRank as never },
      paint: { 'fill-color': severityColour as never, 'fill-opacity': 0.3 },
    },
    {
      id: 'alerts-outline',
      type: 'line',
      source: 'alerts',
      layout: { 'line-sort-key': severityRank as never },
      paint: { 'line-color': severityColour as never, 'line-width': 1.5, 'line-opacity': 0.9 },
    },
  ],
  popup: (p) => {
    const rows: [string, string][] = [
      ['Event', typeof p.event === 'string' ? p.event : 'Alert'],
      ['Severity', [p.severity, p.urgency, p.certainty].filter((v) => typeof v === 'string').join(' · ') || 'n/a'],
      ['Area', typeof p.areaDesc === 'string' && p.areaDesc ? p.areaDesc : 'n/a'],
      ['Issued by', typeof p.sender === 'string' ? p.sender : 'n/a'],
      ['From', istOrNa(p.effective)],
      ['Until', istOrNa(p.expires)],
    ];
    if (typeof p.headline === 'string') rows.push(['Headline', p.headline]);
    if (typeof p.instruction === 'string') rows.push(['Advice', p.instruction]);
    if (p.geometrySource === 'district') rows.push(['Map area', 'District boundaries (Census 2011)']);
    return rows;
  },
};

const NEWS_COLOUR = '#ba68c8';

export const NEWS: LayerRenderer = {
  source: { cluster: true, clusterRadius: 40, clusterMaxZoom: 11 },
  layers: [
    {
      id: 'news-clusters',
      type: 'circle',
      source: 'news',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': NEWS_COLOUR,
        'circle-opacity': 0.8,
        'circle-radius': ['step', ['get', 'point_count'], 12, 5, 16, 20, 22],
        'circle-stroke-color': '#0b0f14',
        'circle-stroke-width': 1.5,
      },
    },
    {
      // Needs glyphs; skipped by MapView when the style has none (offline fallback).
      id: 'news-cluster-count',
      type: 'symbol',
      source: 'news',
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#ffffff' },
    },
    {
      id: 'news-points',
      type: 'circle',
      source: 'news',
      filter: ['!', ['has', 'point_count']],
      paint: { 'circle-color': NEWS_COLOUR, 'circle-radius': 6, 'circle-stroke-color': '#0b0f14', 'circle-stroke-width': 1.5 },
    },
  ],
  popup: (p) => [
    ['Headline', typeof p.title === 'string' ? p.title : 'n/a'],
    ['Place', [p.place, p.admin1].filter((v) => typeof v === 'string' && v).join(', ') || 'n/a'],
    ['Source', typeof p.source === 'string' ? p.source : 'n/a'],
    ['Published', istOrNa(p.ts)],
  ],
  link: (p) => (typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url : null),
};

/** Renderers for MapLibre-drawn layers that have landed; flights are drawn with deck.gl (see flights.ts). */
// Order matters: earlier entries draw underneath (alert areas below quake circles).
export const RENDERERS: Partial<Record<LayerId, LayerRenderer>> = { alerts: ALERTS, quakes: QUAKES, news: NEWS };
