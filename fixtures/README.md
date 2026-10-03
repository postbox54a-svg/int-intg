# Fixtures

One sample response per source, in the source's own format. Tests parse these files. When a source's domain is
blocked, point the worker's URL env var at a fixture with a `file://` URL.

| File | Source | Real or synthetic |
| --- | --- | --- |
| `usgs-quakes.synthetic.geojson` | USGS summary GeoJSON feed | **Synthetic.** It follows the USGS schema, but the events are invented, because earthquake.usgs.gov was blocked in the cloud session. It has 12 events inside INDIA_BBOX and 3 outside it (Japan, Chile, Iran). Replace it with a saved real `2.5_week.geojson` once the domain is reachable. |
