# NodiBondhu: Hackathon Plan

## Status (updated 1:20 pm, 4 Nov)

Step-by-step instructions for each person are in `TEAM_STEPS.md`.

| Item | State |
|---|---|
| Challenge | Confirmed: NESFIC-D-18 |
| Pilot area | **Simaluguri, Sivasagar district, Assam**, on the Dikhow river |
| Plan | On `main` on GitHub |
| App | On `main` on GitHub, not deployed. Map, three layers, flood slider, dashboard tiles and demo alert log all work in dev |
| Observed layer | **Empty.** The nearest CWC gauge to Simaluguri is not identified yet. Person 3 to find it on the Dikhow, Disang or Brahmaputra |
| Forecast layer | Live rain forecast from Open-Meteo, with a saved copy for the demo |
| Simulated layer | First HAND model for +1 to +6 m (1,348 to 2,118 km2). **Not checked against a real flood and probably too large.** It floods the Simaluguri point only from +6 m. It ignores embankments, and terrain errors matter on flat land |
| Settlements | Only 70 places in OpenStreetMap for this area, so counts are too low. No population data |
| Next priority | Person 2: real past flood extent, to check the model |
| Proposal | Waiting on Person 3: 12-section document |
| Alerts | Demo log with officer approval. Nothing is sent to anyone |

## 1. The problem we are solving

**Challenge: NESFIC-D-18, "Digital Twin for Flood Management, Simulation and Early Warning Using Space Technology"** (Dept. of Science & Technology, Govt. of Assam, ASSAC).
Source: https://startup.assam.gov.in/nesfic26/problem-statements/nesfic-d-18


Key facts from the challenge page:

| Item                     | Detail                                                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem                  | Flood data comes from many sources and is not combined into one continuously updated spatial model                                                                                                                                                                                        |
| Users                    | ASDMA, district administration, water-resource authorities, field staff, responders, flood-prone communities                                                                                                                                                                              |
| Wanted outcomes          | Better flood situational awareness, faster identification of affected areas, scenario-based decision support, better response coordination, better alert lead time and targeting                                                                                                          |
| Expected build           | Digital-twin platform combining satellite remote sensing, GIS, IoT water-level/weather sensors and forecast/model outputs. Allowed tools: 2D/3D geospatial modelling, hydrological/hydraulic simulation, AI/ML, real-time ingestion, scenario modelling, dashboards, multi-channel alerts |
| Pilot                    | Selected flood-prone riverine districts/basins that have enough sensor and historical data                                                                                                                                                                                                |
| **Explicit requirement** | Clearly separate **observed vs forecast vs simulated** data, show **uncertainty/quality indicators**, support **interoperability** with existing Government systems                                                                                                                       |
| Dates                    | Applications close **10 Nov 2026**. Clarification cut-off (25 Oct) has passed                                                                                                                                                                                                             |
| Prize                    | Grant support up to Rs 40 lakh                                                                                                                                                                                                                                                            |

**Proposal format (`uspr.pdf`, Uniform Solution Proposal Requirements).** The proposal needs these 12 sections and should focus on development, with pilot validation only after the development plan:

1. Problem understanding and user workflow
2. Proposed solution and key features
3. User journey, wireframes and prototype
4. Technology and solution architecture
5. Development methodology and intermediate steps
6. Development timeline and milestones
7. Data and information requirements (do not assume unconfirmed access)
8. Team, manpower and expertise
9. Testing, validation and evidence
10. Security, privacy, safety and compliance
11. Innovation and differentiation
12. Resources, risks and pilot validation

## 2. Resource check

I checked the sites with Firecrawl and the built-in browser. Several Assam government sites refused automated access, so some are unchecked.

| Resource | Status | Use for NodiBondhu |
|---|---|---|
| Bhuvan (bhuvan.nrsc.gov.in) | Checked | Drainage, basin, sub-basin, watershed, water-body and village/district layers, plus a **Disaster mode**. Use for base layers and flood layers |
| MOSDAC (mosdac.gov.in) | Checked | Satellite imagery, radar, weather, heavy-rain and cyclone forecasts, nowcasting. Use for the rainfall and forecast layer |
| VEDAS (vedas.sac.gov.in) | Checked | Wetland dataset, drought portal and **experimental river water-level models, including the Brahmaputra**. Mentions a VEDAS API Centre. Check this first |
| Geospatial catalogue (catalogue.geospatial.org.in) | Checked | 155 datasets from 35 providers: admin boundaries, land cover, soil moisture. Use for supporting layers |
| Survey of India (onlinemaps.surveyofindia.gov.in) | Checked | Mapping products. The page only gave the geospatial-policy blurb, so check downloads manually |
| ASDMA (asdma.assam.gov.in) | Checked in browser | Links: Smart Axom app, National Disaster Alert Portal, Community Response Portal, district disaster plans. Use as the user and integration target |
| data.gov.in | Failed (503) | Retry later for rainfall and flood datasets |
| DES Assam, NESDR Assam, Assam GIS geoportal | Not reachable | Blocked automated access. Open by hand and note what is downloadable |

Not on your list but worth using: Open-Meteo (free weather and rainfall API), Copernicus Sentinel-1 / Google Earth Engine (flood extent from radar), SRTM or Copernicus DEM (terrain), GloFAS (river discharge forecast), India-WRIS / CWC (river gauge levels).

## 3. What we build (MVP)

A web app, **NodiBondhu Flood Twin**, for one pilot area. Pilot: **Simaluguri, Sivasagar district, Assam**, covering the surrounding area of about 60 km by 60 km.

