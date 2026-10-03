import { XMLParser } from 'fast-xml-parser';
import { loadText } from '../../src/source.js';

export interface Article {
  url: string;
  title: string;
  /** Epoch ms. */
  published: number;
  /** Publisher domain or feed name. */
  source: string;
  summary: string | null;
}

export const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
/** English-language articles from Indian outlets in the last hour. */
export const GDELT_DEFAULT_QUERY = 'sourcecountry:IN sourcelang:english';

const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const isHttp = (url: string) => /^https?:\/\//i.test(url);
const stripTags = (s: string) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function gdeltUrl(query = GDELT_DEFAULT_QUERY, base = GDELT_DOC_URL): string {
  if (base.startsWith('file:')) return base;
  const q = new URLSearchParams({ query, mode: 'artlist', format: 'json', maxrecords: '250', timespan: '1h', sort: 'datedesc' });
  return `${base}?${q}`;
}

/** GDELT DOC 2.0 artlist JSON. `seendate` is "YYYYMMDDTHHMMSSZ" (UTC). */
export function parseGdelt(json: unknown): Article[] {
  const articles = (json as { articles?: unknown })?.articles;
  if (articles === undefined) return []; // GDELT returns {} when nothing matched
  if (!Array.isArray(articles)) throw new Error('GDELT response has no articles array');
  return articles.flatMap((a: Record<string, unknown>) => {
    const url = typeof a.url === 'string' ? a.url : '';
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    const m = typeof a.seendate === 'string' ? a.seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/) : null;
    if (!isHttp(url) || !title || !m) return [];
    const published = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!);
    return [{ url, title, published, source: typeof a.domain === 'string' ? a.domain : domain(url), summary: null }];
  });
}

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true, isArray: (n) => n === 'item' || n === 'entry' || n === 'link' });

const str = (v: unknown): string | null => {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object' && '#text' in v) return str((v as { '#text': unknown })['#text']);
  return null;
};

/** RSS `<link>url</link>`, or Atom `<link href rel="alternate">`. */
function linkOf(l: unknown): string | null {
  if (typeof l === 'string') return l.trim();
  if (l && typeof l === 'object') {
    const { href, rel } = l as { href?: unknown; rel?: unknown };
    if (typeof href === 'string' && (rel === undefined || rel === 'alternate')) return href;
    return str(l);
  }
  return null;
}

/** RSS 2.0 or Atom feed -> articles. Items without an http(s) link, title or parseable date are skipped. */
export function parseFeed(text: string, feedUrl: string): Article[] {
  const doc = xml.parse(text) as { rss?: { channel?: { title?: unknown; item?: Record<string, unknown>[] } }; feed?: { title?: unknown; entry?: Record<string, unknown>[] } };
  const rssItems = doc.rss?.channel?.item;
  const atomEntries = doc.feed?.entry;
  if (!rssItems && !atomEntries) throw new Error(`${feedUrl}: not an RSS or Atom feed`);
  const source = domain(feedUrl) || str(doc.rss?.channel?.title ?? doc.feed?.title) || 'rss';
  return (rssItems ?? atomEntries ?? []).flatMap((i) => {
    const url = ((i.link as unknown[] | undefined) ?? []).map(linkOf).find((u): u is string => !!u && isHttp(u)) ?? '';
    const title = str(i.title);
    const published = Date.parse(str(i.pubDate) ?? str(i.published) ?? str(i.updated) ?? str(i.date) ?? '');
    if (!url || !title || !Number.isFinite(published)) return [];
    const summary = str(i.description) ?? str(i.summary);
    return [{ url, title: stripTags(title), published, source: domain(url) || source, summary: summary ? stripTags(summary).slice(0, 400) : null }];
  });
}

export async function fetchGdelt(query: string, base: string): Promise<Article[]> {
  return parseGdelt(JSON.parse(await loadText(gdeltUrl(query, base), 20_000, 'application/json')));
}

export async function fetchFeed(url: string): Promise<Article[]> {
  return parseFeed(await loadText(url, 15_000, 'application/rss+xml, application/atom+xml, application/xml'), url);
}
