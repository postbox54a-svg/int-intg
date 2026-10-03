import type { FeatureStore } from '../src/store.js';
import type { Logger, Worker } from '../src/worker.js';
import { createAlertsWorker } from './alerts.js';
import { createFlightsWorker } from './flights.js';
import { createQuakesWorker } from './quakes.js';

/** One worker module per source lives in this folder; register them here as phases land. */
export function createWorkers(store: FeatureStore, log: Logger): Worker[] {
  return [createQuakesWorker(store, log), createFlightsWorker(store, log), createAlertsWorker(store, log)];
}
