import { LAYERS, type LayerId } from '@ind-intg/shared';
import { SHIP_COLOURS } from '../map/layers';
import type { WorkerStatus } from '../status';

interface Props {
  open: boolean;
  onToggleOpen: () => void;
  enabled: ReadonlySet<LayerId>;
  onToggleLayer: (id: LayerId) => void;
  counts: Partial<Record<LayerId, number>>;
  statuses: Partial<Record<LayerId, WorkerStatus>>;
  connected?: boolean;
}

function statusNote(s: WorkerStatus | undefined): string | null {
  if (!s) return null;
  if (s.skipped) return s.skipped;
  if (s.consecutiveErrors > 0) return `${s.consecutiveErrors} errors, retrying`;
  return null;
}

export function LayerPanel({ open, onToggleOpen, enabled, onToggleLayer, counts, statuses, connected = false }: Props) {
  return (
    <aside className={`panel ${open ? 'open' : 'closed'}`} aria-label="Layers">
      <button className="panel-toggle" onClick={onToggleOpen} aria-expanded={open} title={open ? 'Hide layers' : 'Show layers'}>
        {open ? '‹' : '›'}
      </button>
      {open && (
        <div className="panel-body">
          <h1>India Pulse</h1>
          <div className={`live ${connected ? 'on' : 'off'}`}>{connected ? 'Live' : 'Connecting…'}</div>
          <ul className="layers">
            {LAYERS.map((l) => {
              const note = statusNote(statuses[l.id]);
              return (
                <li key={l.id}>
                  <label>
                    <input type="checkbox" checked={enabled.has(l.id)} onChange={() => onToggleLayer(l.id)} />
                    <span className="swatch" style={{ background: l.colour }} />
                    <span className="layer-name">{l.name}</span>
                    <span className="count" title="Features on the map">
                      {counts[l.id] ?? 0}
                    </span>
                  </label>
                  {note && <div className="layer-note">{note}</div>}
                  {l.id === 'ships' && enabled.has('ships') && (
                    <ul className="legend" aria-label="Ship types">
                      {SHIP_COLOURS.map(([c, label, colour]) => (
                        <li key={c}>
                          <span className="swatch" style={{ background: colour }} /> {label}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
