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
- [x] **Phase 2 – Earthquakes + gateway** (`phase-2-earthquakes`): workers/quakes.ts polls USGS GeoJSON every 60 s →
  INDIA_BBOX → Feature → Redis (TTL) + publish `quakes`. WebSocket gateway (snapshot on subscribe, then deltas,
  per-layer subscriptions). Web: circles sized by magnitude, popup (place, mag, depth, IST time). Fixture test.
- [x] **Phase 3 – Flights** (`phase-3-flights`): workers/flights.ts, adsb.lol primary, OpenSky (OAuth2 client
  credentials) fallback behind one interface; poll 10 s, INDIA_BBOX, expire 60 s, backoff on 429; filter military
  (no callsign / known military hex ranges). deck.gl IconLayer rotated by heading, interpolated; popup (callsign,
  altitude, speed, squawk).
- [x] **Phase 4 – Alerts** (`phase-4-alerts`): workers/alerts.ts, NDMA SACHET RSS every 5 min → CAP 1.2 XML (event,
  severity, area polygon/district, sender, expiry). Filled polygons by severity; district-only alerts joined to
  datameet districts GeoJSON. Drop expired.
- [x] **Phase 5 – News** (`phase-5-news`): workers/news.ts, GDELT DOC 2.0 artlist + configurable Indian RSS feeds;
  geocode with GeoNames India gazetteer (pop > 50k), drop unmatched; dedupe by URL + title similarity. Clustered
  pins + viewport-filtered live feed panel.
- [x] **Phase 6 – Ships** (`phase-6-ships`): workers/ships.ts, one persistent AISStream WebSocket (subscribe within
  3 s, read continuously), PositionReport + ShipStaticData merged by MMSI, expire 15 min, reconnect with backoff,
  drop ship type 35. Colour by type; label JNPT, Mundra, Chennai, Visakhapatnam, Kochi, Kolkata.
- [ ] **Phase 7 – Polish** (`phase-7-polish`): URL layer state, search (cities, callsigns), PostGIS history + 24 h
  timeline scrubber, Hindi i18n, mobile layout, /status page (last success, error count per worker), SOURCES.md.
- [ ] **Phase 8 – Deploy** (`phase-8-deploy`): production compose (ingest, redis, postgis, Caddy auto-HTTPS),
  /health, GitHub Actions deploy (web → Cloudflare Pages, ingest → VPS over SSH). Target 2 vCPU / 4 GB, Mumbai or
  Bengaluru.

## Next step
Phase 7 – Polish, on branch `phase-7-polish`.

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
- Phase 2: workers/quakes.ts polls `USGS_FEED_URL` (default: the USGS `2.5_week` feed, so it matches the 7-day TTL)
  every 60 s. `FeatureStore.sync` stores each feature as `feat:<layer>:<id>` with a TTL, plus an `idx:<layer>` id set.
  It publishes `upsert` (new or changed features) and `remove` deltas on `layer:<id>`. The gateway (`src/gateway.ts`)
  psubscribes to `layer:*`. It sends `hello` on connect and a snapshot on subscribe. Deltas that arrive while a
  snapshot is loading are queued and sent after it. The protocol types live in packages/shared/src/protocol.ts.
  The web client (`src/live.ts`) subscribes only to enabled layers, reconnects with backoff, and batches renders
  per animation frame. Data layers render below the SOI line.
- Phase 2 was **not verified with real data**: earthquake.usgs.gov is blocked in the cloud. Against the real URL the
  worker logs the 403 and backs off. The screenshot uses `fixtures/usgs-quakes.synthetic.geojson` (invented events)
  via a `file://` USGS_FEED_URL. To check with real data, run `pnpm dev` locally without USGS_FEED_URL.
- Phase 3: `workers/flights.ts` has a `FlightSource` that tries providers in order (adsb.lol, then OpenSky if
  OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET are set). A provider that returns 429 cools down (Retry-After, otherwise
  exponential backoff) while the next one serves. adsb.lol is queried at 250 NM points on a grid covering INDIA_BBOX
  (`coverGrid`: 34 requests per 10 s poll, 4 at a time, merged by hex). If adsb.lol rate-limits that in production,
  lengthen the poll or drop sea-only cells. `FeatureStore.merge` keeps aircraft that are missing from one poll until
  their 60 s TTL ends, then publishes a remove. Military filter: no or blank callsign, `dbFlags` bit 0, or a known
  military hex block (`MILITARY_HEX_RANGES`). The hex list is partial: India's military block is not published.
- Phase 3 web: a deck.gl IconLayer in MapboxOverlay (interleaved), rotated by track. Positions are dead-reckoned from
  the last report (capped at 30 s) and redrawn every 100 ms. Emergency squawks are red and grounded aircraft grey.
  The overlay is recreated when the projection changes, and the layer uses `cullMode: 'none'`; without these the
  icons don't render on the globe.
- Phase 3 was **not verified with real data**: api.adsb.lol, opensky-network.org and auth.opensky-network.org are
  blocked in the cloud. Against the real URL, adsb.lol failed, the OpenSky fixture served as the fallback, and
  10 aircraft were synced. The screenshot uses the adsb.lol fixture.
