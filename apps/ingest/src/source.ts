import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Loads a source as JSON. `file://` URLs read a local fixture (used when a source's domain is blocked);
 * anything else is fetched with a timeout. Non-2xx responses throw so the worker backs off.
 */
export async function loadJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  if (url.startsWith('file:')) return JSON.parse(await readFile(fileURLToPath(url), 'utf8'));
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}
