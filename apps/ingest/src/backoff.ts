/** Exponential backoff with full jitter, capped. attempt starts at 1. */
export function backoffMs(attempt: number, baseMs = 1_000, maxMs = 5 * 60_000, rand = Math.random): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + rand() * (exp / 2));
}
