import { readFileSync } from 'node:fs';
import type { Feature } from '@ind-intg/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureStore } from '../src/store.js';
import type { Logger } from '../src/worker.js';
import { createNewsWorker, geocode, type NewsProps } from './news.js';
import { dedupe, normaliseUrl, titleSimilarity, titleTokens } from './news/dedupe.js';
import { Gazetteer, SAMPLE_GAZETTEER_FILE, buildFromGeoNames } from './news/gazetteer.js';
import { parseFeed, parseGdelt } from './news/sources.js';

const dir = new URL('../../../fixtures/news/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir), 'utf8');
const gazetteer = new Gazetteer(JSON.parse(readFileSync(SAMPLE_GAZETTEER_FILE, 'utf8')));
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

afterEach(() => vi.useRealTimers());

describe('gazetteer', () => {
  it('finds the earliest capitalised place, longest name first, including old names', () => {
    expect(gazetteer.match('Air quality in Delhi slips')?.name).toBe('Delhi');
    expect(gazetteer.match('Talks in New Delhi end')?.name).toBe('New Delhi');
    expect(gazetteer.match('Bombay High Court reserves verdict')?.name).toBe('Mumbai');
    expect(gazetteer.match('Pune firm opens Chennai office')?.name).toBe('Pune');
  });

  it('ignores lowercase words and unknown places', () => {
    expect(gazetteer.match('the kota of sugar was cut')).toBeNull();
    expect(gazetteer.match('Monsoon withdrawal delayed, IMD says')).toBeNull();
  });

  it('builds from a GeoNames dump: populated places above 50k, ASCII alternate names', () => {
    const row = (name: string, alts: string, cls: string, pop: number) =>
      ['1', name, name, alts, '19.07', '72.88', cls, 'PPLA', 'IN', '', '16', '', '', '', String(pop)].join('\t');
    const file = buildFromGeoNames([row('Mumbai', 'Bombay,मुंबई', 'P', 12_000_000), row('Tiny', '', 'P', 10_000), row('Lake', '', 'H', 0)].join('\n'));
    expect(file.places).toEqual([['Mumbai', 19.07, 72.88, 12_000_000, '16', ['Bombay']]]);
  });
});

describe('sources', () => {
  it('parses GDELT artlist', () => {
    const a = parseGdelt(JSON.parse(read('gdelt-artlist.synthetic.json')));
    expect(a).toHaveLength(15);
    expect(a[0]).toEqual({
      url: 'https://example-news.invalid/mumbai-rain-trains',
      title: 'Heavy rain lashes Mumbai, local trains delayed',
      published: Date.UTC(2026, 9, 3, 15, 10),
      source: 'example-news.invalid',
      summary: null,
    });
    expect(parseGdelt({})).toEqual([]);
  });

  it('parses RSS (CDATA, tags stripped) and Atom (alternate link)', () => {
    const rss = parseFeed(read('rss.synthetic.xml'), 'https://example-paper.invalid/feed');
    expect(rss).toHaveLength(5);
    expect(rss.at(-1)!.title).toBe('Ahmedabad riverfront gets new pedestrian bridge');
    const atom = parseFeed(read('atom.synthetic.xml'), 'https://example-wire.invalid/feed');
    expect(atom.map((x) => x.url)).toEqual(['https://example-wire.invalid/bhubaneswar-award', 'https://example-wire.invalid/vizag-cleanup']);
    expect(() => parseFeed('<html/>', 'x')).toThrow();
  });
});

describe('dedupe', () => {
  it('normalises URLs', () => {
    expect(normaliseUrl('https://www.x.in/a/b/amp/?utm_source=t&id=2#top')).toBe(normaliseUrl('http://x.in/a/b?id=2'));
  });

  it('drops same URL and similar titles, keeping the first', () => {
    const t = (s: string) => titleTokens(s);
    expect(titleSimilarity(t('Heavy rain lashes Mumbai, local trains delayed'), t('Mumbai rains: heavy rain lashes city, local trains delayed'))).toBeGreaterThanOrEqual(0.6);
    const items = [
      { url: 'https://a.in/1', title: 'Heavy rain lashes Mumbai, local trains delayed' },
      { url: 'https://a.in/1?utm_source=x', title: 'Different title' },
      { url: 'https://b.in/2', title: 'Mumbai rains: heavy rain lashes city, local trains delayed' },
      { url: 'https://c.in/3', title: 'Chennai metro milestone' },
    ];
    expect(dedupe(items).map((i) => i.url)).toEqual(['https://a.in/1', 'https://c.in/3']);
    expect(dedupe(items, [{ url: 'https://c.in/3', title: 'x' }]).map((i) => i.url)).toEqual(['https://a.in/1']);
  });
});

describe('news worker (fixtures)', () => {
  it('merges GDELT + RSS + Atom, dedupes, geocodes and drops old or unplaceable stories', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 3, 16, 0));
    const merge = vi.fn(async () => ({ upserted: 0, removed: 0 }));
    const store = { snapshot: async () => [], merge } as unknown as FeatureStore;
    const worker = createNewsWorker(
      store,
      log,
      { GDELT_DOC_URL: new URL('gdelt-artlist.synthetic.json', dir).href, NEWS_RSS_FEEDS: `${new URL('rss.synthetic.xml', dir).href},${new URL('atom.synthetic.xml', dir).href}` },
      gazetteer,
    );
    await worker.tick();
    const [, features, ttl] = merge.mock.calls[0] as unknown as [string, Feature<NewsProps>[], (f: Feature) => number];
    const places = features.map((f) => f.props.place);
    // 22 articles: 1 too old, 2 duplicates (URL, similar title), 2 with no place.
    expect(features).toHaveLength(17);
    expect(places).toEqual(expect.arrayContaining(['Mumbai', 'Chennai', 'Kochi', 'Ludhiana', 'Ahmedabad', 'Bhubaneswar', 'Visakhapatnam']));
    expect(places.filter((p) => p === 'Mumbai')).toHaveLength(2); // rain story + Bombay High Court
    expect(features.every((f) => f.props.url.startsWith('https://'))).toBe(true);
    expect(ttl(features[0]!)).toBeLessThanOrEqual(6 * 3600);
  });

  it('geocodes from the summary when the headline names no place', () => {
    const { features, unmatched } = geocode(
      [{ url: 'https://x.in/1', title: 'Farmers protest new rules', published: 0, source: 'x.in', summary: 'Protests in Ludhiana' }],
      gazetteer,
    );
    expect(unmatched).toBe(0);
    expect(features[0]!.props.place).toBe('Ludhiana');
  });
});
