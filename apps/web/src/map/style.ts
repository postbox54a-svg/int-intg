import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';
export const SOI_BOUNDARY_URL = '/geo/india-soi.geojson';
export const SOI_ATTRIBUTION =
  'Boundary: <a href="https://github.com/datameet/maps" target="_blank" rel="noopener">Survey of India via DataMeet</a> (CC BY 4.0)';

export const INDIA_CENTER: [number, number] = [80.5, 22.5];
export const INDIA_ZOOM = 4.2;

const BACKGROUND = '#0b0f14';

/**
 * Basemap boundary layers show disputed lines that differ from the official Survey of India boundary.
 * OpenMapTiles-schema styles (OpenFreeMap) draw them from the `boundary` source-layer.
 */
export function isBasemapBoundary(layer: LayerSpecification): boolean {
  const sourceLayer = 'source-layer' in layer ? layer['source-layer'] : undefined;
  return sourceLayer === 'boundary' || /boundary|admin/i.test(layer.id);
}

/** Drops basemap boundary layers so only the SOI line is shown. Returns a new style. */
export function prepareStyle(style: StyleSpecification): StyleSpecification {
  return { ...style, layers: style.layers.filter((l) => !isBasemapBoundary(l)) };
}

/** Used when the basemap style cannot be fetched: plain dark background, India filled from the SOI GeoJSON. */
export const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  // Glyphs are not needed: the fallback has no text layers.
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': BACKGROUND } }],
};

/** Fetches the basemap style; resolves to the fallback style on any error or after `timeoutMs`. */
export async function loadBaseStyle(
  url = OPENFREEMAP_STYLE_URL,
  timeoutMs = 5000,
): Promise<{ style: StyleSpecification; fallback: boolean }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { style: prepareStyle((await res.json()) as StyleSpecification), fallback: false };
  } catch {
    return { style: FALLBACK_STYLE, fallback: true };
  }
}

/** SOI layers, added last so the official boundary is drawn on top of everything. */
export function soiLayers(fallback: boolean): LayerSpecification[] {
  const layers: LayerSpecification[] = [
    {
      id: 'soi-boundary-casing',
      type: 'line',
      source: 'soi-boundary',
      paint: { 'line-color': '#000000', 'line-width': 3, 'line-opacity': 0.5 },
    },
    {
      id: 'soi-boundary',
      type: 'line',
      source: 'soi-boundary',
      paint: { 'line-color': '#f2b84b', 'line-width': 1.2 },
    },
  ];
  if (fallback) {
    layers.unshift({
      id: 'soi-land',
      type: 'fill',
      source: 'soi-boundary',
      paint: { 'fill-color': '#1a222c' },
    });
  }
  return layers;
}
