# Data files

Put GeoJSON files in the folder for their type. The app loads every `.geojson` file it finds there.

| Folder | Use for |
|---|---|
| `observed/` | Things that were measured: gauge readings, satellite flood extent |
| `forecast/` | Model predictions of the future: rain, river discharge |
| `simulated/` | Our what-if flood scenarios |

Every feature must have these properties:

| Property | Meaning |
|---|---|
| `kind` | `observed`, `forecast` or `simulated` |
| `name` | Short label shown in the app |
| `source` | Where the data came from |
| `timestamp` | When it was measured or generated, in ISO format. Use `null` if not known yet |
| `quality` | Plain-language note on uncertainty or reliability |

Other properties, such as `level_m`, are shown in the app automatically.

Scenario files go in `simulated/`, one file per water level, for example `flood_plus_2m.geojson`, with a `rise_m` property on each feature. Never enter a number without a real source.
