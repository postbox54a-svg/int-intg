import { channelFor, featureKey, type Feature, type LayerDelta, type LayerId } from '@ind-intg/shared';
import type { Redis } from 'ioredis';

const indexKey = (layer: LayerId) => `idx:${layer}`;

/** Seconds; or per feature (e.g. alerts that expire at their own time). */
export type Ttl = number | ((f: Feature) => number);

/**
 * Features live in Redis as one key per feature (`feat:<layer>:<id>`, with TTL) plus a per-layer id set.
 * Workers write here; every change is published on the layer channel for the gateway.
 */
export class FeatureStore {
  constructor(private redis: Redis) {}

  /** All live features of a layer. Ids whose key has expired are pruned from the index. */
  async snapshot(layer: LayerId): Promise<Feature[]> {
    return (await this.load(layer)).features;
  }

  private async load(layer: LayerId): Promise<{ features: Feature[]; expired: string[] }> {
    const ids = await this.redis.smembers(indexKey(layer));
    if (!ids.length) return { features: [], expired: [] };
    const values = await this.redis.mget(...ids.map((id) => featureKey(layer, id)));
    const expired = ids.filter((_, i) => values[i] == null);
    if (expired.length) await this.redis.srem(indexKey(layer), ...expired);
    return { features: values.filter((v): v is string => v != null).map((v) => JSON.parse(v) as Feature), expired };
  }

  /**
   * Adds or refreshes features without removing absent ones: for sources where a missed poll should not drop a
   * feature (flights). Features expire through their TTL; expired ids are published as a `remove` delta.
   */
  async merge(layer: LayerId, features: Feature[], ttlSeconds: Ttl): Promise<{ upserted: number; removed: number }> {
    const { features: current, expired } = await this.load(layer);
    const previous = new Map(current.map((f) => [f.id, JSON.stringify(f)]));
    const changed = await this.write(layer, features, previous, ttlSeconds);
    const seen = new Set(features.map((f) => f.id));
    if (seen.size) await this.redis.sadd(indexKey(layer), ...seen);
    const removed = expired.filter((id) => !seen.has(id));
    if (changed.length) await this.publish({ type: 'upsert', layer, features: changed });
    if (removed.length) await this.publish({ type: 'remove', layer, ids: removed });
    return { upserted: changed.length, removed: removed.length };
  }

  /**
   * Replaces a layer with the latest full result of a polled source: refreshes TTLs, publishes an `upsert`
   * delta with new or changed features and a `remove` delta with features no longer in the source.
   */
  async sync(layer: LayerId, features: Feature[], ttlSeconds: Ttl): Promise<{ upserted: number; removed: number }> {
    const previous = new Map((await this.snapshot(layer)).map((f) => [f.id, JSON.stringify(f)]));
    const changed = await this.write(layer, features, previous, ttlSeconds);
    const next = new Set(features.map((f) => f.id));
    if (next.size) await this.redis.sadd(indexKey(layer), ...next);
    const removed = [...previous.keys()].filter((id) => !next.has(id));
    if (removed.length) {
      await this.redis.del(...removed.map((id) => featureKey(layer, id)));
      await this.redis.srem(indexKey(layer), ...removed);
    }
    if (changed.length) await this.publish({ type: 'upsert', layer, features: changed });
    if (removed.length) await this.publish({ type: 'remove', layer, ids: removed });
    return { upserted: changed.length, removed: removed.length };
  }

  /** Writes every feature (refreshing its TTL) and returns those that differ from `previous`. */
  private async write(layer: LayerId, features: Feature[], previous: Map<string, string>, ttlSeconds: Ttl) {
    const changed: Feature[] = [];
    // Issued together so ioredis pipelines them on the one connection.
    await Promise.all(
      features.map((f) => {
        const json = JSON.stringify(f);
        if (previous.get(f.id) !== json) changed.push(f);
        const ttl = typeof ttlSeconds === 'number' ? ttlSeconds : ttlSeconds(f);
        return this.redis.set(featureKey(layer, f.id), json, 'EX', Math.max(1, Math.round(ttl)));
      }),
    );
    return changed;
  }

  private async publish(delta: LayerDelta) {
    await this.redis.publish(channelFor(delta.layer), JSON.stringify(delta));
  }
}
