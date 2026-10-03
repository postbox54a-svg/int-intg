import websocket from '@fastify/websocket';
import { LAYERS } from '@ind-intg/shared';
import Fastify from 'fastify';
import { Redis } from 'ioredis';
import { createWorkers } from '../workers/index.js';
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

const statuses: WorkerStatus[] = [];

await app.register(websocket);

app.get('/health', async () => ({ ok: true, redis: redis.status, ts: Date.now() }));
app.get('/api/layers', async () => LAYERS);
app.get('/api/status', async () => statuses);

// WebSocket gateway placeholder; snapshot + deltas arrive in Phase 2.
app.get('/ws', { websocket: true }, (socket) => {
  socket.send(JSON.stringify({ type: 'hello', layers: LAYERS.map((l) => l.id) }));
});

try {
  await redis.connect();
} catch {
  // Logged by the 'error' handler; ioredis keeps reconnecting.
}

for (const worker of createWorkers()) {
  statuses.push(runWorker(worker, app.log).status);
}

await app.listen({ port, host: '0.0.0.0' });
