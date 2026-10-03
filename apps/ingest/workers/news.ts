import { createHash } from 'node:crypto';
import { getLayer, inBBox, type Feature } from '@ind-intg/shared';
import type { FeatureStore } from '../src/store.js';
import type { Logger, Worker } from '../src/worker.js';
import { dedupe, normaliseUrl } from './news/dedupe.js';
import { Gazetteer } from './news/gazetteer.js';
import { GDELT_DEFAULT_QUERY, GDELT_DOC_URL, fetchFeed, fetchGdelt, type Article } from './news/sources.js';

/** Default Indian RSS feeds; override with NEWS_RSS_FEEDS (comma-separated). Not reachable from the cloud sandbox. */
export const DEFAULT_RSS_FEEDS = [
  'https://www.thehindu.com/news/national/feeder/default.rss',
  'https://indianexpress.com/section/india/feed/',
  'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml',
];

export interface NewsProps extends Record<string, unknown> {
  title: string;
  url: string;
  source: string;
  place: string;
  admin1: string;
  summary: string | null;
}

const idFor = (url: string) => createHash('sha1').update(normaliseUrl(url)).digest('hex').slice(0, 16);

/** Geocodes articles by headline (then summary); articles naming no known Indian place are dropped. */
export function geocode(articles: Article[], gazetteer: Gazetteer): { features: Feature<NewsProps>[]; unmatched: number } {
  const features: Feature<NewsProps>[] = [];
  let unmatched = 0;
  for (const a of articles) {
    const place = gazetteer.match(a.title) ?? (a.summary ? gazetteer.match(a.summary) : null);
    if (!place || !inBBox(place.lat, place.lon)) {
      unmatched++;
      continue;
    }
    features.push({
      id: idFor(a.url),
      layer: 'news',
      lat: place.lat,
      lon: place.lon,
      ts: a.published,
      props: { title: a.title, url: a.url, source: a.source, place: place.name, admin1: place.admin1, summary: a.summary },
    });
  }
  return { features, unmatched };
}

export function createNewsWorker(
  store: FeatureStore,
  log: Logger,
  env: NodeJS.ProcessEnv = process.env,
  gazetteer = Gazetteer.load(log),
): Worker {
  const { ttlSeconds } = getLayer('news')!;
  const feeds = (env.NEWS_RSS_FEEDS ?? DEFAULT_RSS_FEEDS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const gdeltBase = env.GDELT_DOC_URL || GDELT_DOC_URL;
  const gdeltQuery = env.GDELT_QUERY || GDELT_DEFAULT_QUERY;

  return {
    layer: 'news',
    // GDELT asks for at most one request every 5 s; every 5 min is well inside that.
    intervalMs: 5 * 60_000,
    async tick() {
      const sources = [{ name: 'gdelt', load: () => fetchGdelt(gdeltQuery, gdeltBase) }, ...feeds.map((url) => ({ name: url, load: () => fetchFeed(url) }))];
      const results = await Promise.allSettled(sources.map((s) => s.load()));
      const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${sources[i]!.name}: ${String(r.reason)}`] : []));
      if (failed.length === sources.length) throw new Error(`all news sources failed (${failed.join('; ')})`);
      for (const f of failed) log.warn({ layer: 'news', err: f }, 'news source failed');

      const now = Date.now();
      const maxAgeMs = ttlSeconds * 1000;
      const articles = results
        .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        .filter((a) => a.published > now - maxAgeMs && a.published <= now + 5 * 60_000)
        .sort((a, b) => b.published - a.published);
      // Stories already on the map count as seen, so a re-published story doesn't appear twice.
      const onMap = (await store.snapshot('news')).map((f) => f.props as NewsProps);
      const fresh = dedupe(articles, onMap);
      const { features, unmatched } = geocode(fresh, gazetteer);
      const { upserted, removed } = await store.merge('news', features, (f) => (f.ts + maxAgeMs - now) / 1000);
      log.info(
        { layer: 'news', fetched: articles.length, fresh: fresh.length, geocoded: features.length, unmatched, upserted, removed, failedSources: failed.length },
        'news synced',
      );
    },
  };
}
