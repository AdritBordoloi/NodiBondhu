"""NodiBondhu API: serves observed, forecast and simulated layers as GeoJSON."""
import gzip
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel

from ai_summary import write_summary

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
KINDS = ("observed", "forecast", "simulated")
LOCATIONS = json.loads((DATA_DIR / "reference" / "locations.json").read_text(encoding="utf-8"))
LOCATIONS_BY_ID = {location["id"]: location for location in LOCATIONS}
ALERTS_FILE = DATA_DIR / "runtime" / "alerts.json"

IST = timezone(timedelta(hours=5, minutes=30))
RAIN_MAX_AGE = timedelta(minutes=30)
RAIN_TIMEOUT_SECONDS = 8
RAIN_SOURCE = "Weather data by Open-Meteo.com"
FLOW_SOURCE = "GloFAS river discharge (Copernicus Emergency Management Service) via Open-Meteo.com"
FLOW_QUALITY = (
    "Global model at about 5 km, not a gauge reading. Its river cell may not match the local "
    "channel exactly, so use it to compare with the 2026 monsoon peak, not as a measured flow"
)
FLOW_REFERENCE_START = "2026-05-01"
FLOW_REFERENCE_END = "2026-10-31"

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
    upcoming = [(time, rain) for time, rain in readings if time >= now]
    past_week = round(sum(rain for time, rain in readings if time < now), 1)

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
                    "rain_past_7d_mm": past_week,
                },
            }
        ],
    }


async def fetch_river_flow(location: dict) -> dict:
    """River flow on the main river near a location, with the 2026 monsoon peak to compare."""
    lon, lat = location["river_point"]
    url = "https://flood-api.open-meteo.com/v1/flood"
    async with httpx.AsyncClient(timeout=RAIN_TIMEOUT_SECONDS) as client:
        forecast = await client.get(
            url,
            params={"latitude": lat, "longitude": lon, "daily": "river_discharge", "forecast_days": 7},
        )
        reference = await client.get(
            url,
            params={
                "latitude": lat,
                "longitude": lon,
                "daily": "river_discharge",
                "start_date": FLOW_REFERENCE_START,
                "end_date": FLOW_REFERENCE_END,
            },
        )
    forecast.raise_for_status()
    reference.raise_for_status()

    def peak(daily: dict) -> tuple[str, float]:
        values = [
            (day, value) for day, value in zip(daily["time"], daily["river_discharge"]) if value is not None
        ]
        return max(values, key=lambda item: item[1])

    daily = forecast.json()["daily"]
    peak_day, peak_flow = peak(daily)
    flood_day, flood_flow = peak(reference.json()["daily"])
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "kind": "forecast",
                    "name": f"River flow forecast near {location['focus']}",
                    "source": FLOW_SOURCE,
                    "timestamp": datetime.now(IST).isoformat(timespec="minutes"),
                    "quality": FLOW_QUALITY,
                    "flow_today_m3s": round(daily["river_discharge"][0], 1),
                    "flow_peak_next_7d_m3s": round(peak_flow, 1),
                    "flow_peak_date": peak_day,
                    "monsoon_peak_2026_m3s": round(flood_flow, 1),
                    "monsoon_peak_date": flood_day,
                },
            }
        ],
    }


def rain_file(location: dict) -> Path:
    return DATA_DIR / "forecast" / location["id"] / "rain.geojson"


def flow_file(location: dict) -> Path:
    return DATA_DIR / "forecast" / location["id"] / "river_flow.geojson"


def rain_is_fresh(location: dict) -> bool:
    """Use the forecast's own time, because cloning a repo resets file times."""
    try:
        layer = json.loads(rain_file(location).read_text(encoding="utf-8"))
        issued = datetime.fromisoformat(layer["features"][0]["properties"]["timestamp"])
    except (OSError, ValueError, KeyError, IndexError):
        return False
    return datetime.now(IST) - issued < RAIN_MAX_AGE


