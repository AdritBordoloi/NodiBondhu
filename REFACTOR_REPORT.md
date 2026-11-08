# Refactor report: slimmer, easier-to-extend code

Branch: `refactor/slim-codebase`. Restore point: tag `pre-refactor`, which is commit `c1a0408` on `main`. `main` is not changed.

The goal was to make the code smaller and easier to extend without changing any behaviour. The data scripts in `scripts/` and the data files were not touched.

## How to undo it

The refactor sits on its own branch, so undoing it takes one of these:

- **Go back to the old code:** run `git switch main`. `main` still has the code exactly as it was.
- **Throw the refactor away:** run `git switch main`, then `git branch -D refactor/slim-codebase`.
- **Undo it after it has been merged into `main`:** run `git revert <merge or commit id>`. This keeps history.
- **Compare against the old code at any time:** run `git diff pre-refactor -- backend frontend/src`.

Restart the backend and the frontend after switching branches.

## Size before and after

| Part | Before | After |
|---|---|---|
| Backend API (`main.py`, now 4 files) | 496 lines, 20.6 KB | 548 lines, 21.9 KB |
| Backend AI summary (`ai_summary.py`) | 158 lines | unchanged |
| Frontend code (`App.tsx`, `main.tsx`, now 26 files) | 2,928 lines, 106.6 KB | 2,861 lines, 114.8 KB |
| Largest file (`App.tsx`) | 2,918 lines | 377 lines |
| Stylesheet (`index.css`) | 1,412 lines, 21.4 KB | 1,247 lines, 20.4 KB |
| Built JavaScript bundle | 1,357,035 bytes | 1,353,214 bytes |
| Built CSS bundle | 87,400 bytes | 86,428 bytes |

The code is 4% fewer lines overall, but 3% more bytes. Splitting one large file into focused modules adds import lines and component prop types. That is the cost of being able to find and change one thing without reading 2,900 lines. The real gains are in structure and in duplicate code removed (listed below), not raw size.

## Backend changes (`backend/`)

`main.py` was one file that read data, fetched forecasts, built report facts and served routes. It is now split by job:

| File | What it does |
|---|---|
| `main.py` | The FastAPI app, its routes and the demo alert log |
| `data.py` | Reads saved files: locations, reference layers and official flood reports |
| `forecast.py` | Rain and river flow forecasts from Open-Meteo, saved for offline use |
| `facts.py` | The Situation Report figures the AI summary may use, in Simulated, Observed and Forecast sections |
| `ai_summary.py` | Unchanged |

Duplicate code removed:
- **Reference routes:** six near-identical endpoints (`settlements`, `villages`, `routes`, `land-use`, `model-check`, `flood-reports`) are now one table of route name to reader. Adding a new per-location file is one line.
- **Forecast output:** the two forecast builders shared about 20 lines of output wrapping, which is now `forecast_point()`. The two flood API calls share their common parameters.
- **Rain totals:** the separate rain totals are one `total(start, end)` helper.
- **Forecast list:** the rain and flow file paths and the refresh loop come from one `FORECASTS` table. Adding a forecast is one line.
- **"Floods at this rise" check:** this was written three ways (settlements, villages, the alert). It is now `floods_by()`.
- **Small helpers:** JSON reads go through `read_json()`, and empty layers come from `feature_collection()`.
- **Report facts:** `summary_facts()` was one 80-line function. It is now three short sections, one per kind.

Every URL, parameter, response field and error code is the same.

## Frontend changes (`frontend/src/`)

`App.tsx` held the whole app. It now holds only the app's state and the order of its effects. The rest moved into:

| Folder or file | What it holds |
|---|---|
| `types.ts`, `constants.ts` | Shared types and settings |
| `format.ts`, `analysis.ts` | Pure helpers for formatting and flood, route and report calculations |
| `api.ts` | Every fetch call |
| `map/config.ts` | Layer ids, zoom levels, colours and filters |
| `map/setup.ts` | Creating the map, the locate button, and map clicks |
| `map/layers.ts` | The map's layers as one ordered list, and how data and view settings are applied |
| `map/camera.ts` | Region camera, map lock, flights and report capture |
| `components/` | One file per screen part: top bar, controls, map panel, legend, charts, report sections, timeline, Data Sources, Alert Log, Situation Report, AI summary |

