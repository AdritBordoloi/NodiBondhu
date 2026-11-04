"""Download rivers and settlements for the pilot area from OpenStreetMap."""
import json
from pathlib import Path

import httpx

from pilot_area import EAST, NORTH, SOUTH, WEST

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"

QUERY = f"""
[out:json][timeout:120][bbox:{SOUTH},{WEST},{NORTH},{EAST}];
(
  way["waterway"="river"];
  way["waterway"="riverbank"];
  way["natural"="water"]["water"="river"];
  relation["natural"="water"]["water"="river"];
  node["place"~"^(city|town|suburb|village|hamlet)$"]["name"];
);
out geom;
"""


SERVERS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)


def download() -> list[dict]:
    last_error: Exception | None = None
    for server in SERVERS:
        try:
            response = httpx.post(
                server,
                data={"data": QUERY},
                headers={"User-Agent": "NodiBondhu-hackathon-prototype"},
                timeout=180,
            )
            response.raise_for_status()
            result = response.json()
            # A timed-out query still answers 200, with partial data and a remark
            if "remark" in result:
                raise ValueError(f"Partial result: {result['remark']}")
            return result["elements"]
        except (httpx.HTTPError, ValueError, KeyError) as error:
            print(f"{server} failed: {error}")
            last_error = error
    raise RuntimeError("All OpenStreetMap servers failed") from last_error


def main() -> None:
    elements = download()
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    (RAW_DIR / "osm.json").write_text(json.dumps(elements), encoding="utf-8")
    counts: dict[str, int] = {}
    for element in elements:
        counts[element["type"]] = counts.get(element["type"], 0) + 1
    print(counts)


if __name__ == "__main__":
    main()
