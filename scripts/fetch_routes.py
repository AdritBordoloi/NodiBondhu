"""Find main road routes with Bhuvan's shortest path API and measure them against the flood scenarios.

Run: python scripts/fetch_routes.py [location]
With no location, it runs every location. Needs BHUVAN_ROUTING_TOKEN in backend/.env. Answers
are saved, so a run with no new lookups only rebuilds the output file and needs no key.
"""
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import shapely
from shapely.geometry import LineString, MultiLineString, Point, box, mapping, shape
from shapely.ops import linemerge, unary_union

from pilot_area import load_boundary, load_locations, read_secret

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
URL = "https://bhuvan-app1.nrsc.gov.in/api/routing/curl_routing_state.php"
HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}

RISES_M = (1, 2, 3, 4, 5, 6)
MAX_SNAP_KM = 3
COORDINATE_DIGITS = 5  # about 1 m
SOURCE = "Road route from the Bhuvan Shortest Path API, NRSC/ISRO; flood area from NodiBondhu HAND model"
QUALITY = (
    "Shortest route by distance, and the service cannot avoid floodwater, so this is not a "
    "recommended route. In the flood area does not mean the road is closed, because raised roads "
    "can stay dry and the model ignores embankments and bridges. The flood model has not been "
    "checked against a real flood. Date of the road data is not known"
)

# Both ends must be in the same state, and each name must be a place in OpenStreetMap
ROUTES = {
    "simaluguri": (("Simaluguri", "Sivasagar"), ("Simaluguri", "Nazira"), ("Simaluguri", "Dimow")),
    "sivasagar": (
        ("Sivasagar", "Simaluguri"),
        ("Sivasagar", "Amguri"),
        ("Sivasagar", "Gaurisagar Tiniali"),
        ("Sivasagar", "Moranhat"),
        ("Sivasagar", "Jorhat"),
        ("Sivasagar", "Dibrugarh"),
    ),
    "karimganj": (
        ("Karimganj", "Nilambazar"),
        ("Karimganj", "Fakira Bazar"),
        ("Karimganj", "Badarpur"),
        ("Karimganj", "Silchar"),
    ),
}

# Nearby cities outside the model grids. City nodes from OpenStreetMap, longitude then latitude
OUTSIDE_PLACES = {
    "Jorhat": (94.2079645, 26.7577925),
    "Dibrugarh": (94.9019447, 27.4844597),
    "Silchar": (92.7971480, 24.8295880),
}


def place_coordinates(grid: str) -> dict[str, tuple[float, float]]:
    elements = json.loads((RAW_DIR / f"osm_{grid}.json").read_text(encoding="utf-8"))
    places = dict(OUTSIDE_PLACES)
    for element in elements:
        if element["type"] == "node":
            places.setdefault(element["tags"]["name"], (element["lon"], element["lat"]))
    return places


def look_up(client: httpx.Client, token: str, start, end) -> dict:
    response = client.get(
        URL,
        params={"lat1": start[1], "lon1": start[0], "lat2": end[1], "lon2": end[0], "token": token},
        headers=HEADERS,
    )
    response.raise_for_status()
    answer = response.json()
    if isinstance(answer, list) and answer:
        answer = answer[0]
    if not isinstance(answer, dict) or not answer.get("features"):
        raise ValueError("The routing service has no route for this trip")
    return answer


def collect(location_id: str, trips: list[tuple[str, tuple, tuple]], raw_path: Path) -> dict:
    answers = json.loads(raw_path.read_text(encoding="utf-8")) if raw_path.exists() else {}
    missing = [trip for trip in trips if trip[0] not in answers]
    print(f"{location_id}: {len(trips)} routes, {len(missing)} still to look up", flush=True)
    if not missing:
        return answers
    token = read_secret("BHUVAN_ROUTING_TOKEN")
    with httpx.Client(timeout=45) as client:
        for name, start, end in missing:
            try:
                answers[name] = look_up(client, token, start, end)
            except (httpx.HTTPError, ValueError) as error:
                # Only the error type is shown, because the full message contains the key
                print(f"lookup failed for {name}: {type(error).__name__}", flush=True)
    raw_path.write_text(json.dumps(answers), encoding="utf-8")
    return answers


