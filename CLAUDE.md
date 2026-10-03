# India Pulse (repo: int-intg)
Real-time India-only OSINT map. TypeScript monorepo (pnpm workspaces).

## Rules
- All data is normalised to Feature {id, layer, lat, lon, ts, props} (packages/shared).
- Every worker: fetch -> filter to INDIA_BBOX -> normalise -> Redis set (with TTL) + publish on its layer channel.
- Workers never crash the process: catch, log, exponential backoff. One worker failing must not affect the others.
- API keys live only in apps/ingest env vars. Never in apps/web.
- Gateway: snapshot on subscribe, then deltas; clients subscribe only to the layers they have switched on.
- Map shows the official Survey of India boundary (github.com/datameet/maps) on top; never the basemap's disputed lines.
- Times are shown in IST (Asia/Kolkata).
- Do NOT build: CCTV feeds, military/defence-site layers, military aircraft or warship tracking, network scanning tools.
  Filter out military aircraft (no callsign / known military hex ranges) and AIS ship type 35.

## Commands
- pnpm dev (web + ingest; needs Redis running), pnpm test, pnpm typecheck, pnpm lint

## Cloud sessions
- One phase per session, branch phase-<n>-<name>, PR with screenshot, then stop.
- Start Redis with `service redis-server start`. Keys come from env vars; skip a source if its key is missing.
- Network is allowlisted: on a blocked domain, report it and use fixtures. No workarounds.
- Start every session by reading CLAUDE.md and PLAN.md.

## Done means
CI green, the layer toggles on the map with real data, screenshot in the PR.
