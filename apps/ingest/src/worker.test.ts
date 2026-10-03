import { afterEach, describe, expect, it, vi } from 'vitest';
import { backoffMs } from './backoff.js';
import { runWorker, type Logger } from './worker.js';

const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

afterEach(() => {
  vi.useRealTimers();
});

describe('backoffMs', () => {
  it('grows exponentially and is capped', () => {
    const mid = () => 0.5;
    expect(backoffMs(1, 1000, 60_000, mid)).toBe(750);
    expect(backoffMs(3, 1000, 60_000, mid)).toBe(3000);
    expect(backoffMs(20, 1000, 60_000, mid)).toBe(45_000);
  });
});

describe('runWorker', () => {
  it('skips a worker with missing env instead of throwing', () => {
    const tick = vi.fn();
    const { status } = runWorker({ layer: 'ships', intervalMs: 1000, requiredEnv: ['AISSTREAM_API_KEY'], tick }, log, {});
    expect(tick).not.toHaveBeenCalled();
    expect(status.skipped).toMatch(/AISSTREAM_API_KEY/);
  });

  it('keeps running after a failing tick and records errors', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const tick = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
    });
    const { stop, status } = runWorker({ layer: 'quakes', intervalMs: 10, tick }, log, {});
    await vi.advanceTimersByTimeAsync(0);
    expect(status.errorCount).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(status.lastSuccess).not.toBeNull();
    expect(status.consecutiveErrors).toBe(0);
    stop();
  });
});
