"""Read the saved data: locations, reference layers and official flood reports."""
import json
import os
import threading
from datetime import timedelta, timezone
from pathlib import Path

from fastapi import HTTPException

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
IST = timezone(timedelta(hours=5, minutes=30))
LOCATIONS = json.loads((DATA_DIR / "reference" / "locations.json").read_text(encoding="utf-8"))
LOCATIONS_BY_ID = {location["id"]: location for location in LOCATIONS}

# Which official report area and river gauge best match each location
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


def get_location(location_id: str) -> dict:
    location = LOCATIONS_BY_ID.get(location_id)
    if location is None:
        raise HTTPException(status_code=404, detail=f"Unknown location: {location_id}")
    return location


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: object) -> None:
    """Write through a temporary file so a reader never sees half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{threading.get_ident()}.tmp")
    temporary.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def feature_collection(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def first_properties(path: Path) -> dict | None:
    """Properties of the first feature in a file, or None if there is no such file."""
    if not path.exists():
        return None
    features = read_json(path)["features"]
    return features[0]["properties"] if features else None


def floods_by(properties: dict, rise: int) -> bool:
    """Whether a place's land first floods at or below this river rise."""
    level = properties.get("first_flooded_at_m")
    return isinstance(level, (int, float)) and level <= rise


def read_reference(location_id: str, file_name: str, empty: dict | None = None) -> dict:
    """A file built for one location, or an empty answer for a location without one yet."""
    get_location(location_id)
    path = DATA_DIR / "reference" / location_id / file_name
    if path.exists():
        return read_json(path)
    return feature_collection([]) if empty is None else empty


def read_settlements(location_id: str) -> dict:
    get_location(location_id)
    return read_json(DATA_DIR / "reference" / location_id / "settlements.geojson")


def read_villages(location_id: str) -> dict:
    return read_reference(location_id, "villages.geojson")


def read_routes(location_id: str) -> dict:
    return read_reference(location_id, "routes.geojson")


def read_land_use(location_id: str) -> dict:
    return read_reference(location_id, "land_use.json", {})


def read_model_check(location_id: str) -> dict:
    return read_reference(location_id, "model_check.json", {})


def river_status(day: dict, gauge: str) -> str:
    if gauge in day["rivers_above_highest"]:
        return "highest"
    if gauge in day["rivers_above_danger"]:
        return "danger"
    return "not_listed"


def read_flood_reports(location_id: str) -> dict:
    """Official daily flood report figures for the area that best matches a location."""
    get_location(location_id)
    path = DATA_DIR / "observed" / "flood_reports.json"
    settings = FLOOD_REPORT_AREAS.get(location_id)
    if not path.exists() or settings is None:
        return {}
    reports = read_json(path)
    days = []
    for day in reports["days"]:
        figures = day["districts"].get(settings["district"])
        if figures and "circle" in settings:
            figures = figures["circles"].get(settings["circle"])
        days.append(
            {
                "date": day["date"],
                "report_generated": day["report_generated"],
                "checked": day["checked_against_state_total"],
                # None means the area was not listed that day, which is not the same as zero
                **{key: figures[key] if figures else None for key in ("villages", "people", "crop_hectares")},
                "river_status": river_status(day, settings["gauge"]),
            }
        )
    return {
        "kind": "observed",
        **{key: reports[key] for key in ("source", "source_url", "quality")},
        "area": settings["area"],
        "gauge": settings["gauge"],
        "days": days,
    }
