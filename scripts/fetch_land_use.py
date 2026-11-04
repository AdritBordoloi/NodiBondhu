"""Estimate which land types lie inside each flood scenario, using Bhuvan's land use API.

Run: python scripts/fetch_land_use.py simaluguri
Needs BHUVAN_LULC_AOI_TOKEN in backend/.env. The flood shapes are too detailed to send whole,
so the area is split into 2 km squares. Each square's flooded area is shared out in proportion
to the land types listed for that square. Answers are saved as they arrive, so a stopped run
carries on where it left off.
"""
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from shapely.geometry import box, shape
from shapely.ops import unary_union

from pilot_area import load_boundary, load_locations, read_secret

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
URL = "https://bhuvan-app1.nrsc.gov.in/api/lulc250k/curl_lulc250k.php"
HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}

YEAR = "2018_19"
CELL_DEGREES = 0.02  # about 2 km
PAUSE_SECONDS = 1
MAX_FAILURES_IN_A_ROW = 5
RISES_M = (1, 2, 3, 4, 5, 6)
SOURCE = "NodiBondhu estimate using Bhuvan LULC 250k land use, 2018-19, NRSC/ISRO"
QUALITY = (
    "Estimate from 2 km squares, assuming land types are spread evenly within each square. Land "
    "use is from 2018-19, and the flood areas come from a model not yet checked against a real "
    "flood, so treat these as rough sizes only"
)
GROUPS = (
    ("Farmland", ("kharif", "rabi", "zaid", "double", "fallow", "shifting")),
    ("Plantation", ("plantation",)),
    ("Forest", ("forest",)),
    ("Built-up", ("built",)),
    ("Water bodies", ("waterbodies", "water bodies")),
    ("Wasteland", ("waste",)),
)
OTHER = "Other"
NOT_CLASSIFIED = "Land type not listed"


def group_for(description: str) -> str:
    text = description.lower()
    for name, words in GROUPS:
        if any(word in text for word in words):
            return name
    return OTHER


def grid_cells(bbox: list[float]):
    west, south, east, north = bbox
    columns = math.ceil(round((east - west) / CELL_DEGREES, 6))
    rows = math.ceil(round((north - south) / CELL_DEGREES, 6))
    for row in range(rows):
        for column in range(columns):
            left = west + column * CELL_DEGREES
            bottom = south + row * CELL_DEGREES
            yield box(left, bottom, min(left + CELL_DEGREES, east), min(bottom + CELL_DEGREES, north))


def cell_key(cell) -> str:
    return ",".join(f"{value:.4f}" for value in cell.bounds)


def cell_wkt(cell) -> str:
    west, south, east, north = cell.bounds
    corners = ((west, south), (east, south), (east, north), (west, north), (west, south))
    return "POLYGON((" + ",".join(f"{x:.4f} {y:.4f}" for x, y in corners) + "))"


def look_up(client: httpx.Client, token: str, cell) -> list[dict]:
    params = {"polygon": cell_wkt(cell), "year": YEAR, "option": "json", "token": token}
    response = client.get(URL, params=params, headers=HEADERS)
    response.raise_for_status()
    answer = response.json()
    if isinstance(answer, dict) and "status" in answer:
        return []
    if not isinstance(answer, list):
        raise ValueError("Unexpected answer from the land use service")
    return answer


def collect(location: dict, cells: list, raw_path: Path) -> dict:
    answers = json.loads(raw_path.read_text(encoding="utf-8")) if raw_path.exists() else {}
    missing = [cell for cell in cells if cell_key(cell) not in answers]
    print(f"{location['id']}: {len(cells)} squares, {len(missing)} still to look up", flush=True)
    if not missing:
        return answers

    token = read_secret("BHUVAN_LULC_AOI_TOKEN")
    failures = 0
    with httpx.Client(timeout=60) as client:
        for number, cell in enumerate(missing, 1):
            try:
                answers[cell_key(cell)] = look_up(client, token, cell)
                failures = 0
            except (httpx.HTTPError, ValueError) as error:
                # Only the error type is shown, because the full message contains the key
                failures += 1
                print(f"lookup failed for {cell_key(cell)}: {type(error).__name__}", flush=True)
                if failures >= MAX_FAILURES_IN_A_ROW:
                    raw_path.write_text(json.dumps(answers), encoding="utf-8")
                    raise SystemExit("Stopping after repeated failures. Run again to carry on.")
            if number % 10 == 0:
                raw_path.write_text(json.dumps(answers), encoding="utf-8")
                print(f"{number}/{len(missing)} done", flush=True)
            time.sleep(PAUSE_SECONDS)
    raw_path.write_text(json.dumps(answers), encoding="utf-8")
    return answers


