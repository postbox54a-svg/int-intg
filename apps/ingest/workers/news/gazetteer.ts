import { existsSync, readFileSync } from 'node:fs';

/** [name, lat, lon, population, admin1 (state) name or code, alternate names] */
export type PlaceRow = [string, number, number, number, string, string[]];

export interface GazetteerFile {
  source: string;
  places: PlaceRow[];
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
  population: number;
  admin1: string;
}

/** Built from GeoNames IN.txt by `pnpm --filter @ind-intg/ingest build:gazetteer <IN.txt>`; commit the result. */
export const GAZETTEER_FILE = new URL('../../data/gazetteer-in.json', import.meta.url);
/** Hand-made sample (about 50 large cities) used when the GeoNames build is missing. */
export const SAMPLE_GAZETTEER_FILE = new URL('../../../../fixtures/gazetteer-in.sample.json', import.meta.url);

/** Place names that are also everyday English words in headlines; never matched. */
const STOP_NAMES = new Set(['deal', 'bar', 'mango', 'kaman', 'raja', 'gola']);
const MIN_NAME_LENGTH = 4;
const MAX_WORDS = 3;

const key = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Finds the Indian place a headline is about: the earliest capitalised 1–3 word phrase that names a place,
 * longest phrase first ("New Delhi" before "Delhi"), largest population on ties. Unmatched text returns null.
 */
export class Gazetteer {
  private byName = new Map<string, Place[]>();

  constructor(
    file: GazetteerFile,
    readonly source = file.source,
  ) {
    for (const [name, lat, lon, population, admin1, alts] of file.places) {
      const place = { name, lat, lon, population, admin1 };
      for (const n of new Set([name, ...alts].map(key))) {
        if (n.length < MIN_NAME_LENGTH || STOP_NAMES.has(n)) continue;
        this.byName.set(n, [...(this.byName.get(n) ?? []), place]);
      }
    }
  }

  get size() {
    return this.byName.size;
  }

  static load(log?: { warn(o: unknown, m?: string): void }): Gazetteer {
    if (existsSync(GAZETTEER_FILE)) return new Gazetteer(JSON.parse(readFileSync(GAZETTEER_FILE, 'utf8')));
    log?.warn({ layer: 'news' }, 'GeoNames gazetteer not built; using the small sample gazetteer (see apps/ingest/scripts)');
    return new Gazetteer(JSON.parse(readFileSync(SAMPLE_GAZETTEER_FILE, 'utf8')));
  }

  match(text: string): Place | null {
    const words = text.match(/[A-Za-z][A-Za-z'’.-]*/g) ?? [];
    for (let i = 0; i < words.length; i++) {
      for (let n = Math.min(MAX_WORDS, words.length - i); n >= 1; n--) {
        const phrase = words.slice(i, i + n);
        // Proper nouns only: every word capitalised.
        if (!phrase.every((w) => /^[A-Z]/.test(w))) continue;
        const hits = this.byName.get(key(phrase.join(' ')));
        if (hits?.length) return hits.reduce((a, b) => (b.population > a.population ? b : a));
      }
    }
    return null;
  }
}

/**
 * GeoNames country dump (IN.txt, tab-separated) -> gazetteer rows: populated places (feature class P)
 * with population above `minPopulation`; ASCII alternate names only.
 */
export function buildFromGeoNames(tsv: string, minPopulation = 50_000): GazetteerFile {
  const places: PlaceRow[] = [];
  for (const line of tsv.split('\n')) {
    const c = line.split('\t');
    if (c.length < 15 || c[6] !== 'P') continue;
    const population = Number(c[14]);
    if (!(population > minPopulation)) continue;
    const alts = (c[3] ?? '')
      .split(',')
      .filter((a) => /^[A-Za-z][A-Za-z .'-]+$/.test(a) && a !== c[2])
      .slice(0, 20);
    places.push([c[2] || c[1]!, Number(c[4]), Number(c[5]), population, c[10] ?? '', alts]);
  }
  return { source: `GeoNames IN.txt (CC BY 4.0), populated places > ${minPopulation}`, places };
}
