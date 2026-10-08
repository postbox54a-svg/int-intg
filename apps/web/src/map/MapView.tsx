import { useEffect, useRef, useState } from 'react';
import type { Feature, LayerId } from '@ind-intg/shared';
import type { MapboxOverlay } from '@deck.gl/mapbox';
import type { GeoJSONSource, LngLatLike, Map as MlMap, Popup } from 'maplibre-gl';
import type { LayerData } from '../live';
import { PLANE_ICON, flightColour, flightPopup, interpolate } from './flights';
import { PORTS, RENDERERS, toFeatureCollection, type LayerRenderer } from './layers';
import { INDIA_CENTER, INDIA_ZOOM, SOI_ATTRIBUTION, SOI_BOUNDARY_URL, loadBaseStyle, soiLayers } from './style';

export type Projection = 'mercator' | 'globe';

interface Props {
  projection: Projection;
  data: LayerData;
  enabled: ReadonlySet<LayerId>;
  onBasemapFallback?: (fallback: boolean) => void;
  /** Visible area [west, south, east, north], reported after each move. */
  onViewportChange?: (bounds: [number, number, number, number]) => void;
}

const renderers = Object.entries(RENDERERS) as [LayerId, LayerRenderer][];
/** Flights are redrawn at this rate so dead-reckoned positions move smoothly. */
const FLIGHT_FRAME_MS = 100;

function popupContent(rows: [string, string][], href?: string | null): HTMLElement {
  // Built with textContent, never innerHTML: values come from external feeds.
  const root = document.createElement('dl');
  root.className = 'popup';
  for (const [label, value] of rows) {
    root.append(Object.assign(document.createElement('dt'), { textContent: label }));
    root.append(Object.assign(document.createElement('dd'), { textContent: value }));
  }
  if (href) root.append(Object.assign(document.createElement('a'), { href, textContent: 'Source', target: '_blank', rel: 'noopener' }));
  return root;
}

type Deck = {
  overlay: MapboxOverlay;
  Overlay: typeof MapboxOverlay;
  IconLayer: typeof import('@deck.gl/layers').IconLayer;
};

