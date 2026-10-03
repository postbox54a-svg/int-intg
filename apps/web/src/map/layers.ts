import { formatIST, type Feature, type LayerId } from '@ind-intg/shared';
import type { FeatureCollection, Point } from 'geojson';
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

/** Renderers for layers that have landed; the rest arrive in later phases. */
export const RENDERERS: Partial<Record<LayerId, LayerRenderer>> = { quakes: QUAKES };
