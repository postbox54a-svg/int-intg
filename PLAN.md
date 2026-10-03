# India Pulse — Plan

Read CLAUDE.md first. One phase per session, branch `phase-<n>-<short-name>`, PR "Phase <n>: <name>", then stop.
Exit criteria for every phase: `pnpm typecheck`, `pnpm lint`, `pnpm test` pass; PLAN.md ticked; screenshot at
`docs/screenshots/phase-<n>.png` (from Phase 1 on); PR opened.

## Geography
- INDIA_BBOX (mainland + EEZ): lat 5–37 N, lon 66–98 E.
- Ship sea boxes: Arabian Sea, Bay of Bengal, Andaman & Nicobar, Lakshadweep (in packages/shared).

## Phases
- [x] **Phase 0 – Scaffold** (`phase-0-scaffold`): pnpm monorepo (@ind-intg/web, @ind-intg/ingest,
  @ind-intg/shared), shared Feature type + INDIA_BBOX + layer registry, infra/docker-compose.yml (Redis),
  vitest + eslint, root `pnpm dev`, CI workflow, SessionStart hook, .env.example.
- [x] **Phase 1 – Map shell** (`phase-1-map-shell`): full-screen dark MapLibre v5 map (OpenFreeMap), centred on
  India zoom ~4.2, globe/flat toggle; Survey of India boundary (datameet/maps) GeoJSON line layer on top, basemap
  boundaries hidden; collapsible left layer panel from the registry with toggles + live counts; IST clock top-right;
  attribution footer + disclaimer ("Public data, may be delayed or incomplete. Not for navigation or emergency
  use. Emergencies: 112.").
- [ ] **Phase 2 – Earthquakes + gateway** (`phase-2-earthquakes`): workers/quakes.ts polls USGS GeoJSON every 60 s →
  INDIA_BBOX → Feature → Redis (TTL) + publish `quakes`. WebSocket gateway (snapshot on subscribe, then deltas,
  per-layer subscriptions). Web: circles sized by magnitude, popup (place, mag, depth, IST time). Fixture test.
- [ ] **Phase 3 – Flights** (`phase-3-flights`): workers/flights.ts, adsb.lol primary, OpenSky (OAuth2 client
  credentials) fallback behind one interface; poll 10 s, INDIA_BBOX, expire 60 s, backoff on 429; filter military
  (no callsign / known military hex ranges). deck.gl IconLayer rotated by heading, interpolated; popup (callsign,
  altitude, speed, squawk).
- [ ] **Phase 4 – Alerts** (`phase-4-alerts`): workers/alerts.ts, NDMA SACHET RSS every 5 min → CAP 1.2 XML (event,
  severity, area polygon/district, sender, expiry). Filled polygons by severity; district-only alerts joined to
  datameet districts GeoJSON. Drop expired.
- [ ] **Phase 5 – News** (`phase-5-news`): workers/news.ts, GDELT DOC 2.0 artlist + configurable Indian RSS feeds;
  geocode with GeoNames India gazetteer (pop > 50k), drop unmatched; dedupe by URL + title similarity. Clustered
  pins + viewport-filtered live feed panel.
- [ ] **Phase 6 – Ships** (`phase-6-ships`): workers/ships.ts, one persistent AISStream WebSocket (subscribe within
  3 s, read continuously), PositionReport + ShipStaticData merged by MMSI, expire 15 min, reconnect with backoff,
  drop ship type 35. Colour by type; label JNPT, Mundra, Chennai, Visakhapatnam, Kochi, Kolkata.
- [ ] **Phase 7 – Polish** (`phase-7-polish`): URL layer state, search (cities, callsigns), PostGIS history + 24 h
  timeline scrubber, Hindi i18n, mobile layout, /status page (last success, error count per worker), SOURCES.md.
- [ ] **Phase 8 – Deploy** (`phase-8-deploy`): production compose (ingest, redis, postgis, Caddy auto-HTTPS),
  /health, GitHub Actions deploy (web → Cloudflare Pages, ingest → VPS over SSH). Target 2 vCPU / 4 GB, Mumbai or
  Bengaluru.

## Next step
Phase 2 – Earthquakes + gateway, on branch `phase-2-earthquakes`.

## Notes / deviations
- Phase 0 was run in a local Windows session, not the cloud: Redis, Docker and gh were not installed. The
  SessionStart hook works even when the `service` command is missing. Ingest starts without Redis, logs one
  warning and keeps reconnecting.
- Phase 0 was verified in the cloud. The SessionStart hook runs (pnpm install, then Redis up), and `pnpm dev` logs
  "redis connected" with `/health` reporting `redis: ready`. `main` is an empty root commit, and Phase 0 is merged
  in through its PR.
- Cloud network (environment "Default"), 2026-10-03: only raw.githubusercontent.com (datameet) and npm are
  reachable. The proxy blocks these with 403: tiles.openfreemap.org, earthquake.usgs.gov, api.adsb.lol,
  opensky-network.org, auth.opensky-network.org, sachet.ndma.gov.in, api.gdeltproject.org, stream.aisstream.io,
  download.geonames.org. Until they are allowlisted in the environment settings, use fixtures for those
  sources.
- Dependencies are pinned to stable majors (Vite 6, Vitest 2, ESLint 9, React 18). MapLibre v5 and deck.gl
  are added in Phase 1.
- Shared and ingest code run straight from TS source (`tsx`, with Vite resolving the workspace). There is no
  build step for packages/shared.
- Phase 1: the SOI boundary is `apps/web/public/geo/india-soi.geojson`. It comes from datameet `Country/india-soi.geojson`
  (12 MB), simplified to about 210 KB with `npx mapshaper india-soi.geojson -simplify 4% keep-shapes -clean -o precision=0.0001`.
  Basemap layers whose source-layer is `boundary`, or whose id matches boundary/admin, are removed before the style
  is used. If the OpenFreeMap style can't be fetched within 5 s, the map falls back to an offline dark style (India
  filled from the SOI GeoJSON) and shows a note. The Phase 1 screenshot shows this fallback, because the cloud proxy
  blocks tiles.openfreemap.org. Layer counts stay 0 until the Phase 2 gateway fills them. The panel shows worker
  notes (for example a missing key) from `/api/status`.
