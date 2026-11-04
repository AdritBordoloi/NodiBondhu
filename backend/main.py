"""NodiBondhu API: serves observed, forecast and simulated layers as GeoJSON."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KINDS = ("observed", "forecast", "simulated")
LOCATIONS = json.loads((DATA_DIR / "reference" / "locations.json").read_text(encoding="utf-8"))
LOCATIONS_BY_ID = {location["id"]: location for location in LOCATIONS}
ALERTS_FILE = DATA_DIR / "runtime" / "alerts.json"

IST = timezone(timedelta(hours=5, minutes=30))
RAIN_MAX_AGE = timedelta(minutes=30)
RAIN_SOURCE = "Weather data by Open-Meteo.com"

app = FastAPI(title="NodiBondhu API")


def get_location(location_id: str) -> dict:
    location = LOCATIONS_BY_ID.get(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail=f"Unknown location: {location_id}")
    return location


def read_layer(kind: str, location_id: str) -> dict:
    features = []
    for path in sorted((DATA_DIR / kind / location_id).glob("*.geojson")):
        features += json.loads(path.read_text(encoding="utf-8"))["features"]
    return {"type": "FeatureCollection", "features": features}


def read_settlements(location_id: str) -> dict:
    path = DATA_DIR / "reference" / location_id / "settlements.geojson"
    return json.loads(path.read_text(encoding="utf-8"))


async def fetch_rain_forecast(location: dict) -> dict:
    lon, lat = location["coordinates"]
    async with httpx.AsyncClient(timeout=15) as client:
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


async def refresh_rain_forecast(location: dict) -> None:
    """Keep a saved copy so the demo still works if the service or internet fails."""
    rain_file = DATA_DIR / "forecast" / location["id"] / "rain.geojson"
    if rain_file.exists():
        age = datetime.now(timezone.utc).timestamp() - rain_file.stat().st_mtime
        if age < RAIN_MAX_AGE.total_seconds():
            return
    try:
        layer = await fetch_rain_forecast(location)
    except (httpx.HTTPError, KeyError, ValueError):
        return
    rain_file.parent.mkdir(parents=True, exist_ok=True)
    rain_file.write_text(json.dumps(layer, indent=2), encoding="utf-8")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/locations")
def get_locations() -> list[dict]:
    return LOCATIONS


@app.get("/api/locations/{location_id}/layers/{kind}")
async def get_layer(location_id: str, kind: str) -> dict:
    location = get_location(location_id)
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown layer: {kind}")
    if kind == "forecast":
        await refresh_rain_forecast(location)
    return read_layer(kind, location_id)


@app.get("/api/locations/{location_id}/settlements")
def get_settlements(location_id: str) -> dict:
    get_location(location_id)
    return read_settlements(location_id)


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
    affected = sorted(
        feature["properties"]["name"]
        for feature in read_settlements(location["id"])["features"]
        if feature["properties"]["first_flooded_at_m"] is not None
        and feature["properties"]["first_flooded_at_m"] <= request.rise_m
    )
    if not affected:
        raise HTTPException(status_code=400, detail="No settlements are affected in this scenario")
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
    ALERTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ALERTS_FILE.write_text(json.dumps(alerts, indent=2), encoding="utf-8")
    return alert