Duplicate code removed:
- **Fetches:** seven repeated `fetch(...).catch(...)` blocks are now one `get`/`optional` pair.
- **Map layers:** about 20 layer definitions that differed by a few values now use small helpers (circle points, labels, route lines).
- **Tables:** 12 copies of the same table markup are one `Table` component.
- **Panels and headings:** 5 Data Sources panels and 7 swatch headings are now shared components.
- **Repeated blocks:** census columns, rain readings, timeline charts and route-matrix rows are now lists drawn from data.
- **Helpers:** `isFloodedAt`, route names, peak days and focus status were each written more than once and now live in one helper.
- **Empty data:** missing data now falls back to one `EMPTY_DATA` object instead of seven separate defaults.

### Stylesheet (`index.css`)

- **Merged overrides:** the later "polish" override blocks are folded into the original rules, with the final value of each property kept.
- **Removed rules:** three rules that never changed anything are gone (`.segment + .segment` twice, and a hover rule that was always overridden).
- **Merged media blocks:** the two `max-width: 600px` blocks are now one.
- **New variables:** `--surface`, `--track`, `--highlight` and `--radius-sm` replace repeated colours and radii.
- **Class names:** none was renamed or removed.

### One robustness fix

When the dev server starts cold, React's development mode creates the map, removes it and creates it again. That can make MapLibre restart its workers and reload the map style for a moment. If flood data arrived in that moment, the page went blank with "Style is not done loading". This happened once during testing. The cause sits in timing between React and MapLibre, which the refactor did not change, but it could have spoiled a demo.

`whenStyleLoaded()` in `map/layers.ts` now waits for the reload to finish. It changes nothing when the style is already loaded, which is always the case in the built app.

## How it was checked

- **Backend:** every API route was called offline before and after: 3 regions plus an unknown one, every layer kind, every reference file, summaries for rises 0 to 7, alert posts valid and invalid, and with and without gzip. All 101 responses were identical. The forecast builders were run old against new on the same fake Open-Meteo data: same output, same field order, same requests. The route list is unchanged.
- **Frontend, in the browser:** the old and new builds were opened in the same browser tab. The tag, attributes, text and 37 computed styles of every element were compared in 9 app states:
  - start
  - each region
  - default and heat map modes
  - a +5 m rise
  - the Observed layer off
  - Data Sources
  - Alert Log

  All states were identical. The Situation Report was identical except its "Generated" time, which records when it was opened.
- **Frontend, offline:** the subagent's own harness compared rendered markup for 3,008 random app states and recorded map calls for 300 random runs, old against new. No differences.
- **Build and lint:** `npm run build` and `npm run lint` pass, and the dev server loads cold and warm without errors.
- **Not covered by these checks:** logging a real alert from the page (skipped so the real alert log was not changed; its API is covered above), the play animation's timing, and the AI summary with a model running. Their code was moved, not rewritten.

## Where to add things now

- **New region:** add it to `data/reference/locations.json` with its data folders. For official reports, add its area to `FLOOD_REPORT_AREAS` in `backend/data.py`. The frontend picks it up on its own.
- **New per-location data file:**
  - Backend: add a reader in `backend/data.py` and one line in the route table in `backend/main.py`.
  - Frontend: add the field to `LocationData` and `EMPTY_DATA`, and one `get` or `optional` line in `frontend/src/api.ts`.
- **New forecast:** add a fetch function and one line in `FORECASTS` in `backend/forecast.py`.
- **New report figure for the AI summary:** add a line in the matching section of `backend/facts.py`.
- **New map layer:** add an id in `frontend/src/map/config.ts` and an entry in the layer list in `frontend/src/map/layers.ts`.
- **New report panel:** add a component in `frontend/src/components/ReportSections.tsx` using `Table`, then place it in `SituationReport.tsx` or `DataSources.tsx`.
