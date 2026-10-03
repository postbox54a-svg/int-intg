import { formatIST, type Feature } from '@ind-intg/shared';

export type Bounds = [west: number, south: number, east: number, north: number];

const MAX_ITEMS = 50;

/** Stories inside the visible map area, newest first. */
export function visibleStories(features: Feature[] = [], bounds: Bounds | null, limit = MAX_ITEMS): Feature[] {
  const inView = bounds
    ? features.filter(({ lat, lon }) => lat >= bounds[1] && lat <= bounds[3] && (bounds[0] <= bounds[2] ? lon >= bounds[0] && lon <= bounds[2] : lon >= bounds[0] || lon <= bounds[2]))
    : features;
  return [...inView].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function timeAgo(ts: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - ts) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ${min % 60} min ago`;
}

interface Props {
  stories: Feature[] | undefined;
  bounds: Bounds | null;
  open: boolean;
  onToggleOpen: () => void;
  now?: number;
}

export function NewsFeed({ stories, bounds, open, onToggleOpen, now = Date.now() }: Props) {
  const items = visibleStories(stories, bounds);
  return (
    <aside className={`news-feed ${open ? 'open' : 'closed'}`} aria-label="News in view">
      <button className="news-feed-toggle" onClick={onToggleOpen} aria-expanded={open}>
        {`News in view (${items.length}) ${open ? '▾' : '▸'}`}
      </button>
      {open && (
        <ol className="news-list">
          {items.length === 0 && <li className="news-empty">No geolocated stories in this area yet.</li>}
          {items.map((f) => {
            const p = f.props as { title?: string; url?: string; source?: string; place?: string };
            const safeUrl = typeof p.url === 'string' && /^https?:\/\//.test(p.url) ? p.url : undefined;
            return (
              <li key={f.id}>
                <a href={safeUrl} target="_blank" rel="noopener noreferrer">
                  {p.title}
                </a>
                <div className="news-meta" title={`${formatIST(f.ts)} IST`}>
                  {p.place} · {p.source} · {timeAgo(f.ts, now)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
