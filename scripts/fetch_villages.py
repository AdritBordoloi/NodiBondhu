"""Find census villages across a location with Bhuvan's village services and link them to flood scenarios.

Run: python scripts/fetch_villages.py simaluguri
The reverse lookup names the village at each point, and needs BHUVAN_VILLAGE_TOKEN in backend/.env.
The village geocode then gives census records with positions for each name, and needs
BHUVAN_VILLAGE_GEOCODE_TOKEN. Answers are saved, so a stopped run carries on where it left off,
and a run with no new lookups only rebuilds the output file.
"""
import json
import math
import re
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
CENSUS_URL = "https://bhuvan-app1.nrsc.gov.in/api/api_proximity/curl_village_geocode.php"
HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}

STEP_DEGREES = 0.01  # about 1 km
PAUSE_SECONDS = 0.5
CENSUS_PAUSE_SECONDS = 0.2
MAX_MATCH_KM = 3  # a census position further than this from the point is a different village
CLEAR_MATCH_RATIO = 1.5  # the next census record must be this much further away
MAX_FAILURES_IN_A_ROW = 5
RISES_M = (1, 2, 3, 4, 5, 6)
# The village layer also names railway stations and forest land, which are not villages
NOT_A_VILLAGE = re.compile(r"^forest$|\brly\b|\bstation\b", re.IGNORECASE)
SOURCE = "Census 2001 village data from the Bhuvan API, NRSC/ISRO"
QUALITY = (
    "Census from 2001, so about 25 years old. Found by checking points about 1 km apart, so small "
    "villages can be missed. Population is matched by village name and nearby census position "
    "within the district, so it is left blank when no clear match exists, and a match can still "
    "be wrong. It is the whole village, not the number of people flooded. Village position is "
    "approximate"
)


