import websocket from '@fastify/websocket';
import { LAYERS, type LayerDelta } from '@ind-intg/shared';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { createWorkers } from '../workers/index.js';
import { Gateway } from './gateway.js';
import { FeatureStore } from './store.js';
import { runWorker, type WorkerStatus } from './worker.js';

const port = Number(process.env.INGEST_PORT ?? 8787);
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});
let redisDown = false;
redis.on('error', (err: NodeJS.ErrnoException) => {
  if (redisDown) return;
  redisDown = true;
  app.log.warn({ code: err.code, err: err.message }, 'redis unavailable; retrying in background');
});
redis.on('ready', () => {
  redisDown = false;
  app.log.info('redis connected');
});

const store = new FeatureStore(redis);
const gateway = new Gateway((layer) => store.snapshot(layer), app.log);
const statuses: WorkerStatus[] = [];

// Deltas from every worker reach the gateway through Redis pub/sub on the layer:* channels.
// No per-request retry limit: the subscription waits for Redis and ioredis re-subscribes after reconnects.
const subscriber = redis.duplicate({ maxRetriesPerRequest: null });
subscriber.on('error', () => {}); // reported once by the main connection's handler
subscriber.on('pmessage', (_pattern, _channel, message) => {
  try {
    gateway.broadcast(JSON.parse(message) as LayerDelta);
  } catch (err) {
    app.log.warn({ err }, 'bad delta on layer channel');
  }
});

await app.register(websocket);

app.get('/health', async () => ({ ok: true, redis: redis.status, ts: Date.now() }));
app.get('/api/layers', async () => LAYERS);
app.get('/api/status', async () => statuses);

app.get('/ws', { websocket: true }, (socket) => {
  const client = { send: (data: string) => socket.readyState === socket.OPEN && socket.send(data) };
  gateway.add(client);
  socket.on('message', (raw: Buffer) => void gateway.handle(client, raw.toString()));
  socket.on('close', () => gateway.remove(client));
});

try {
  await redis.connect();
} catch {
  // Logged by the 'error' handler; ioredis keeps reconnecting.
}

void subscriber.psubscribe('layer:*');

for (const worker of createWorkers(store, app.log)) {
  statuses.push(runWorker(worker, app.log).status);
}

await app.listen({ port, host: '0.0.0.0' });