Must have:
1. **Live map** (MapLibre or Leaflet): river network, villages, districts, DEM-based terrain.
2. **Three clearly labelled layers**: Observed (gauges and rainfall), Forecast (weather and river outlook), Simulated (inundation scenarios). Each shows a source, timestamp and uncertainty or quality badge.
3. **Scenario slider**: "river rises X metres" or "Y mm rain in 24h" and the map shows the affected area. Use **HAND (Height Above Nearest Drainage)** from the DEM, with a plain bathtub model as the fallback. Pre-compute +1 to +6 m as GeoJSON files so the slider just switches files. Show villages and people affected.
4. **Alerts**: threshold triggers push to a channel (Telegram or WhatsApp or SMS mock) with targeted village lists.
5. **Dashboard**: current status, affected area, alert log.
6. **Interoperability**: open APIs (GeoJSON/OGC WMS or WFS) and a short note on plugging into ASDMA workflows.

Nice to have: 3D view (CesiumJS), simple ML water-level forecast, mobile view for field staff.

Stack: a responsive website using React, TypeScript and Vite with MapLibre, a small Python (FastAPI) backend, and GeoJSON and CSV files with no database. Deploy on Vercel and Render (not yet tested). Build in thin end-to-end slices, in this order: observed river levels, scenario slider, forecast, affected villages, alerts, dashboard.

## 4. Schedule

**Deadline: tonight, 12:00 midnight (5 Nov 00:00 IST).** Replanned at 12:40 pm for three people. If anything slips, cut from the last slice first, never the proposal.

| Time           | Person 1 (main laptop)                                                           | Person 2 (laptop, Gemini)                                                                    | Person 3 (tablet)                                                                              |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 12:45 to 1:00  | **All: kickoff.** Agree the past flood to check | Same                                                                                         | Same                                                                                           |
| 1:00 to 3:00 | Done early: app, API, flood slider, dashboard, demo alerts. Next: add real data as it arrives | Register for Earth Engine, map the past flood from satellite | CWC levels in a shared sheet, flood reports, proposal sections 1 and 2 |
| **3:00** | **Checkpoint: do we have a past flood extent and one real CWC reading?** | | |
| 3:00 to 6:00 | Add the past flood, compare it with the model, improve the model | Better village data, embankment locations | Proposal sections 3, 5, 6, 8 |
| **6:00** | **Checkpoint: model compared with a real flood, result recorded** | | |
| 6:00 to 8:00 | Polish, offline fallback, first deployment test | Notes for sections 7 and 9 | Proposal sections 4, 7, 9, 10, 11, 12 |
| **8:00**       | **Checkpoint: core demo works end to end**                                       |                                                                                              |                                                                                                |
| 8:00 to 9:15   | Bug fixes and polish                                                             | Test the app, cache all data for offline demo                                                | Test on the tablet, write the demo script                                                      |
| 9:15 to 9:45   | **All: dinner and feature freeze**                                               | Same                                                                                         | Same                                                                                           |
| 9:45 to 10:45  | Deploy, README, final fixes                                                      | Check facts and numbers in the proposal                                                      | Finish the proposal with screenshots                                                           |
| 10:45 to 11:15 | Record the screen for the demo video                                             | Check the video against the checklist                                                        | Narrate the demo                                                                               |
| 11:15 to 11:45 | Run the checklist and **submit**                                                 | Check the upload                                                                             | Final read of the proposal                                                                     |
| 11:45 to 12:00 | Buffer for portal problems                                                       | Same                                                                                         | Same                                                                                           |

## 5. Roles

| Person | Owns | Hands over |
|---|---|---|
| Person 1: main laptop, Claude | App, backend, integration, deployment, submission | Public link, repo, final submission |
| Person 2: laptop, Gemini Pro | Evidence: past flood extent, village data, embankments, model checks | GeoJSON and CSV files with a source and date, in a shared Drive folder |
| Person 3: tablet | Proposal, manual data collection, wireframes, demo script and narration | Proposal PDF, shared sheet of CWC levels, wireframes, script |

Rules:
- Every data file uses the same fields: `kind` (observed, forecast or simulated), `source`, `timestamp`, `quality`.
- Every number from Gemini or Claude needs a real source before it goes in the app or proposal.
- Only Person 1 pushes to the main app code. Person 2 only adds files under `data/`.

## 6. Submission checklist

- [ ] Proposal follows `uspr.pdf` format
- [ ] Observed, forecast and simulated data are visibly separated, each with a source and timestamp
- [ ] Uncertainty or quality indicator shown on every forecast and simulated layer
- [ ] Pilot area named, with the data sources used for it
- [ ] Scenario simulation works live in the demo
- [ ] Alert demo works with a real or mocked channel
- [ ] Interoperability note (APIs, ASDMA integration path)
- [ ] Demo video recorded
- [ ] Public repo clean: no API keys, `.env` ignored, README written
- [ ] Submitted on the NESFIC portal before the deadline

## 7. Risks and fallbacks

| Risk                                             | Fallback                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Live gauge or API data unavailable               | Use stored historical data and label it "replay of 2022 flood"                                 |
| Government portals need registration or approval | Use open sources (Open-Meteo, Sentinel, SRTM) and show the integration path                    |
| Hydraulic model takes too long                   | Ship the DEM bathtub model and describe hydraulic modelling as phase 2                         |
| Firecrawl blocked by Assam sites                 | Download data manually in a browser                                                            |
| Time runs short                                  | Cut 3D view and ML first. Never cut the observed/forecast/simulated separation or the proposal |