export function MapView({ projection, data, enabled, onBasemapFallback, onViewportChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const popup = useRef<{ layer: LayerId; popup: Popup } | null>(null);
  const portLabels = useRef<HTMLElement[]>([]);
  const openPopup = useRef<(layer: LayerId, at: LngLatLike, content: HTMLElement) => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    let created: MlMap | undefined;
    (async () => {
      // Loaded lazily so the bundle (and tests) don't pull in WebGL code until the map mounts.
      const [{ default: maplibregl }, { MapboxOverlay }, { IconLayer }, { style, fallback }] = await Promise.all([
        import('maplibre-gl'),
        import('@deck.gl/mapbox'),
        import('@deck.gl/layers'),
        loadBaseStyle(),
      ]);
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
      openPopup.current = (layer, at, content) => {
        popup.current?.popup.remove();
        popup.current = { layer, popup: new maplibregl.Popup({ maxWidth: '280px' }).setLngLat(at).setDOMContent(content).addTo(m) };
      };
      m.on('load', () => {
        m.addSource('soi-boundary', { type: 'geojson', data: SOI_BOUNDARY_URL });
        for (const layer of soiLayers(fallback)) m.addLayer(layer);
        // MapLibre data layers go under the SOI line so the official boundary stays on top.
        for (const [id, renderer] of renderers) {
          m.addSource(id, { type: 'geojson', data: (renderer.toGeoJSON ?? toFeatureCollection)([]), ...renderer.source });
          for (const layer of renderer.layers) {
            // Text needs glyphs, which the offline fallback style doesn't have.
            if (layer.type === 'symbol' && !m.getStyle().glyphs) continue;
            m.addLayer(layer, 'soi-boundary-casing');
            m.on('mouseenter', layer.id, () => (m.getCanvas().style.cursor = 'pointer'));
            m.on('mouseleave', layer.id, () => (m.getCanvas().style.cursor = ''));
            m.on('click', layer.id, (e) => {
              const f = e.features?.[0];
              if (!f) return;
              if (f.properties.cluster && f.geometry.type === 'Point') {
                const center = f.geometry.coordinates as [number, number];
                void m
                  .getSource<GeoJSONSource>(id)
                  ?.getClusterExpansionZoom(f.properties.cluster_id as number)
                  .then((zoom) => m.easeTo({ center, zoom }));
                return;
              }
              const at = f.geometry.type === 'Point' ? (f.geometry.coordinates as [number, number]) : e.lngLat;
              openPopup.current(id, at, popupContent(renderer.popup(f.properties), renderer.link?.(f.properties)));
            });
          }
        }
        // deck.gl draws the moving layers (flights) inside MapLibre's GL context, so globe view works too.
        const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
        m.addControl(overlay);
        setDeck({ overlay, Overlay: MapboxOverlay, IconLayer });
        // HTML markers rather than a symbol layer, so port names show even without basemap glyphs.
        portLabels.current = PORTS.map(({ name, lon, lat }) => {
          const el = Object.assign(document.createElement('div'), { className: 'port-label', textContent: name });
          el.style.display = 'none';
          new maplibregl.Marker({ element: el, anchor: 'left', offset: [6, 0] }).setLngLat([lon, lat]).addTo(m);
          return el;
        });
        const report = () => onViewportChange?.(m.getBounds().toArray().flat() as [number, number, number, number]);
        m.on('moveend', report);
        report();
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
    if (!map || map.getProjection()?.type === projection) return;
    map.setProjection({ type: projection });
    // deck.gl picks its view (map or globe) when the overlay is created, so swap in a new overlay.
    setDeck((d) => {
      if (!d) return d;
      map.removeControl(d.overlay);
      const overlay = new d.Overlay({ interleaved: true, layers: [] });
      map.addControl(overlay);
      return { ...d, overlay };
    });
  }, [map, projection]);

  useEffect(() => {
    if (!map) return;
    for (const [id, renderer] of renderers) {
      map.getSource<GeoJSONSource>(id)?.setData((renderer.toGeoJSON ?? toFeatureCollection)(data[id] ?? []));
      for (const layer of renderer.layers) {
        if (map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', enabled.has(id) ? 'visible' : 'none');
      }
    }
    for (const el of portLabels.current) el.style.display = enabled.has('ships') ? '' : 'none';
    if (popup.current && !enabled.has(popup.current.layer)) {
      popup.current.popup.remove();
      popup.current = null;
    }
  }, [map, data, enabled]);

  const flights = enabled.has('flights') ? data.flights : undefined;
  useEffect(() => {
    if (!deck) return;
    const { overlay, IconLayer } = deck;
    const draw = () => {
      const now = Date.now();
      overlay.setProps({
        layers: flights?.length
          ? [
              new IconLayer<Feature>({
                id: 'flights',
                data: flights,
                pickable: true,
                iconAtlas: PLANE_ICON.url,
                iconMapping: { plane: { x: 0, y: 0, ...PLANE_ICON } },
                getIcon: () => 'plane',
                getPosition: (f) => interpolate(f, now),
                // deck.gl angles are counter-clockwise; tracks are clockwise from north.
                getAngle: (f) => -((f.props.track as number | null) ?? 0),
                getColor: flightColour,
                getSize: 18,
                sizeMinPixels: 10,
                // Billboarded icons are back-face culled in deck's GlobeView; without this they vanish on the globe.
                parameters: { cullMode: 'none' },
                updateTriggers: { getPosition: now },
                onClick: ({ object, coordinate }) => {
                  if (!object || !coordinate) return;
                  const props = { ...object.props, ts: object.ts };
                  // Deferred: MapLibre's own handling of this same click would otherwise close the new popup.
                  setTimeout(() => openPopup.current('flights', coordinate as [number, number], popupContent(flightPopup(props))));
                },
              }),
            ]
          : [],
      });
    };
    draw();
    if (!flights?.length) return;
    const t = setInterval(draw, FLIGHT_FRAME_MS);
    return () => clearInterval(t);
  }, [deck, flights]);

  return <div ref={container} className="map" data-testid="map" />;
}
