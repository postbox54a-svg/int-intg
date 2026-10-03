# Fixtures

One sample response per source, in the source's own format. Tests parse these files. When a source's domain is
blocked, point the worker's URL env var at a fixture with a `file://` URL.

| File | Source | Real or synthetic |
| --- | --- | --- |
| `usgs-quakes.synthetic.geojson` | USGS summary GeoJSON feed | **Synthetic.** It follows the USGS schema, but the events are invented, because earthquake.usgs.gov was blocked in the cloud session. It has 12 events inside INDIA_BBOX and 3 outside it (Japan, Chile, Iran). Replace it with a saved real `2.5_week.geojson` once the domain is reachable. |
| `adsblol-flights.synthetic.json` | adsb.lol `/v2/point` (ADSBExchange v2 format) | **Synthetic.** 64 invented aircraft. 58 are civil aircraft over India; 6 must be filtered: no callsign, blank callsign, `dbFlags` military, US military hex block, outside INDIA_BBOX, and one malformed entry. api.adsb.lol is blocked in the cloud. |
| `opensky-states.synthetic.json` | OpenSky `/api/states/all` | **Synthetic.** 13 state vectors (the first 10 adsb.lol aircraft converted to OpenSky units), plus a military hex, a blank callsign and one outside INDIA_BBOX. opensky-network.org is blocked in the cloud. |
