import { useEffect, useRef, useState } from 'react';
import type { LayerId } from '@ind-intg/shared';
import type { GeoJSONSource, Map as MlMap, Popup } from 'maplibre-gl';
import type { LayerData } from '../live';
import { RENDERERS, toFeatureCollection, type LayerRenderer } from './layers';
import { INDIA_CENTER, INDIA_ZOOM, SOI_ATTRIBUTION, SOI_BOUNDARY_URL, loadBaseStyle, soiLayers } from './style';

export type Projection = 'mercator' | 'globe';

interface Props {
  projection: Projection;
  data: LayerData;
  enabled: ReadonlySet<LayerId>;
  onBasemapFallback?: (fallback: boolean) => void;
}

const renderers = Object.entries(RENDERERS) as [LayerId, LayerRenderer][];

function popupContent(renderer: LayerRenderer, props: Record<string, unknown>): HTMLElement {
  // Built with textContent, never innerHTML: values come from external feeds.
  const root = document.createElement('dl');
  root.className = 'popup';
  for (const [label, value] of renderer.popup(props)) {
    root.append(Object.assign(document.createElement('dt'), { textContent: label }));
    root.append(Object.assign(document.createElement('dd'), { textContent: value }));
  }
  const href = renderer.link?.(props);
  if (href) {
    const a = Object.assign(document.createElement('a'), { href, textContent: 'Source', target: '_blank', rel: 'noopener' });
    root.append(a);
  }
  return root;
}

export function MapView({ projection, data, enabled, onBasemapFallback }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const popup = useRef<{ layer: LayerId; popup: Popup } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: MlMap | undefined;
    (async () => {
      // Loaded lazily so the bundle (and tests) don't pull in WebGL code until the map mounts.
      const [{ default: maplibregl }, { style, fallback }] = await Promise.all([import('maplibre-gl'), loadBaseStyle()]);
      if (cancelled || !container.current) return;
      onBasemapFallback?.(fallback);
      const m = new maplibregl.Map({
        container: container.current,
        style,
        center: INDIA_CENTER,
        zoom: INDIA_ZOOM,
        attributionControl: { compact: true, customAttribution: SOI_ATTRIBUTION },
      });
      created = m;
      m.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
      m.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      m.on('load', () => {
        m.addSource('soi-boundary', { type: 'geojson', data: SOI_BOUNDARY_URL });
        for (const layer of soiLayers(fallback)) m.addLayer(layer);
        // Data layers go under the SOI line so the official boundary stays on top.
        for (const [id, renderer] of renderers) {
          m.addSource(id, { type: 'geojson', data: toFeatureCollection() });
          for (const layer of renderer.layers) {
            m.addLayer(layer, 'soi-boundary-casing');
            m.on('mouseenter', layer.id, () => (m.getCanvas().style.cursor = 'pointer'));
            m.on('mouseleave', layer.id, () => (m.getCanvas().style.cursor = ''));
            m.on('click', layer.id, (e) => {
              const f = e.features?.[0];
              if (!f || f.geometry.type !== 'Point') return;
              popup.current?.popup.remove();
              popup.current = {
                layer: id,
                popup: new maplibregl.Popup({ maxWidth: '280px' })
                  .setLngLat(f.geometry.coordinates as [number, number])
                  .setDOMContent(popupContent(renderer, f.properties))
                  .addTo(m),
              };
            });
          }
        }
        setMap(m);
      });
    })();
    return () => {
      cancelled = true;
      created?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- create the map once
  }, []);

  useEffect(() => {
    map?.setProjection({ type: projection });
  }, [map, projection]);

  useEffect(() => {
    if (!map) return;
    for (const [id, renderer] of renderers) {
      map.getSource<GeoJSONSource>(id)?.setData(toFeatureCollection(data[id]));
      for (const layer of renderer.layers) map.setLayoutProperty(layer.id, 'visibility', enabled.has(id) ? 'visible' : 'none');
    }
    if (popup.current && !enabled.has(popup.current.layer)) {
      popup.current.popup.remove();
      popup.current = null;
    }
  }, [map, data, enabled]);

  return <div ref={container} className="map" data-testid="map" />;
}
