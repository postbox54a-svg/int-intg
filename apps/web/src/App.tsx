import { useState } from 'react';
import { LAYER_IDS, type LayerId } from '@ind-intg/shared';
import { IstClock } from './components/IstClock';
import { LayerPanel } from './components/LayerPanel';
import { NewsFeed, type Bounds } from './components/NewsFeed';
import { MapView, type Projection } from './map/MapView';
import { useLiveFeatures } from './live';
import { useWorkerStatuses } from './status';

export const DISCLAIMER =
  'Public data, may be delayed or incomplete. Not for navigation or emergency use. Emergencies: 112.';

export function App() {
  const [panelOpen, setPanelOpen] = useState(true);
  const [enabled, setEnabled] = useState<ReadonlySet<LayerId>>(() => new Set(LAYER_IDS));
  const [projection, setProjection] = useState<Projection>('mercator');
  const [fallback, setFallback] = useState(false);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [feedOpen, setFeedOpen] = useState(true);
  const statuses = useWorkerStatuses();
  const { data, connected } = useLiveFeatures(enabled);
  const counts: Partial<Record<LayerId, number>> = {};
  for (const id of LAYER_IDS) counts[id] = data[id]?.length ?? 0;

  const toggleLayer = (id: LayerId) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="app">
      <MapView projection={projection} data={data} enabled={enabled} onBasemapFallback={setFallback} onViewportChange={setBounds} />
      <LayerPanel
        open={panelOpen}
        onToggleOpen={() => setPanelOpen((o) => !o)}
        enabled={enabled}
        onToggleLayer={toggleLayer}
        counts={counts}
        statuses={statuses}
        connected={connected}
      />
      <div className="top-right">
        <IstClock />
        <button
          className="projection-toggle"
          onClick={() => setProjection((p) => (p === 'globe' ? 'mercator' : 'globe'))}
          title="Switch between globe and flat map"
        >
          {projection === 'globe' ? 'Flat' : 'Globe'}
        </button>
      </div>
      {enabled.has('news') && <NewsFeed stories={data.news} bounds={bounds} open={feedOpen} onToggleOpen={() => setFeedOpen((o) => !o)} />}
      {fallback && <div className="basemap-note">Basemap unavailable: showing the offline style.</div>}
      <footer className="disclaimer">{DISCLAIMER}</footer>
    </div>
  );
}
