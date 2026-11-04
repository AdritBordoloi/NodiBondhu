"""NodiBondhu API: serves observed, forecast and simulated layers as GeoJSON."""
import gzip
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KINDS = ("observed", "forecast", "simulated")
LOCATIONS = json.loads((DATA_DIR / "reference" / "locations.json").read_text(encoding="utf-8"))
LOCATIONS_BY_ID = {location["id"]: location for location in LOCATIONS}
ALERTS_FILE = DATA_DIR / "runtime" / "alerts.json"

IST = timezone(timedelta(hours=5, minutes=30))
RAIN_MAX_AGE = timedelta(minutes=30)
RAIN_TIMEOUT_SECONDS = 8
RAIN_SOURCE = "Weather data by Open-Meteo.com"

app = FastAPI(title="NodiBondhu API")
app.add_middleware(GZipMiddleware, minimum_size=1000)

alerts_lock = threading.Lock()
layer_cache: dict[tuple[str, str], tuple[tuple, tuple[bytes, bytes]]] = {}
rain_refreshing: set[str] = set()


def get_location(location_id: str) -> dict:
    location = LOCATIONS_BY_ID.get(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail=f"Unknown location: {location_id}")
    return location


def write_json(path: Path, data: object) -> None:
    """Write through a temporary file so a reader never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def read_layer(kind: str, location_id: str) -> tuple[bytes, bytes]:
    """Merge and compress a layer once, then reuse it until one of its files changes."""
    paths = sorted((DATA_DIR / kind / location_id).glob("*.geojson"))
    version = tuple((path.name, path.stat().st_mtime_ns) for path in paths)
    cached = layer_cache.get((kind, location_id))
    if cached and cached[0] == version:
        return cached[1]
    features = []
    for path in paths:
        features += json.loads(path.read_text(encoding="utf-8"))["features"]
    content = json.dumps({"type": "FeatureCollection", "features": features}).encode("utf-8")
    versions = (content, gzip.compress(content))
    layer_cache[(kind, location_id)] = (version, versions)
    return versions


def read_settlements(location_id: str) -> dict:
    path = DATA_DIR / "reference" / location_id / "settlements.geojson"
    return json.loads(path.read_text(encoding="utf-8"))


async def fetch_rain_forecast(location: dict) -> dict:
    lon, lat = location["coordinates"]
    async with httpx.AsyncClient(timeout=RAIN_TIMEOUT_SECONDS) as client:
        response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "hourly": "precipitation",
                "forecast_days": 4,
                "timezone": "Asia/Kolkata",
            },
        )
    response.raise_for_status()
    hourly = response.json()["hourly"]

    now = datetime.now(IST).replace(tzinfo=None)
    upcoming = [
        (datetime.fromisoformat(time), rain)
        for time, rain in zip(hourly["time"], hourly["precipitation"])
        if datetime.fromisoformat(time) >= now and rain is not None
    ]

    def total(hours: int) -> float:
        cutoff = now + timedelta(hours=hours)
        return round(sum(rain for time, rain in upcoming if time < cutoff), 1)

    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "kind": "forecast",
                    "name": f"Rain forecast near {location['focus']}",
                    "source": RAIN_SOURCE,
                    "timestamp": datetime.now(IST).isoformat(timespec="minutes"),
                    "quality": "Global model forecast, not checked against local gauges",
                    "rain_next_24h_mm": total(24),
                    "rain_next_72h_mm": total(72),
                },
            }
        ],
    }


def rain_file(location: dict) -> Path:
    return DATA_DIR / "forecast" / location["id"] / "rain.geojson"


def rain_is_fresh(location: dict) -> bool:
    """Use the forecast's own time, because cloning a repo resets file times."""
    try:
        layer = json.loads(rain_file(location).read_text(encoding="utf-8"))
        issued = datetime.fromisoformat(layer["features"][0]["properties"]["timestamp"])
    except (OSError, ValueError, KeyError, IndexError):
        return False
    return datetime.now(IST) - issued < RAIN_MAX_AGE


async def refresh_rain_forecast(location: dict) -> None:
    """Keep a saved copy so the demo still works if the service or internet fails."""
    if location["id"] in rain_refreshing:
        return
    rain_refreshing.add(location["id"])
    try:
        layer = await fetch_rain_forecast(location)
        write_json(rain_file(location), layer)
    except (httpx.HTTPError, KeyError, ValueError, OSError):
        return
    finally:
        rain_refreshing.discard(location["id"])


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
        if not rain_file(location).exists():
            await refresh_rain_forecast(location)
        elif not rain_is_fresh(location):
            # Answer now with the saved forecast and its time, then update it for the next visit
            background_tasks.add_task(refresh_rain_forecast, location)
    content, compressed = await run_in_threadpool(read_layer, kind, location_id)
    headers = {"Vary": "Accept-Encoding"}
    if "gzip" in request.headers.get("accept-encoding", ""):
        headers["Content-Encoding"] = "gzip"
        content = compressed
    return Response(content=content, media_type="application/json", headers=headers)


@app.get("/api/locations/{location_id}/settlements")
def get_settlements(location_id: str) -> dict:
    get_location(location_id)
    return read_settlements(location_id)


@app.get("/api/locations/{location_id}/villages")
def get_villages(location_id: str) -> dict:
    """Census villages, or an empty layer for a location with no lookup yet."""
    get_location(location_id)
    path = DATA_DIR / "reference" / location_id / "villages.geojson"
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/locations/{location_id}/routes")
def get_routes(location_id: str) -> dict:
    """Main road routes measured against the flood scenarios, or an empty layer."""
    get_location(location_id)
    path = DATA_DIR / "reference" / location_id / "routes.geojson"
    if not path.exists():
        return {"type": "FeatureCollection", "features": []}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/locations/{location_id}/land-use")
def get_land_use(location_id: str) -> dict:
    """Estimated land use per flood scenario, or an empty answer if not built yet."""
    get_location(location_id)
    path = DATA_DIR / "reference" / location_id / "land_use.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


class AlertRequest(BaseModel):
    location: str
    rise_m: int


def read_alerts() -> list[dict]:
    if not ALERTS_FILE.exists():
        return []
    return json.loads(ALERTS_FILE.read_text(encoding="utf-8"))


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
        if feature["properties"]["first_flooded_at_m"] is not None
        and feature["properties"]["first_flooded_at_m"] <= request.rise_m
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