def grid_points(bbox: list[float], step: float) -> list[tuple[float, float]]:
    west, south, east, north = bbox
    columns = math.floor((east - west) / step)
    rows = math.floor((north - south) / step)
    half = step / 2
    return [
        (round(west + half + column * step, 5), round(south + half + row * step, 5))
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


def collect_census(location: dict, names: list[str], raw_path: Path) -> dict:
    answers = json.loads(raw_path.read_text(encoding="utf-8")) if raw_path.exists() else {}
    missing = [name for name in names if name not in answers]
    print(f"{location['id']}: {len(names)} names, {len(missing)} still to look up in the census", flush=True)
    if not missing:
        return answers

    token = read_secret("BHUVAN_VILLAGE_GEOCODE_TOKEN")
    failures = 0
    with httpx.Client(timeout=25) as client:
        for number, name in enumerate(missing, 1):
            try:
                response = client.get(CENSUS_URL, params={"village": name, "token": token}, headers=HEADERS)
                response.raise_for_status()
                answer = response.json()
                answers[name] = answer if isinstance(answer, list) else []
                failures = 0
            except (httpx.HTTPError, ValueError) as error:
                # Only the error type is shown, because the full message contains the key
                failures += 1
                print(f"census lookup failed for {name}: {type(error).__name__}", flush=True)
                if failures >= MAX_FAILURES_IN_A_ROW:
                    raw_path.write_text(json.dumps(answers), encoding="utf-8")
                    raise SystemExit("Stopping after repeated failures. Run again to carry on.")
            if number % 50 == 0:
                raw_path.write_text(json.dumps(answers), encoding="utf-8")
                print(f"{number}/{len(missing)} done", flush=True)
            time.sleep(CENSUS_PAUSE_SECONDS)
    raw_path.write_text(json.dumps(answers), encoding="utf-8")
    return answers


def km_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot((a[0] - b[0]) * 111.32 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110.57)


def census_position(record: dict) -> tuple[float, float] | None:
    try:
        return float(record["longitude"]), float(record["latitude"])
    except (KeyError, TypeError, ValueError):
        return None


def nearest_census(point: tuple[float, float], records: list[dict]) -> dict | None:
    """Tell same-named villages apart by position, and give no match when it isn't clear."""
    placed = sorted(
        (km_between(point, census_position(record)), index)
        for index, record in enumerate(records)
        if census_position(record)
    )
    if not placed or placed[0][0] > MAX_MATCH_KM:
        return None
    if len(placed) > 1 and placed[1][0] < placed[0][0] * CLEAR_MATCH_RATIO:
        return None
    return records[placed[0][1]]


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


def census_details(record: dict) -> dict:
    male_literate = number_or_none(record.get("m_lit"))
    female_literate = number_or_none(record.get("f_lit"))
    return {
        "population": record.get("tot_p"),
        "households": record.get("no_hh"),
        "male": record.get("tot_m"),
        "female": record.get("tot_f"),
        "scheduled_caste": record.get("p_sc"),
        "scheduled_tribe": record.get("p_st"),
        "literate": (
            male_literate + female_literate
            if male_literate is not None and female_literate is not None
            else None
        ),
    }


def build_villages(location: dict, answers: dict, census: dict) -> list[dict]:
    district = location["census_district"].lower()
    trees = flood_trees(location)
    timestamp = datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat(timespec="minutes")
    villages: dict[str, dict] = {}
    for key, records in answers.items():
        name = (records[0].get("name1") or "").strip() if records else ""
        if not name or NOT_A_VILLAGE.search(name):
            continue
        lon, lat = (float(part) for part in key.split(","))
        level = first_flood_level(Point(lon, lat), trees)
        local = [
            candidate
            for candidate in census.get(name.lower(), [])
            if (candidate.get("dist_name") or "").strip().lower() == district
        ]
        record = None
        if local:
            found = nearest_census((lon, lat), local)
            if found:
                position = census_position(found)
                record = {
                    **census_details(found),
                    "key": f"{position[0]},{position[1]}",
                    "taluk": found.get("tehs_name"),
                    "position": position,
                }
        else:
            # The reverse lookup returns every census village in India with this name, so
            # without a position only a single match in the right district can be trusted
            matches = [
                candidate
                for candidate in records
                if (candidate.get("dhq_name") or "").strip().lower() == district
                and (candidate.get("vid") or "").strip()
            ]
            if len(matches) == 1:
                record = {
                    **census_details(matches[0]),
                    "key": matches[0]["vid"].strip(),
                    "taluk": matches[0].get("thq_name"),
                    "position": None,
                }
        entry = villages.setdefault(
            record["key"] if record else f"name:{name.lower()}",
            {"record": record, "name": name, "points": [], "levels": []},
        )
        entry["points"].append((lon, lat))
        entry["levels"].append(level)

    # A point with no clear census match usually belongs to a same-named village close by
    for key, entry in list(villages.items()):
        if entry["record"]:
            continue
        same_name = [
            other
            for other in villages.values()
            if other["record"] and other["name"].lower() == entry["name"].lower()
        ]
        if not same_name:
            continue
        kept = []
        for point, level in zip(entry["points"], entry["levels"]):
            distance, closest = min(
                ((min(km_between(point, other_point) for other_point in other["points"]), index)
                 for index, other in enumerate(same_name)),
            )
            if distance <= MAX_MATCH_KM:
                same_name[closest]["points"].append(point)
                same_name[closest]["levels"].append(level)
            else:
                kept.append((point, level))
        if kept:
            entry["points"], entry["levels"] = (list(values) for values in zip(*kept))
        else:
            del villages[key]

    features = []
    for entry in villages.values():
        record = entry["record"] or {}
        population = number_or_none(record.get("population"))
        households = number_or_none(record.get("households"))
        levels = [level for level in entry["levels"] if level is not None]
        lons, lats = zip(*entry["points"])
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": list(
                        record.get("position")
                        or (round(sum(lons) / len(lons), 5), round(sum(lats) / len(lats), 5))
                    ),
                },
                "properties": {
                    "kind": "simulated",
                    "name": entry["name"].title(),
                    "source": SOURCE,
                    "timestamp": timestamp,
                    "quality": QUALITY,
                    "population_2001": population,
                    "households_2001": households,
                    "male_2001": number_or_none(record.get("male")),
                    "female_2001": number_or_none(record.get("female")),
                    "scheduled_caste_2001": number_or_none(record.get("scheduled_caste")),
                    "scheduled_tribe_2001": number_or_none(record.get("scheduled_tribe")),
                    "literate_2001": number_or_none(record.get("literate")),
                    "village_key": record.get("key") or f"name:{entry['name'].lower()}",
                    "district": location["census_district"],
                    "taluk": (record.get("taluk") or "").strip().title() or None,
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

    points = grid_points(location["bbox"], location.get("village_step_degrees", STEP_DEGREES))
    boundary = load_boundary(location_id)
    if boundary is not None:
        points = [point for point in points if boundary.contains(Point(point))]
    answers = collect(location, points, raw_path)
    names = sorted({(records[0].get("name1") or "").strip().lower() for records in answers.values() if records} - {""})
    census = collect_census(location, names, RAW_DIR / f"bhuvan_census_{location_id}.json")
    features = build_villages(location, answers, census)
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
