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

Scenario files go in `simulated/<location>/`, one file per water level, for example `flood_plus_2m.geojson`, with a `rise_m` property on each feature. `scripts/build_flood_scenarios.py` writes them for every location. Never enter a number without a real source.

Census villages go in `reference/<location>/villages.geojson`. `scripts/fetch_villages.py <location>` creates the file using Bhuvan's village lookup, and needs `BHUVAN_VILLAGE_TOKEN` in `backend/.env`. Keep that key out of Git and out of frontend code.
