# NodiBondhu

Flood digital twin prototype for NESFIC-D-18, covering Simaluguri, Sivasagar and Karimganj (Sribhumi district) in Assam. It keeps observed, forecast and simulated data separate, and shows where each figure comes from.

**Prototype only, not for operational use.** The flood model only partly matches one radar image of the July 2026 flood, and alerts are a demo log that sends nothing.

## Features

- Flood scenarios from +1 to +6 m river rise on Bhuvan satellite imagery, with place names and a 1x to 4x zoom
- Flood seen by Sentinel-1 radar in July 2026, and a check of the model against it
- Reported river levels, which are past readings and not live gauges
- Rain forecast and GloFAS river flow from Open-Meteo, in Data Sources and the report
- Census villages, estimated flooded land use and flooded road stretches
- Situation Report and demo alert log

## Run it

From the project folder, in two terminals:

```bash
cd backend && .venv/Scripts/python -m uvicorn main:app --port 8000
```

```bash
cd frontend && npm install && npm run dev
```

Then open http://localhost:5173. The backend needs `pip install -r requirements.txt` in its virtual environment first. Restart it after changing backend code.

## Data

The data files are in `data/`, explained in `data/README.md`, and the scripts that build them are in `scripts/`. Sources are listed in `Resources.md`.

Bhuvan keys are only needed to rerun the scripts. They go in `backend/.env`, which Git ignores, and must never be put in frontend code or committed.

## Known limits

- The flood model ignores embankments, flow and timing, and +4 to +6 m still cover about 30-65% of the study areas.
- Radar misses water under trees and in towns, and covers 65% of the Sivasagar area.
- Census figures are from 2001 and many villages have none.
- There is no live river gauge, and the site is not deployed.
