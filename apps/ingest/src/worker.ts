import type { LayerId } from '@ind-intg/shared';
import { backoffMs } from './backoff.js';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

/** A polling worker: fetch -> filter to INDIA_BBOX -> normalise -> store + publish happens inside tick(). */
export interface Worker {
  layer: LayerId;
  intervalMs: number;
  requiredEnv?: readonly string[];
  tick(): Promise<void>;
}

export interface WorkerStatus {
  layer: LayerId;
  lastSuccess: number | null;
  errorCount: number;
  consecutiveErrors: number;
  skipped?: string;
}

/**
 * Runs a worker forever. Never throws: errors are logged and retried with exponential backoff,
 * so one failing source cannot affect the others. Returns a stop function.
 */
export function runWorker(
  worker: Worker,
  log: Logger,
  env: NodeJS.ProcessEnv = process.env,
  status: WorkerStatus = { layer: worker.layer, lastSuccess: null, errorCount: 0, consecutiveErrors: 0 },
): { stop: () => void; status: WorkerStatus } {
  const missing = (worker.requiredEnv ?? []).filter((k) => !env[k]);
  if (missing.length) {
    status.skipped = `missing env: ${missing.join(', ')}`;
    log.warn({ layer: worker.layer, missing }, `worker ${worker.layer} skipped: missing ${missing.join(', ')}`);
    return { stop: () => {}, status };
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const loop = async () => {
    if (stopped) return;
    let delay = worker.intervalMs;
    try {
      await worker.tick();
      status.lastSuccess = Date.now();
      status.consecutiveErrors = 0;
    } catch (err) {
      status.errorCount++;
      status.consecutiveErrors++;
      delay = Math.max(worker.intervalMs, backoffMs(status.consecutiveErrors));
      log.error({ layer: worker.layer, err, retryInMs: delay }, `worker ${worker.layer} failed`);
    }
    if (!stopped) timer = setTimeout(loop, delay);
  };
  void loop();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    status,
  };
}
