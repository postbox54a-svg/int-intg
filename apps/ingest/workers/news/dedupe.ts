/** Same story, different URL: drop tracking params, fragments, www, AMP paths and trailing slashes. */
export function normaliseUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    const path = u.pathname.replace(/\/amp(\/|$)/, '/').replace(/\.amp$/, '').replace(/\/+$/, '');
    const query = u.searchParams.toString();
    return `${u.hostname.replace(/^(www|m|amp)\./, '')}${path}${query ? `?${query}` : ''}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const STOP = new Set(
  'a an and are as at be by for from has have in into is it its of on or over says said the to was were will with after amid new news live updates india indian'.split(' '),
);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

/** Jaccard similarity of title token sets. */
export function titleSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

export const SIMILAR_TITLE = 0.6;

/**
 * Keeps the first of each story: an item is a duplicate if its normalised URL was seen, or its title is at
 * least SIMILAR_TITLE similar to a kept title. `seen` (e.g. stories already on the map) are never returned.
 */
export function dedupe<T extends { url: string; title: string }>(items: T[], seen: { url: string; title: string }[] = []): T[] {
  const urls = new Set(seen.map((s) => normaliseUrl(s.url)));
  const titles = seen.map((s) => titleTokens(s.title));
  const out: T[] = [];
  for (const item of items) {
    const u = normaliseUrl(item.url);
    const t = titleTokens(item.title);
    if (urls.has(u) || titles.some((k) => titleSimilarity(k, t) >= SIMILAR_TITLE)) continue;
    urls.add(u);
    titles.push(t);
    out.push(item);
  }
  return out;
}
