"""Areas shared by the data scripts.

The model runs on a full grid, then each location on that grid is cut out of it, so a river
just outside a small location still counts. Locations far apart use separate grids.
"""
import json
import math
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union

# West, south, east, north
GRIDS = {
    "upper_assam": (94.40, 26.65, 95.00, 27.20),
    "barak_valley": (92.05, 24.55, 92.70, 25.05),
}

LOCATIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "reference" / "locations.json"


def load_locations() -> list[dict]:
    return json.loads(LOCATIONS_FILE.read_text(encoding="utf-8"))


def load_boundary(location_id: str):
    """A location near a border can limit its results to the land inside this shape."""
    path = LOCATIONS_FILE.parent / location_id / "boundary.geojson"
    if not path.exists():
        return None
    features = json.loads(path.read_text(encoding="utf-8"))["features"]
    return unary_union([shape(feature["geometry"]) for feature in features])


def dem_tile_names(grid: str) -> list[str]:
    """Copernicus DEM tiles covering a grid, for northern and eastern hemispheres."""
    west, south, east, north = GRIDS[grid]
    return [
        f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
        for lat in range(math.floor(south), math.ceil(north))
        for lon in range(math.floor(west), math.ceil(east))
    ]


def read_secret(name: str) -> str:
    """Read an API key from backend/.env, which Git ignores."""
    path = Path(__file__).resolve().parent.parent / "backend" / ".env"
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if line.startswith(f"{name}="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"{name} is missing from backend/.env")