- Phase 4: `workers/alerts.ts` reads the SACHET RSS feed every 5 min and fetches each linked CAP 1.2 message once,
  caching it while it stays in the feed. It uses the English info block when there is one. Polygons and circles
  become the area. Areas without geometry are joined by name to `apps/ingest/data/districts-2011.geojson`
  (datameet `website/docs/data/geojson/dists11.geojson`, Census 2011, simplified with mapshaper `-simplify 2% keep-shapes`,
  450 KB). A district name shared by two states is used only when a state is named in the area or headline.
  Districts created after 2011 stay unmatched (logged). Dropped: expired, non-Actual, Cancel, and alerts superseded
  through CAP `references`. The area travels in `props.geometry` (MultiPolygon); `lat`/`lon` is its bbox centre,
  which is what INDIA_BBOX filters on. Per-feature TTL: until `expires`, capped at the layer's 24 h.
  `FeatureStore.sync`/`merge` now take a TTL function.
- Phase 4 web: fills and outlines coloured by severity (Extreme > Severe > Moderate > Minor; sort key puts the most
  severe on top), drawn under quake circles and the SOI line. Popup: event, severity, area, sender, IST validity,
  headline, advice, and whether the map area is the district boundaries.
- Phase 4 was **not verified with real data**: sachet.ndma.gov.in is blocked in the cloud (403, worker backs off
  5 min). The real SACHET RSS and CAP layout (link format, areaDesc wording, geocodes) has not been seen. Check
  `parseRss` and the district matching against a live feed first, before relying on this layer.
- Phase 5: `workers/news.ts` runs every 5 min. It fetches GDELT DOC 2.0 artlist (`GDELT_QUERY`, last 1 h) and the
  `NEWS_RSS_FEEDS` (RSS 2.0 or Atom) with allSettled, so it fails only if every source fails. Articles older than 6 h
  are dropped. Dedupe compares normalised URLs (no utm/fbclid, www/m/amp, trailing slash) and title token Jaccard
  >= 0.6, against both this batch and the stories already on the map. Geocoding uses the gazetteer: the earliest
  capitalised 1–3 word phrase in the headline (then the summary), longest name first, largest population on ties.
  Unmatched stories are dropped. TTL is 6 h from publication; `merge` keeps stories between polls.
- **Gazetteer TODO:** `apps/ingest/data/gazetteer-in.json` has not been built yet, because download.geonames.org is
  blocked in the cloud. Until it is, the worker logs a warning and uses `fixtures/gazetteer-in.sample.json` (56 cities,
  hand-made). To build it: download IN.zip from GeoNames, unzip IN.txt, then run
  `pnpm --filter @ind-intg/ingest build:gazetteer IN.txt` (populated places > 50k, ASCII alternate names).
- Phase 5 web: clustered purple pins (MapLibre cluster; count labels only when the style has glyphs; clicking a cluster
  zooms in). The "News in view" panel lists the stories inside the current map bounds, newest first (top 50), with
  https-only links. The disclaimer moved up so it no longer overlaps the attribution.
- Phase 5 was **not verified with real data**: api.gdeltproject.org, download.geonames.org and the news sites are
  blocked in the cloud. The default RSS feed URLs (The Hindu, Indian Express, Hindustan Times) are unverified.
- Mobile (390 px): the layer panel, clock and news panel crowd each other. This is left for the Phase 7 mobile layout.
- Phase 6: `workers/ships.ts`. Each `tick()` is one AISStream connection: it sends the subscription on open (the
  4 SEA_BOXES, PositionReport + Class B + ShipStaticData), reads continuously, and flushes changed ships every 5 s
  (`store.merge`, 15 min TTL). The tick resolves after a healthy session (>= 60 s with traffic), so runWorker
  reconnects at once; otherwise it throws and runWorker backs off exponentially. The session also ends on a server
  `{error}` (bad key), when no message arrives for 120 s, and when no connection is made within 10 s. Node's
  WebSocket may never fire `close` after a failed connect, so every exit path ends the session itself.
  `ShipTracker` merges positions and static data by MMSI. Type 35 is dropped, and a ship already shown is removed
  (`store.remove`) when its static data later says 35. AIS "not available" values (SOG 102.3, COG 360,
  heading 511) become null.
- Phase 6 web: circles coloured by category (cargo, tanker, passenger, fishing, tug, high-speed, pleasure, special,
  other), with a legend under Ships in the panel. Popup: name, MMSI, type, speed, course, nav status, destination,
  call sign, last seen in IST. The 6 port labels (JNPT, Mundra, Chennai, Visakhapatnam, Kochi, Kolkata) are HTML
  markers, so they work without basemap glyphs, and show only while Ships is on.
- Phase 6 was **not verified against AISStream**: stream.aisstream.io is blocked in the cloud and no
  AISSTREAM_API_KEY is set. Verified instead against a local mock AISStream WebSocket (scratch script, not
  committed). The mock enforced the 3 s subscription deadline and the key, then replayed the fixture with moving
  ships: 43 ships were stored. A wrong key gave "Api Key Is Not Valid" and backoff. The real host gave a network
  error and backoff.
