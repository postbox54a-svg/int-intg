# India Pulse (`int-intg`)

Real-time, India-only open-source intelligence map. See [CLAUDE.md](CLAUDE.md) for rules and [PLAN.md](PLAN.md) for progress.

## Quick start

```bash
pnpm install
cp .env.example .env        # optional keys; missing keys just skip that source
service redis-server start  # or: docker compose -f infra/docker-compose.yml up -d redis
pnpm dev                    # web on :5173, ingest on :8787
```

Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

Layout: `apps/web` (Vite + React + MapLibre), `apps/ingest` (Fastify + WebSocket gateway, workers in `apps/ingest/workers/`), `packages/shared` (Feature type, INDIA_BBOX, layer registry), `fixtures/` (one saved real response per source), `infra/` (production compose).

Public data, may be delayed or incomplete. Not for navigation or emergency use. Emergencies: 112.
