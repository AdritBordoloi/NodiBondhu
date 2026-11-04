"""NodiBondhu API: serves observed, forecast and simulated layers as GeoJSON."""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KINDS = ("observed", "forecast", "simulated")
SETTLEMENTS_FILE = DATA_DIR / "reference" / "settlements.geojson"
ALERTS_FILE = DATA_DIR / "runtime" / "alerts.json"

IST = timezone(timedelta(hours=5, minutes=30))
SIMALUGURI = (26.92, 94.756)  # lat, lon from OpenStreetMap
RAIN_FILE = DATA_DIR / "forecast" / "rain_simaluguri.geojson"
RAIN_MAX_AGE = timedelta(minutes=30)
RAIN_SOURCE = "Weather data by Open-Meteo.com"

app = FastAPI(title="NodiBondhu API")


def read_layer(kind: str) -> dict:
    features = []
    for path in sorted((DATA_DIR / kind).glob("*.geojson")):
        features += json.loads(path.read_text(encoding="utf-8"))["features"]
    return {"type": "FeatureCollection", "features": features}


async def fetch_rain_forecast() -> dict:
    lat, lon = SIMALUGURI
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
                    "name": "Rain forecast near Simaluguri",
                    "source": RAIN_SOURCE,
                    "timestamp": datetime.now(IST).isoformat(timespec="minutes"),
                    "quality": "Global model forecast, not checked against local gauges",
                    "rain_next_24h_mm": total(24),
                    "rain_next_72h_mm": total(72),
                },
            }
        ],
    }


async def refresh_rain_forecast() -> None:
    """Keep a saved copy so the demo still works if the service or internet fails."""
    if RAIN_FILE.exists():
        age = datetime.now(timezone.utc).timestamp() - RAIN_FILE.stat().st_mtime
        if age < RAIN_MAX_AGE.total_seconds():
            return
    try:
        layer = await fetch_rain_forecast()
    except (httpx.HTTPError, KeyError, ValueError):
        return
    RAIN_FILE.write_text(json.dumps(layer, indent=2), encoding="utf-8")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/layers/{kind}")
async def get_layer(kind: str) -> dict:
    if kind not in KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown layer: {kind}")
    if kind == "forecast":
        await refresh_rain_forecast()
    return read_layer(kind)


@app.get("/api/settlements")
def get_settlements() -> dict:
    return json.loads(SETTLEMENTS_FILE.read_text(encoding="utf-8"))


class AlertRequest(BaseModel):
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
    affected = sorted(
        feature["properties"]["name"]
        for feature in get_settlements()["features"]
        if feature["properties"]["first_flooded_at_m"] is not None
        and feature["properties"]["first_flooded_at_m"] <= request.rise_m
    )
    if not affected:
        raise HTTPException(status_code=400, detail="No settlements are affected in this scenario")
    alerts = read_alerts()
    alert = {
        "id": len(alerts) + 1,
        "created_at": datetime.now(IST).isoformat(timespec="seconds"),
        "rise_m": request.rise_m,
        "settlements": affected,
        "kind": "simulated",
        "channel": "Demo log only, not sent to anyone",
    }
    alerts.insert(0, alert)
    ALERTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ALERTS_FILE.write_text(json.dumps(alerts, indent=2), encoding="utf-8")
    return alert