def route_line(answer: dict):
    lines = [
        shape(feature["geometry"])
        for feature in answer["features"]
        if feature.get("geometry") and "Line" in feature["geometry"]["type"]
    ]
    return linemerge(unary_union(lines))


def rounded(line):
    def round_part(part):
        return LineString([(round(x, COORDINATE_DIGITS), round(y, COORDINATE_DIGITS)) for x, y in part.coords])

    if line.geom_type == "LineString":
        return round_part(line)
    return MultiLineString([round_part(part) for part in line.geoms if part.geom_type == "LineString"])


def build(location: dict, trips: list, answers: dict) -> list[dict]:
    west, south, east, north = location["bbox"]
    x_km = 111.32 * math.cos(math.radians((south + north) / 2))

    def length_km(geometry) -> float:
        return shapely.transform(geometry, lambda points: points * (x_km, 110.57)).length

    mapped_area = box(west, south, east, north)
    boundary = load_boundary(location["id"])
    if boundary is not None:
        mapped_area = mapped_area.intersection(boundary)

    floods = {}
    for rise in RISES_M:
        path = ROOT / "data" / "simulated" / location["id"] / f"flood_plus_{rise}m.geojson"
        floods[rise] = shape(json.loads(path.read_text(encoding="utf-8"))["features"][0]["geometry"]).buffer(0)

    timestamp = datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat(timespec="minutes")
    features = []
    for name, start, end in trips:
        if name not in answers:
            continue
        line = route_line(answers[name])
        closest_start = line.distance(Point(start)) * x_km
        closest_end = line.distance(Point(end)) * x_km
        if max(closest_start, closest_end) > MAX_SNAP_KM:
            print(f"skipped {name}: route ends {max(closest_start, closest_end):.1f} km from the place")
            continue
        properties = {
            "kind": "simulated",
            "name": name,
            "source": SOURCE,
            "timestamp": timestamp,
            "quality": QUALITY,
            "segment": "route",
            "length_km": round(length_km(line), 1),
            "mapped_km": round(length_km(line.intersection(mapped_area)), 1),
        }
        flooded_parts = {rise: line.intersection(floods[rise]) for rise in RISES_M}
        for rise in RISES_M:
            properties[f"flooded_km_{rise}"] = round(length_km(flooded_parts[rise]), 1)
        features.append({"type": "Feature", "geometry": mapping(rounded(line)), "properties": properties})
        for rise in RISES_M:
            part = flooded_parts[rise]
            if part.is_empty:
                continue
            lines = [piece for piece in getattr(part, "geoms", [part]) if piece.geom_type == "LineString"]
            features.append(
                {
                    "type": "Feature",
                    "geometry": mapping(rounded(MultiLineString(lines))),
                    "properties": {"segment": "flooded", "name": name, "rise_m": rise},
                }
            )
        print(
            f"{name}: {properties['length_km']} km, {properties['mapped_km']} km mapped, ends within "
            f"{closest_start:.1f} and {closest_end:.1f} km, flooded "
            + ", ".join(f"+{rise}: {properties[f'flooded_km_{rise}']}" for rise in RISES_M)
        )
    return features


def main() -> None:
    wanted = sys.argv[1:]
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for location in load_locations():
        if wanted and location["id"] not in wanted:
            continue
        places = place_coordinates(location["grid"])
        trips = [
            (f"{start} to {end}", places[start], places[end])
            for start, end in ROUTES[location["id"]]
        ]
        answers = collect(location["id"], trips, RAW_DIR / f"bhuvan_routes_{location['id']}.json")
        features = build(location, trips, answers)
        path = ROOT / "data" / "reference" / location["id"] / "routes.geojson"
        path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
        print(f"{location['id']}: {path.stat().st_size / 1000:.0f} KB")


if __name__ == "__main__":
    main()
