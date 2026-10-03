import type { Worker } from '../src/worker.js';

/** One worker module per source lives in this folder; register them here as phases land. */
export function createWorkers(): Worker[] {
  return [];
}