async def refresh_rain_forecast(location: dict) -> None:
    """Keep saved copies so the demo still works if a service or the internet fails."""
    if location["id"] in rain_refreshing:
        return
    rain_refreshing.add(location["id"])
    try:
        for fetch, path in (
            (fetch_rain_forecast, rain_file(location)),
            (fetch_river_flow, flow_file(location)),
        ):
            try:
                write_json(path, await fetch(location))
            except (httpx.HTTPError, KeyError, ValueError, OSError):
                continue
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
        if not rain_file(location).exists() or not flow_file(location).exists():
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


@app.get("/api/locations/{location_id}/model-check")
def get_model_check(location_id: str) -> dict:
    """How the flood scenarios compare with a flood seen by radar, or empty if not built yet."""
    get_location(location_id)
    path = DATA_DIR / "reference" / location_id / "model_check.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


FLOOD_REPORT_AREAS = {
    "simaluguri": {
        "area": "Nazira revenue circle",
        "district": "Sivasagar",
        "circle": "Nazira",
        "gauge": "Dikhou (Sivasagar)",
    },
    "sivasagar": {"area": "Sivasagar district", "district": "Sivasagar", "gauge": "Dikhou (Sivasagar)"},
    "karimganj": {"area": "Sribhumi district", "district": "Sribhumi", "gauge": "Kushiyara (SRIBHUMI (FFS))"},
}


@app.get("/api/locations/{location_id}/flood-reports")
def get_flood_reports(location_id: str) -> dict:
    """Official daily flood report figures for the area that best matches a location."""
    get_location(location_id)
    path = DATA_DIR / "observed" / "flood_reports.json"
    settings = FLOOD_REPORT_AREAS.get(location_id)
    if not path.exists() or settings is None:
        return {}
    reports = json.loads(path.read_text(encoding="utf-8"))
    days = []
    for day in reports["days"]:
        district = day["districts"].get(settings["district"])
        figures = district
        if district and "circle" in settings:
            figures = district["circles"].get(settings["circle"])
        if settings["gauge"] in day["rivers_above_highest"]:
            river_status = "highest"
        elif settings["gauge"] in day["rivers_above_danger"]:
            river_status = "danger"
        else:
            river_status = "not_listed"
        days.append(
            {
                "date": day["date"],
                "report_generated": day["report_generated"],
                "checked": day["checked_against_state_total"],
                # None means the area was not listed that day, which is not the same as zero
                "villages": figures["villages"] if figures else None,
                "people": figures["people"] if figures else None,
                "crop_hectares": figures["crop_hectares"] if figures else None,
                "river_status": river_status,
            }
        )
    return {
        "kind": "observed",
        "source": reports["source"],
        "source_url": reports["source_url"],
        "quality": reports["quality"],
        "area": settings["area"],
        "gauge": settings["gauge"],
        "days": days,
    }


def read_feature(path: Path) -> dict | None:
    """Properties of the first feature in a file, or None if there is no such file."""
    if not path.exists():
        return None
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    return features[0]["properties"] if features else None


def long_date(value: str) -> str:
    day = datetime.fromisoformat(value[:10])
    return f"{day.day} {day:%B %Y}"


