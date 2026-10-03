import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap } from 'maplibre-gl';
import { INDIA_CENTER, INDIA_ZOOM, SOI_ATTRIBUTION, SOI_BOUNDARY_URL, loadBaseStyle, soiLayers } from './style';

export type Projection = 'mercator' | 'globe';

interface Props {
  projection: Projection;
  onBasemapFallback?: (fallback: boolean) => void;
}

export function MapView({ projection, onBasemapFallback }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: MlMap | undefined;
    (async () => {
      // Loaded lazily so the bundle (and tests) don't pull in WebGL code until the map mounts.
      const [{ default: maplibregl }, { style, fallback }] = await Promise.all([import('maplibre-gl'), loadBaseStyle()]);
      if (cancelled || !container.current) return;
      onBasemapFallback?.(fallback);
      created = new maplibregl.Map({
        container: container.current,
        style,
        center: INDIA_CENTER,
        zoom: INDIA_ZOOM,
        attributionControl: { compact: true, customAttribution: SOI_ATTRIBUTION },
      });
      created.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
      created.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      created.on('load', () => {
        created!.addSource('soi-boundary', { type: 'geojson', data: SOI_BOUNDARY_URL });
        for (const layer of soiLayers(fallback)) created!.addLayer(layer);
        setMap(created!);
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

  return <div ref={container} className="map" data-testid="map" />;
}
