import { useEffect, useState } from 'react';
import { isLayerId, type LayerId } from '@ind-intg/shared';

/** Mirrors apps/ingest WorkerStatus (GET /api/status). */
export interface WorkerStatus {
  layer: LayerId;
  lastSuccess: number | null;
  errorCount: number;
  consecutiveErrors: number;
  skipped?: string;
}

export function indexStatuses(list: WorkerStatus[]): Partial<Record<LayerId, WorkerStatus>> {
  const out: Partial<Record<LayerId, WorkerStatus>> = {};
  for (const s of list) if (isLayerId(s.layer)) out[s.layer] = s;
  return out;
}

/** Polls /api/status; failures are ignored (ingest may not be running). */
export function useWorkerStatuses(intervalMs = 15_000) {
  const [statuses, setStatuses] = useState<Partial<Record<LayerId, WorkerStatus>>>({});
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok && alive) setStatuses(indexStatuses((await res.json()) as WorkerStatus[]));
      } catch {
        // ingest down: keep the last known statuses
      }
    };
    void poll();
    const t = setInterval(poll, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return statuses;
}
