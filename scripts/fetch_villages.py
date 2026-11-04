"""Find census villages across a location with Bhuvan's village lookup and link them to flood scenarios.

Run: python scripts/fetch_villages.py simaluguri
Needs BHUVAN_VILLAGE_TOKEN in backend/.env. Answers are saved as they arrive, so a stopped
run carries on where it left off. Run again with no new lookups to rebuild the output file.
"""
import json
import math
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from shapely import STRtree
from shapely.geometry import Point, shape

from pilot_area import load_boundary, load_locations, read_secret

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
URL = "https://bhuvan-app1.nrsc.gov.in/api/api_proximity/curl_reverse_village.php"
HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}

STEP_DEGREES = 0.01  # about 1 km
PAUSE_SECONDS = 0.5
MAX_FAILURES_IN_A_ROW = 5
RISES_M = (1, 2, 3, 4, 5, 6)
SOURCE = "Census 2001 village data from the Bhuvan API, NRSC/ISRO"
QUALITY = (
    "Census from 2001, so about 25 years old. Found by checking points about 1 km apart, so small "
    "villages can be missed. Population is matched by village name within the district, so it is "
    "left blank when the name is missing or shared, and a match can still be wrong. It is the "
    "whole village, not the number of people flooded. Village position is approximate"
)


def grid_points(bbox: list[float]) -> list[tuple[float, float]]:
    west, south, east, north = bbox
    columns = math.floor((east - west) / STEP_DEGREES)
    rows = math.floor((north - south) / STEP_DEGREES)
    half = STEP_DEGREES / 2
    return [
        (round(west + half + column * STEP_DEGREES, 5), round(south + half + row * STEP_DEGREES, 5))
        for row in range(rows)
        for column in range(columns)
    ]


def look_up(client: httpx.Client, token: str, lon: float, lat: float) -> list[dict]:
    response = client.get(URL, params={"lat": lat, "lon": lon, "token": token}, headers=HEADERS)
    response.raise_for_status()
    answer = response.json()
    # The service sends false, or an error status, for a point it has no village for
    if answer is False or (isinstance(answer, dict) and "status" in answer):
        return []
    if not isinstance(answer, list):
        raise ValueError("Unexpected answer from the village service")
    return answer


def collect(location: dict, points: list[tuple[float, float]], raw_path: Path) -> dict:
    answers = json.loads(raw_path.read_text(encoding="utf-8")) if raw_path.exists() else {}
    missing = [point for point in points if f"{point[0]},{point[1]}" not in answers]
    print(f"{location['id']}: {len(points)} points, {len(missing)} still to look up", flush=True)
    if not missing:
        return answers

    token = read_secret("BHUVAN_VILLAGE_TOKEN")
    failures = 0
    with httpx.Client(timeout=25) as client:
        for number, (lon, lat) in enumerate(missing, 1):
            try:
                answers[f"{lon},{lat}"] = look_up(client, token, lon, lat)
                failures = 0
            except (httpx.HTTPError, ValueError) as error:
                # Only the error type is shown, because the full message contains the key
                failures += 1
                print(f"lookup failed at {lat},{lon}: {type(error).__name__}", flush=True)
                if failures >= MAX_FAILURES_IN_A_ROW:
                    raw_path.write_text(json.dumps(answers), encoding="utf-8")
                    raise SystemExit("Stopping after repeated failures. Run again to carry on.")
            if number % 20 == 0:
                raw_path.write_text(json.dumps(answers), encoding="utf-8")
                print(f"{number}/{len(missing)} done", flush=True)
            time.sleep(PAUSE_SECONDS)
    raw_path.write_text(json.dumps(answers), encoding="utf-8")
    return answers


def number_or_none(value) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def flood_trees(location: dict) -> dict[int, tuple[STRtree, list]]:
    trees = {}
    for rise in RISES_M:
        path = ROOT / "data" / "simulated" / location["id"] / f"flood_plus_{rise}m.geojson"
        geometry = shape(json.loads(path.read_text(encoding="utf-8"))["features"][0]["geometry"])
        parts = list(geometry.geoms)
        trees[rise] = (STRtree(parts), parts)
    return trees


def first_flood_level(point: Point, trees: dict) -> int | None:
    for rise in RISES_M:
        tree, _ = trees[rise]
        if len(tree.query(point, predicate="intersects")) > 0:
            return rise
    return None


def build_villages(location: dict, answers: dict) -> list[dict]:
    trees = flood_trees(location)
    timestamp = datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat(timespec="minutes")
    villages: dict[str, dict] = {}
    for key, records in answers.items():
        name = (records[0].get("name1") or "").strip() if records else ""
        if not name:
            continue
        lon, lat = (float(part) for part in key.split(","))
        level = first_flood_level(Point(lon, lat), trees)
        # The service names the village at the point, then returns every census village in
        # India with that name, so only a single match in the right district can be trusted
        matches = [
            record
            for record in records
            if (record.get("dhq_name") or "").strip().lower() == location["census_district"].lower()
            and (record.get("vid") or "").strip()
        ]
        record = matches[0] if len(matches) == 1 else None
        village_id = (record["vid"].strip() if record else "")
        entry = villages.setdefault(
            village_id or f"name:{name.lower()}",
            {"record": record, "name": name, "village_id": village_id, "points": [], "levels": []},
        )
        entry["points"].append((lon, lat))
        entry["levels"].append(level)

    features = []
    for entry in villages.values():
        record = entry["record"] or {}
        population = number_or_none(record.get("tot_p"))
        households = number_or_none(record.get("no_hh"))
        levels = [level for level in entry["levels"] if level is not None]
        lons, lats = zip(*entry["points"])
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(sum(lons) / len(lons), 5), round(sum(lats) / len(lats), 5)],
                },
                "properties": {
                    "kind": "simulated",
                    "name": entry["name"].title(),
                    "source": SOURCE,
                    "timestamp": timestamp,
                    "quality": QUALITY,
                    "village_id": entry["village_id"] or None,
                    "population_2001": population,
                    "households_2001": households,
                    "district": location["census_district"],
                    "taluk": (record.get("thq_name") or "").strip().title() or None,
                    "points_checked": len(entry["points"]),
                    "first_flooded_at_m": min(levels) if levels else None,
                },
            }
        )
    return sorted(features, key=lambda feature: feature["properties"]["name"])


def main() -> None:
    location_id = sys.argv[1] if len(sys.argv) > 1 else "simaluguri"
    location = next(item for item in load_locations() if item["id"] == location_id)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw_path = RAW_DIR / f"bhuvan_villages_{location_id}.json"

    points = grid_points(location["bbox"])
    boundary = load_boundary(location_id)
    if boundary is not None:
        points = [point for point in points if boundary.contains(Point(point))]
    answers = collect(location, points, raw_path)
    features = build_villages(location, answers)
    path = ROOT / "data" / "reference" / location_id / "villages.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")

    empty = sum(1 for records in answers.values() if not records)
    print(f"{len(answers)} points answered, {empty} with no village, {len(features)} villages found")
    for rise in RISES_M:
        reached = [
            feature["properties"]
            for feature in features
            if (feature["properties"]["first_flooded_at_m"] or 99) <= rise
        ]
        people = sum(item["population_2001"] or 0 for item in reached)
        unknown = sum(item["population_2001"] is None for item in reached)
        print(f"+{rise} m: {len(reached)} villages with flooded land, {people} people (2001), {unknown} with no count")


if __name__ == "__main__":
    main()
