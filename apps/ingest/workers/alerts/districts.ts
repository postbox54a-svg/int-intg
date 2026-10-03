import { readFileSync } from 'node:fs';

type Ring = [number, number][];
/** GeoJSON MultiPolygon coordinates. */
export type MultiPolygonCoords = Ring[][];

interface District {
  name: string;
  state: string;
  key: string;
  stateKey: string;
  coords: MultiPolygonCoords;
}

/** Lowercase letters only, '&' as 'and', so "Andaman & Nicobar" == "andaman and nicobar". */
export const normalise = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');

/** The census file spells some states differently from today's usage; map today's -> file's. */
const STATE_ALIASES: Record<string, string> = {
  arunachalpradesh: 'arunanchalpradesh',
  andamanandnicobarislands: 'andamanandnicobarisland',
  delhi: 'nctofdelhi',
  dadraandnagarhaveli: 'dadaraandnagarhavelli',
  orissa: 'odisha',
  uttaranchal: 'uttarakhand',
  pondicherry: 'puducherry',
};

export const DISTRICTS_FILE = new URL('../../data/districts-2011.geojson', import.meta.url);

/**
 * Census 2011 district polygons (datameet, simplified), for CAP areas that name districts without a polygon.
 * Districts created after 2011 are not in the file and are reported as unmatched.
 */
export class DistrictIndex {
  private byKey = new Map<string, District[]>();
  private stateKeys: string[];

  constructor(geojson: unknown) {
    const features = (geojson as { features: { properties: { DISTRICT: string; ST_NM: string }; geometry: { type: string; coordinates: unknown } }[] }).features;
    for (const f of features) {
      const coords = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as MultiPolygonCoords;
      const d = { name: f.properties.DISTRICT, state: f.properties.ST_NM, key: normalise(f.properties.DISTRICT), stateKey: normalise(f.properties.ST_NM), coords };
      this.byKey.set(d.key, [...(this.byKey.get(d.key) ?? []), d]);
    }
    this.stateKeys = [...new Set([...this.byKey.values()].flat().map((d) => d.stateKey))];
  }

  static load(file: URL = DISTRICTS_FILE) {
    return new DistrictIndex(JSON.parse(readFileSync(file, 'utf8')));
  }

  /** States named anywhere in `text` (normalised substring match, aliases applied). */
  statesIn(text: string): Set<string> {
    const t = normalise(text);
    const found = new Set(this.stateKeys.filter((k) => t.includes(k)));
    for (const [alias, key] of Object.entries(STATE_ALIASES)) if (t.includes(alias)) found.add(key);
    return found;
  }

  /**
   * Resolves an areaDesc such as "Pune, Satara" or "Bilaspur (Chhattisgarh)" to district polygons.
   * A name shared by several states is used only when `context` (area + headline) names one of them.
   */
  match(areaDesc: string, context = ''): { coords: MultiPolygonCoords; matched: string[]; unmatched: string[] } {
    const states = this.statesIn(`${areaDesc} ${context}`);
    const coords: MultiPolygonCoords = [];
    const matched: string[] = [];
    const unmatched: string[] = [];
    for (const raw of areaDesc.split(/[,;]/)) {
      const name = raw.replace(/\(.*?\)/g, '').replace(/\bdistricts?\b/gi, '').trim();
      if (!name) continue;
      let candidates = this.byKey.get(normalise(name)) ?? [];
      if (candidates.length > 1) candidates = candidates.filter((d) => states.has(d.stateKey));
      if (candidates.length === 1) {
        coords.push(...candidates[0]!.coords);
        matched.push(`${candidates[0]!.name}, ${candidates[0]!.state}`);
      } else if (!states.has(normalise(name))) {
        unmatched.push(name); // unknown, post-2011, or ambiguous without a state
      }
    }
    return { coords, matched, unmatched };
  }
}