def summary_facts(location: dict, rise: int) -> list[str]:
    """The report's main figures as labelled lines, the only things the model may use."""
    location_id = location["id"]
    scenario = read_feature(DATA_DIR / "simulated" / location_id / f"flood_plus_{rise}m.geojson")
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"No scenario for +{rise} m")
    facts = [
        f"Simulated: a +{rise} m river rise in the {location['name']} map area would flood about "
        f"{scenario['flooded_area_km2']} km2 of land."
    ]

    places = [place["properties"] for place in read_settlements(location_id)["features"]]
    reached = [p for p in places if p.get("first_flooded_at_m") is not None and p["first_flooded_at_m"] <= rise]
    facts.append(f"Simulated: it would reach {len(reached)} of {len(places)} mapped settlements.")
    focus = next((p for p in places if p.get("name") == location["focus"]), None)
    if focus:
        status = "would flood" if focus in reached else "would not flood"
        facts.append(f"Simulated: {location['focus']} {status} in this scenario.")

    villages = [village["properties"] for village in get_villages(location_id)["features"]]
    hit = [v for v in villages if isinstance(v.get("first_flooded_at_m"), (int, float)) and v["first_flooded_at_m"] <= rise]
    counted = [v for v in hit if v.get("population_2001") is not None]
    if villages:
        facts.append(
            f"Simulated: {len(hit)} of {len(villages)} census villages would have flooded land. {len(counted)} of them "
            f"have a census figure, with a whole population of {sum(v['population_2001'] for v in counted)} in 2001."
        )

    km = f"flooded_km_{rise}"
    routes = [r["properties"] for r in get_routes(location_id)["features"] if r["properties"].get("segment") == "route"]
    cut = sorted((r for r in routes if (r.get(km) or 0) > 0), key=lambda r: -r[km])
    if routes:
        worst = ", ".join(f"{r['name']} (about {r[km]} km)" for r in cut[:3])
        facts.append(
            f"Simulated: {len(cut)} of {len(routes)} main routes would pass through the flood area"
            + (f". Most affected: {worst}." if worst else ".")
        )

    land = next((s for s in get_land_use(location_id).get("scenarios", []) if s["rise_m"] == rise), None)
    if land:
        kinds = ", ".join(f"{k['name']} about {round(k['flooded_km2'])} km2" for k in land["land_types"][:3])
        facts.append(f"Simulated estimate of flooded land: {kinds}.")

    check = get_model_check(location_id)
    score = next((s for s in check.get("scenarios", []) if s["rise_m"] == rise), None)
    if score:
        facts.append(
            f"Observed check: this scenario overlaps {round(score['overlap_score'] * 100)}% with flood seen by "
            f"radar on {check['image_date']}, so the model only partly matches a real flood."
        )

    gauge = read_feature(DATA_DIR / "observed" / location_id / "river_levels.geojson")
    if gauge and gauge.get("level_m") is not None:
        limit = next(
            (f", {label} level {gauge[key]} m" for key, label in (("danger_level_m", "danger"), ("warning_level_m", "warning")) if gauge.get(key) is not None),
            "",
        )
        facts.append(f"Observed past reading, not live: {gauge['name']} was {gauge['level_m']} m on {long_date(gauge['timestamp'])}{limit}.")

    reports = get_flood_reports(location_id)
    days = [day for day in reports.get("days", []) if day["people"] is not None]
    if days:
        peak = max(days, key=lambda day: day["people"])
        facts.append(
            f"Observed official report for {reports['area']}, the whole area and not the map area: the most people "
            f"affected were {peak['people']} in {peak['villages']} villages on {long_date(peak['date'])}."
        )
    elif reports:
        facts.append(f"Observed: the official reports used do not list {reports['area']} as affected.")

    rain = read_feature(DATA_DIR / "forecast" / location_id / "rain.geojson")
    if rain and rain.get("rain_next_24h_mm") is not None:
        facts.append(f"Forecast: {rain['rain_next_24h_mm']} mm of rain in the next 24 hours and {rain['rain_next_72h_mm']} mm in the next 72 hours.")
    flow = read_feature(DATA_DIR / "forecast" / location_id / "river_flow.geojson")
    if flow and flow.get("flow_peak_next_7d_m3s") is not None:
        facts.append(
            f"Forecast: river flow peaks at {flow['flow_peak_next_7d_m3s']} m3/s in the next 7 days, "
            f"against a 2026 monsoon peak of {flow['monsoon_peak_2026_m3s']} m3/s."
        )
    return facts


@app.get("/api/locations/{location_id}/summary")
async def get_summary(location_id: str, rise: int = Query(ge=1, le=6)) -> dict:
    """A short written summary from a local model, or a message saying why there is none."""
    facts = await run_in_threadpool(summary_facts, get_location(location_id), rise)
    return await write_summary(facts)


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
