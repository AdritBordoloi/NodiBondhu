# Data files

Put GeoJSON files in the folder for their type and location, for example `observed/simaluguri/`. The app loads every `.geojson` file it finds there. Locations are listed in `reference/locations.json`.

| Folder | Use for |
|---|---|
| `observed/<location>/` | Things that were measured: gauge readings, satellite flood extent |
| `forecast/<location>/` | Model predictions of the future: rain, river discharge |
| `simulated/<location>/` | Our what-if flood scenarios |

Every feature must have these properties:

| Property | Meaning |
|---|---|
| `kind` | `observed`, `forecast` or `simulated` |
| `name` | Short label shown in the app |
| `source` | Where the data came from |
| `timestamp` | When it was measured or generated, in ISO format. Use `null` if not known yet |
| `quality` | Plain-language note on uncertainty or reliability |

Other properties, such as `level_m`, are shown in the app automatically.

Scenario files go in `simulated/<location>/`, one file per water level, for example `flood_plus_2m.geojson`, with a `rise_m` property on each feature. `scripts/build_flood_scenarios.py [grid]` writes them for the locations on a model grid. Never enter a number without a real source.

Each location names its model grid in `reference/locations.json`, and the grids are listed in `scripts/pilot_area.py`. Simaluguri and Sivasagar share `upper_assam`, and Karimganj uses `barak_valley`. To add a location on a new grid, add the grid, then run `fetch_dem.py`, `fetch_osm.py` and `build_flood_scenarios.py` with its name.

A location near a border can have a `reference/<location>/boundary.geojson`. Flood areas, settlements, villages and land use are then limited to the land inside it. Karimganj uses this so that land in Bangladesh isn't counted.

Census villages go in `reference/<location>/villages.geojson`. `scripts/fetch_villages.py <location>` creates the file using Bhuvan's village lookup and village geocode, and needs `BHUVAN_VILLAGE_TOKEN` and `BHUVAN_VILLAGE_GEOCODE_TOKEN` in `backend/.env`. A population is only used when a census record of the same name is within 3 km and clearly the closest. Keep these keys out of Git and out of frontend code.

Land use estimates go in `reference/<location>/land_use.json`. `scripts/fetch_land_use.py <location>` creates the file using Bhuvan's land use API, and needs `BHUVAN_LULC_AOI_TOKEN` in `backend/.env`.

Road routes go in `reference/<location>/routes.geojson`. `scripts/fetch_routes.py [location]` creates the file using Bhuvan's shortest path API, and needs `BHUVAN_ROUTING_TOKEN` in `backend/.env` the first time. The routes to check are listed at the top of that script. Run it again after rebuilding flood scenarios.
