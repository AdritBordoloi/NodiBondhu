"""Rain and river flow forecasts from Open-Meteo, saved so the demo still works offline."""
import json
from datetime import datetime, timedelta
from pathlib import Path

import httpx

from data import DATA_DIR, IST, feature_collection, write_json

MAX_AGE = timedelta(minutes=30)
TIMEOUT_SECONDS = 8
RAIN_SOURCE = "Weather data by Open-Meteo.com"
FLOW_SOURCE = "GloFAS river discharge (Copernicus Emergency Management Service) via Open-Meteo.com"
FLOW_QUALITY = (
    "Global model at about 5 km, not a gauge reading. Its river cell may not match the local "
    "channel exactly, so use it to compare with the 2026 monsoon peak, not as a measured flow"
)
FLOW_REFERENCE_START = "2026-05-01"
FLOW_REFERENCE_END = "2026-10-31"

refreshing: set[str] = set()


def forecast_point(coordinates: list[float], name: str, source: str, quality: str, figures: dict) -> dict:
    """A one-point forecast layer stamped with the time it was made."""
    lon, lat = coordinates
    properties = {
        "kind": "forecast",
        "name": name,
        "source": source,
        "timestamp": datetime.now(IST).isoformat(timespec="minutes"),
        "quality": quality,
        **figures,
    }
    return feature_collection(
        [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": properties}]
    )


async def fetch_rain(location: dict) -> dict:
    lon, lat = location["coordinates"]
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        response = await client.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": lat,
                "longitude": lon,
                "hourly": "precipitation",
                "past_days": 7,
                "forecast_days": 4,
                "timezone": "Asia/Kolkata",
            },
        )
    response.raise_for_status()
    hourly = response.json()["hourly"]

    now = datetime.now(IST).replace(tzinfo=None)
    readings = [
        (datetime.fromisoformat(time), rain)
        for time, rain in zip(hourly["time"], hourly["precipitation"])
        if rain is not None
    ]

    def total(start: datetime, end: datetime) -> float:
        return round(sum(rain for time, rain in readings if start <= time < end), 1)

    return forecast_point(
        [lon, lat],
        f"Rain forecast near {location['focus']}",
        RAIN_SOURCE,
        "Global model forecast, not checked against local gauges",
        {
            "rain_next_24h_mm": total(now, now + timedelta(hours=24)),
            "rain_next_72h_mm": total(now, now + timedelta(hours=72)),
            "rain_past_7d_mm": total(datetime.min, now),
        },
    )


def peak(daily: dict) -> tuple[str, float]:
    values = [(day, value) for day, value in zip(daily["time"], daily["river_discharge"]) if value is not None]
    return max(values, key=lambda item: item[1])


async def fetch_river_flow(location: dict) -> dict:
    """River flow on the main river near a location, with the 2026 monsoon peak to compare."""
    lon, lat = location["river_point"]
    url = "https://flood-api.open-meteo.com/v1/flood"
    point = {"latitude": lat, "longitude": lon, "daily": "river_discharge"}
    async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
        forecast = await client.get(url, params={**point, "forecast_days": 7})
        reference = await client.get(
            url, params={**point, "start_date": FLOW_REFERENCE_START, "end_date": FLOW_REFERENCE_END}
        )
    forecast.raise_for_status()
    reference.raise_for_status()

    daily = forecast.json()["daily"]
    peak_day, peak_flow = peak(daily)
    flood_day, flood_flow = peak(reference.json()["daily"])
    return forecast_point(
        [lon, lat],
        f"River flow forecast near {location['focus']}",
        FLOW_SOURCE,
        FLOW_QUALITY,
        {
            "flow_today_m3s": round(daily["river_discharge"][0], 1),
            "flow_peak_next_7d_m3s": round(peak_flow, 1),
            "flow_peak_date": peak_day,
            "monsoon_peak_2026_m3s": round(flood_flow, 1),
            "monsoon_peak_date": flood_day,
        },
    )


# Each saved forecast file and how to fetch it. Add a new forecast here
FORECASTS = {"rain": fetch_rain, "river_flow": fetch_river_flow}


def forecast_file(location: dict, name: str) -> Path:
    return DATA_DIR / "forecast" / location["id"] / f"{name}.geojson"


def have_forecasts(location: dict) -> bool:
    return all(forecast_file(location, name).exists() for name in FORECASTS)


def is_fresh(location: dict) -> bool:
    """Use the forecast's own time, because cloning a repo resets file times."""
    try:
        layer = json.loads(forecast_file(location, "rain").read_text(encoding="utf-8"))
        issued = datetime.fromisoformat(layer["features"][0]["properties"]["timestamp"])
    except (OSError, ValueError, KeyError, IndexError):
        return False
    return datetime.now(IST) - issued < MAX_AGE


async def refresh(location: dict) -> None:
    """Keep saved copies so the demo still works if a service or the internet fails."""
    if location["id"] in refreshing:
        return
    refreshing.add(location["id"])
    try:
        for name, fetch in FORECASTS.items():
            try:
                write_json(forecast_file(location, name), await fetch(location))
            except (httpx.HTTPError, KeyError, ValueError, OSError):
                continue
    finally:
        refreshing.discard(location["id"])
