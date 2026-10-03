import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { App } from './App';
import { IstClock } from './components/IstClock';
import { LayerPanel } from './components/LayerPanel';
import { FALLBACK_STYLE, isBasemapBoundary, prepareStyle, soiLayers } from './map/style';
import { indexStatuses } from './status';

describe('App', () => {
  it('renders the layer panel, map, IST clock, globe toggle and disclaimer', () => {
    const html = renderToString(<App />);
    expect(html).toContain('Earthquakes');
    expect(html).toContain('Ships');
    expect(html).toContain('data-testid="map"');
    expect(html).toContain('IST');
    expect(html).toContain('Globe');
    expect(html).toContain('Emergencies: 112');
  });
});

describe('LayerPanel', () => {
  const base = { onToggleOpen: () => {}, onToggleLayer: () => {}, counts: { quakes: 7 }, statuses: {} };

  it('shows toggles with live counts and worker notes', () => {
    const html = renderToString(
      <LayerPanel
        {...base}
        open
        enabled={new Set(['quakes'] as const)}
        statuses={{ ships: { layer: 'ships', lastSuccess: null, errorCount: 0, consecutiveErrors: 0, skipped: 'missing AISSTREAM_API_KEY' } }}
      />,
    );
    expect(html.match(/type="checkbox"/g)).toHaveLength(5);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('>7<');
    expect(html).toContain('missing AISSTREAM_API_KEY');
  });

  it('collapses to just the toggle button', () => {
    const html = renderToString(<LayerPanel {...base} open={false} enabled={new Set()} />);
    expect(html).not.toContain('Earthquakes');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('IstClock', () => {
  it('shows the time in Asia/Kolkata', () => {
    // 2026-01-01T00:00:00Z is 05:30 IST.
    expect(renderToString(<IstClock now={Date.UTC(2026, 0, 1)} />)).toContain('05:30:00');
  });
});

describe('map style', () => {
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water' },
      { id: 'boundary_2', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary' },
      { id: 'boundary_disputed', type: 'line', source: 'openmaptiles', 'source-layer': 'boundary' },
      { id: 'place_country', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place' },
    ] as LayerSpecification[],
  };

  it('hides every basemap boundary layer', () => {
    expect(prepareStyle(style).layers.map((l) => l.id)).toEqual(['water', 'place_country']);
    expect(style.layers).toHaveLength(4); // input untouched
    expect(isBasemapBoundary({ id: 'admin-lines', type: 'line', source: 'x' })).toBe(true);
  });

  it('draws the SOI boundary line last, with a land fill only in the fallback style', () => {
    expect(soiLayers(false).map((l) => l.id).at(-1)).toBe('soi-boundary');
    expect(soiLayers(false).some((l) => l.id === 'soi-land')).toBe(false);
    expect(soiLayers(true)[0]!.id).toBe('soi-land');
    expect(FALLBACK_STYLE.layers.some(isBasemapBoundary)).toBe(false);
  });

  it('ships a valid Survey of India boundary', () => {
    const geo = JSON.parse(readFileSync(new URL('../public/geo/india-soi.geojson', import.meta.url), 'utf8'));
    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features[0].geometry.type).toBe('MultiPolygon');
  });
});

describe('indexStatuses', () => {
  it('keys statuses by layer and drops unknown layers', () => {
    const out = indexStatuses([
      { layer: 'quakes', lastSuccess: 1, errorCount: 0, consecutiveErrors: 0 },
      { layer: 'bogus' as never, lastSuccess: null, errorCount: 0, consecutiveErrors: 0 },
    ]);
    expect(Object.keys(out)).toEqual(['quakes']);
  });
});
