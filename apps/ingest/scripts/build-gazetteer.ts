/**
 * Builds apps/ingest/data/gazetteer-in.json from the GeoNames India dump.
 *
 *   curl -LO https://download.geonames.org/export/dump/IN.zip && unzip IN.zip IN.txt
 *   pnpm --filter @ind-intg/ingest build:gazetteer /path/to/IN.txt
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GAZETTEER_FILE, buildFromGeoNames } from '../workers/news/gazetteer.js';

const input = process.argv[2];
if (!input) {
  console.error('usage: build-gazetteer <path to GeoNames IN.txt>');
  process.exit(1);
}
const file = buildFromGeoNames(readFileSync(input, 'utf8'));
writeFileSync(GAZETTEER_FILE, JSON.stringify(file));
console.log(`wrote ${file.places.length} places to ${GAZETTEER_FILE.pathname}`);
