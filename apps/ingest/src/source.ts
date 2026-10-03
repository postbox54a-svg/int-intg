import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * Loads a source as text. `file://` URLs read a local fixture (used when a source's domain is blocked);
 * anything else is fetched with a timeout. Non-2xx responses throw so the worker backs off.
 */
export async function loadText(url: string, timeoutMs = 15_000, accept = '*/*'): Promise<string> {
  if (url.startsWith('file:')) return readFile(fileURLToPath(url), 'utf8');
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

export async function loadJson(url: string, timeoutMs = 15_000): Promise<unknown> {
  return JSON.parse(await loadText(url, timeoutMs, 'application/json'));
}
