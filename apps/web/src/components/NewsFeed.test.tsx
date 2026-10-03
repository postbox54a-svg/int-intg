import type { Feature } from '@ind-intg/shared';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NEWS } from '../map/layers';
import { NewsFeed, timeAgo, visibleStories, type Bounds } from './NewsFeed';

const story = (id: string, lat: number, lon: number, ts: number, url = `https://x.in/${id}`): Feature => ({
  id,
  layer: 'news',
  lat,
  lon,
  ts,
  props: { title: `Story ${id}`, url, source: 'x.in', place: 'Somewhere' },
});
const westIndia: Bounds = [68, 15, 76, 25];

describe('visibleStories', () => {
  it('keeps stories in the viewport, newest first', () => {
    const items = [story('mumbai', 19.08, 72.88, 1), story('kolkata', 22.57, 88.36, 3), story('pune', 18.52, 73.86, 2)];
    expect(visibleStories(items, westIndia).map((s) => s.id)).toEqual(['pune', 'mumbai']);
    expect(visibleStories(items, null)).toHaveLength(3);
    expect(visibleStories(items, null, 1)).toHaveLength(1);
  });
});

describe('NewsFeed', () => {
  it('lists stories in view with safe links', () => {
    const html = renderToString(
      <NewsFeed
        stories={[story('a', 19, 73, 0), story('b', 19.1, 73.1, 0, 'javascript:alert(1)')]}
        bounds={westIndia}
        open
        onToggleOpen={() => {}}
        now={5 * 60_000}
      />,
    );
    expect(html).toContain('News in view (2)');
    expect(html).toContain('href="https://x.in/a"');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('5 min ago');
  });

  it('formats relative times', () => {
    expect(timeAgo(0, 30_000)).toBe('just now');
    expect(timeAgo(0, 125 * 60_000)).toBe('2 h 5 min ago');
  });
});

describe('news renderer', () => {
  it('clusters pins and shows headline, place, source and IST time', () => {
    expect(NEWS.source?.cluster).toBe(true);
    const rows = NEWS.popup({ title: 'Heavy rain in Mumbai', place: 'Mumbai', admin1: 'Maharashtra', source: 'x.in', ts: Date.UTC(2026, 9, 3, 6) });
    expect(rows).toEqual([
      ['Headline', 'Heavy rain in Mumbai'],
      ['Place', 'Mumbai, Maharashtra'],
      ['Source', 'x.in'],
      ['Published', expect.stringContaining('11:30:00 IST')],
    ]);
    expect(NEWS.link?.({ url: 'javascript:alert(1)' })).toBeNull();
  });
});
