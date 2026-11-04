"""Areas shared by the data scripts.

The model always runs on the full grid below, then each location is cut out of it,
so a river just outside a small location still counts.
"""
import json
from pathlib import Path

WEST, SOUTH, EAST, NORTH = 94.40, 26.65, 95.00, 27.20

LOCATIONS_FILE = Path(__file__).resolve().parent.parent / "data" / "reference" / "locations.json"


def load_locations() -> list[dict]:
    return json.loads(LOCATIONS_FILE.read_text(encoding="utf-8"))
