import { getLayer } from '@ind-intg/shared';
import { backoffMs } from '../src/backoff.js';
import type { FeatureStore } from '../src/store.js';
import type { Logger, Worker } from '../src/worker.js';
import { ADSBLOL_BASE_URL, adsbLolProvider } from './flights/adsblol.js';
import { HttpError, type Aircraft, type FlightProvider } from './flights/aircraft.js';
import { openSkyProvider } from './flights/opensky.js';

/**
 * Tries providers in order, skipping any that is cooling down after a 429 (honouring Retry-After when sent,
 * exponential backoff otherwise). Throws only when every provider fails or is cooling down.
 */
export class FlightSource {
  private cooldown = new Map<string, { until: number; strikes: number }>();

  constructor(
    private providers: FlightProvider[],
    private log: Logger,
    private now = () => Date.now(),
  ) {}

  async fetch(): Promise<{ provider: string; aircraft: Aircraft[] }> {
    const errors: string[] = [];
    for (const p of this.providers) {
      const cd = this.cooldown.get(p.name);
      if (cd && cd.until > this.now()) {
        errors.push(`${p.name}: rate limited for ${Math.ceil((cd.until - this.now()) / 1000)} s`);
        continue;
      }
      try {
        const aircraft = await p.fetch();
        this.cooldown.delete(p.name);
        return { provider: p.name, aircraft };
      } catch (err) {
        if (err instanceof HttpError && err.status === 429) {
          const strikes = (cd?.strikes ?? 0) + 1;
          const wait = err.retryAfterMs ?? backoffMs(strikes, 10_000);
          this.cooldown.set(p.name, { until: this.now() + wait, strikes });
          this.log.warn({ layer: 'flights', provider: p.name, waitMs: wait }, `${p.name} rate limited; backing off`);
        } else {
          this.log.warn({ layer: 'flights', provider: p.name, err: String(err) }, `${p.name} failed; trying next provider`);
        }
        errors.push(`${p.name}: ${String(err)}`);
      }
    }
    throw new Error(`all flight providers failed (${errors.join('; ')})`);
  }
}

export function createFlightsWorker(store: FeatureStore, log: Logger, env: NodeJS.ProcessEnv = process.env): Worker {
  const providers: FlightProvider[] = [adsbLolProvider(env.ADSBLOL_BASE_URL || ADSBLOL_BASE_URL)];
  if (env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET) {
    providers.push(
      openSkyProvider({ clientId: env.OPENSKY_CLIENT_ID, clientSecret: env.OPENSKY_CLIENT_SECRET, apiUrl: env.OPENSKY_API_URL || undefined }),
    );
  } else {
    log.info({ layer: 'flights' }, 'OpenSky fallback disabled: OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET not set');
  }
  const source = new FlightSource(providers, log);
  const { ttlSeconds } = getLayer('flights')!;
  return {
    layer: 'flights',
    intervalMs: 10_000,
    async tick() {
      const { provider, aircraft } = await source.fetch();
      // Aircraft missing from one poll are kept until their 60 s TTL runs out.
      const { upserted, removed } = await store.merge('flights', aircraft, ttlSeconds);
      log.info({ layer: 'flights', provider, total: aircraft.length, upserted, removed }, 'flights synced');
    },
  };
}
