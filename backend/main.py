"""NodiBondhu API: serves observed, forecast and simulated layers as GeoJSON.

Modules: data.py reads saved files, forecast.py keeps rain and river flow forecasts fresh,
facts.py lists the report's figures, and ai_summary.py words them with a local model.
"""
import gzip
import json
import threading
from datetime import datetime

import forecast
from ai_summary import write_summary
from data import DATA_DIR, IST, LOCATIONS, feature_collection, floods_by, get_location, read_json, write_json
from data import read_flood_reports, read_land_use, read_model_check, read_routes, read_settlements, read_villages
from facts import summary_facts
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

KINDS = ("observed", "forecast", "simulated")
ALERTS_FILE = DATA_DIR / "runtime" / "alerts.json"

app = FastAPI(title="NodiBondhu API")
app.add_middleware(GZipMiddleware, minimum_size=1000)

alerts_lock = threading.Lock()
layer_cache: dict[tuple[str, str], tuple[tuple, tuple[bytes, bytes]]] = {}


def read_layer(kind: str, location_id: str) -> tuple[bytes, bytes]:
    """Merge and compress a layer once, then reuse it until one of its files changes."""
    paths = sorted((DATA_DIR / kind / location_id).glob("*.geojson"))
    version = tuple((path.name, path.stat().st_mtime_ns) for path in paths)
    cached = layer_cache.get((kind, location_id))
    if cached and cached[0] == version:
        return cached[1]
    features = [feature for path in paths for feature in read_json(path)["features"]]
    content = json.dumps(feature_collection(features)).encode("utf-8")
    versions = (content, gzip.compress(content))
    layer_cache[(kind, location_id)] = (version, versions)
    return versions


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/locations")
def get_locations() -> list[dict]:
    return LOCATIONS


@app.get("/api/locations/{location_id}/layers/{kind}")
async def get_layer(
    location_id: str, kind: str, request: Request, background_tasks: BackgroundTasks
) -> Response:
    location = get_location(location_id)
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown layer: {kind}")
    if kind == "forecast":
        if not forecast.have_forecasts(location):
            await forecast.refresh(location)
        elif not forecast.is_fresh(location):
            # Answer now with the saved forecast and its time, then update it for the next visit
            background_tasks.add_task(forecast.refresh, location)
    content, compressed = await run_in_threadpool(read_layer, kind, location_id)
    headers = {"Vary": "Accept-Encoding"}
    if "gzip" in request.headers.get("accept-encoding", ""):
        headers["Content-Encoding"] = "gzip"
        content = compressed
    return Response(content=content, media_type="application/json", headers=headers)


# Files built for one location, served as they are. Add a new one here
for name, read in {
    "settlements": read_settlements,
    "villages": read_villages,
    "routes": read_routes,
    "land-use": read_land_use,
    "model-check": read_model_check,
    "flood-reports": read_flood_reports,
}.items():
    app.add_api_route(f"/api/locations/{{location_id}}/{name}", read, methods=["GET"])


@app.get("/api/locations/{location_id}/summary")
async def get_summary(location_id: str, rise: int = Query(ge=1, le=6)) -> dict:
    """A short written summary from a local model, or a message saying why there is none."""
    facts = await run_in_threadpool(summary_facts, get_location(location_id), rise)
    return await write_summary(facts)


class AlertRequest(BaseModel):
    location: str
    rise_m: int


def read_alerts() -> list[dict]:
    return read_json(ALERTS_FILE) if ALERTS_FILE.exists() else []


@app.get("/api/alerts")
def get_alerts() -> list[dict]:
    return read_alerts()


@app.post("/api/alerts")
def create_alert(request: AlertRequest) -> dict:
    """Log an officer-approved demo alert. No message leaves the system."""
    location = get_location(request.location)
    scenario = DATA_DIR / "simulated" / location["id"] / f"flood_plus_{request.rise_m}m.geojson"
    if not scenario.exists():
        raise HTTPException(status_code=400, detail=f"No scenario for +{request.rise_m} m")
    affected = sorted(
        feature["properties"]["name"]
        for feature in read_settlements(location["id"])["features"]
        if floods_by(feature["properties"], request.rise_m)
    )
    if not affected:
        raise HTTPException(status_code=400, detail="No settlements are affected in this scenario")
    with alerts_lock:
        alerts = read_alerts()
        alert = {
            "id": len(alerts) + 1,
            "created_at": datetime.now(IST).isoformat(timespec="seconds"),
            "location": location["id"],
            "location_name": location["name"],
            "rise_m": request.rise_m,
            "settlements": affected,
            "kind": "simulated",
            "channel": "Demo log only, not sent to anyone",
        }
        alerts.insert(0, alert)
        write_json(ALERTS_FILE, alerts)
    return alert