def cell_land_use(records: list[dict]) -> dict[str, float]:
    areas: dict[str, float] = {}
    for record in records:
        name = group_for(record["LULC Description"])
        areas[name] = areas.get(name, 0.0) + float(record["Area in Sq. Km"])
    return areas


def build(location: dict, cells: list, answers: dict) -> dict:
    km2_per_degree2 = 111.32**2 * math.cos(math.radians(sum(location["bbox"][1::2]) / 2))
    land_use = {cell_key(cell): cell_land_use(answers.get(cell_key(cell), [])) for cell in cells}

    whole_area: dict[str, float] = {}
    for areas in land_use.values():
        for name, area in areas.items():
            whole_area[name] = whole_area.get(name, 0.0) + area

    scenarios = []
    for rise in RISES_M:
        path = ROOT / "data" / "simulated" / location["id"] / f"flood_plus_{rise}m.geojson"
        feature = json.loads(path.read_text(encoding="utf-8"))["features"][0]
        flood = unary_union(shape(feature["geometry"]))
        flooded: dict[str, float] = {}
        for cell in cells:
            flooded_km2 = flood.intersection(cell).area * km2_per_degree2
            if flooded_km2 == 0:
                continue
            areas = land_use[cell_key(cell)]
            listed = sum(areas.values())
            if listed == 0:
                flooded[NOT_CLASSIFIED] = flooded.get(NOT_CLASSIFIED, 0.0) + flooded_km2
                continue
            for name, area in areas.items():
                flooded[name] = flooded.get(name, 0.0) + flooded_km2 * area / listed
        total = sum(flooded.values())
        scenarios.append(
            {
                "rise_m": rise,
                "flooded_area_km2": round(total, 1),
                "model_area_km2": feature["properties"]["flooded_area_km2"],
                "land_types": sorted(
                    (
                        {"name": name, "flooded_km2": round(area, 1), "share": round(area / total, 3)}
                        for name, area in flooded.items()
                    ),
                    key=lambda item: -item["flooded_km2"],
                ),
            }
        )
    return {
        "name": f"Estimated land use in the {location['name']} flood scenarios",
        "kind": "simulated",
        "source": SOURCE,
        "timestamp": datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat(timespec="minutes"),
        "quality": QUALITY,
        "land_use_year": "2018-19",
        "squares_checked": len(cells),
        "squares_without_data": sum(1 for areas in land_use.values() if not areas),
        "whole_area": [
            {"name": name, "area_km2": round(area, 1)}
            for name, area in sorted(whole_area.items(), key=lambda item: -item[1])
        ],
        "scenarios": scenarios,
    }


def main() -> None:
    location_id = sys.argv[1] if len(sys.argv) > 1 else "simaluguri"
    location = next(item for item in load_locations() if item["id"] == location_id)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cells = list(grid_cells(location["bbox"]))
    boundary = load_boundary(location_id)
    if boundary is not None:
        cells = [cell for cell in cells if cell.intersects(boundary)]
    answers = collect(location, cells, RAW_DIR / f"bhuvan_land_use_{location_id}.json")
    result = build(location, cells, answers)
    path = ROOT / "data" / "reference" / location_id / "land_use.json"
    path.write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"{result['squares_without_data']} of {result['squares_checked']} squares had no land use data")
    print("whole area:", result["whole_area"])
    for scenario in result["scenarios"]:
        summary = ", ".join(f"{item['name']} {item['flooded_km2']}" for item in scenario["land_types"])
        print(f"+{scenario['rise_m']} m: {scenario['flooded_area_km2']} km2 (model {scenario['model_area_km2']}): {summary}")


if __name__ == "__main__":
    main()
