"""Download rivers and settlements for the model grids from OpenStreetMap.

Run: python scripts/fetch_osm.py [grid]
With no grid name, it downloads every grid.
"""
import json
import sys
from pathlib import Path

import httpx

from pilot_area import GRIDS

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"

SERVERS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)


def query_for(grid: str) -> str:
    west, south, east, north = GRIDS[grid]
    return f"""
[out:json][timeout:120][bbox:{south},{west},{north},{east}];
(
  way["waterway"="river"];
  way["waterway"="riverbank"];
  way["natural"="water"]["water"="river"];
  relation["natural"="water"]["water"="river"];
  node["place"~"^(city|town|suburb|village|hamlet)$"]["name"];
);
out geom;
"""


def download(grid: str) -> list[dict]:
    last_error: Exception | None = None
    for server in SERVERS:
        try:
            response = httpx.post(
                server,
                data={"data": query_for(grid)},
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
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for grid in sys.argv[1:] or GRIDS:
        elements = download(grid)
        (RAW_DIR / f"osm_{grid}.json").write_text(json.dumps(elements), encoding="utf-8")
        counts: dict[str, int] = {}
        for element in elements:
            counts[element["type"]] = counts.get(element["type"], 0) + 1
        print(grid, counts)


if __name__ == "__main__":
    main()
