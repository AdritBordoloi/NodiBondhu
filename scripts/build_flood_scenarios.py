"""Build what-if flood scenarios for the pilot area using Height Above Nearest River.

Each cell's height is compared with the nearest river cell. A cell floods in a
scenario when it is within the water rise of that river cell and is connected to
the river through other flooded cells. This is a fast screening method, not a
hydraulic model: it ignores flow, timing, embankments and channel changes.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize, shapes
from rasterio.merge import merge
from rasterio.transform import rowcol
from scipy import ndimage
from shapely.geometry import LineString, MultiPolygon, mapping, shape
from shapely.ops import polygonize, unary_union

from pilot_area import EAST, NORTH, SOUTH, WEST

ROOT =Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
SIMULATED_DIR = ROOT / "data" / "simulated"
REFERENCE_DIR = ROOT / "data" / "reference"

CELL_DEGREES = 1 / 1200  # 3 arc-seconds, about 90 m
RISES_M = (1, 2, 3, 4, 5, 6)
MIN_POLYGON_KM2 = 0.05
SIMPLIFY_DEGREES = 0.0004

DEM_SOURCE = "Copernicus DEM GLO-30"
RIVER_SOURCE = "OpenStreetMap contributors"
QUALITY = (
    "Screening estimate only. Terrain is a surface model with several metres of vertical error "
    "on flat land. Ignores embankments, flow, timing and channel changes. Not checked against "
    "a real flood yet"
)


def load_dem():
    sources = [rasterio.open(path) for path in sorted(RAW_DIR.glob("Copernicus_DSM_*.tif"))]
    dem, transform = merge(
        sources,
        bounds=(WEST, SOUTH, EAST, NORTH),
        res=CELL_DEGREES,
        resampling=Resampling.bilinear,
    )
    for source in sources:
        source.close()
    return dem[0].astype("float64"), transform


def river_geometries(elements):
    geometries = []
    for element in elements:
        if element["type"] == "way" and len(element.get("geometry", [])) >= 2:
            coordinates = [(point["lon"], point["lat"]) for point in element["geometry"]]
            line = LineString(coordinates)
            is_area = element["tags"].get("waterway") != "river" and coordinates[0] == coordinates[-1]
            geometries += list(polygonize([line])) if is_area else [line]
        elif element["type"] == "relation":
            outers = [
                LineString([(point["lon"], point["lat"]) for point in member["geometry"]])
                for member in element.get("members", [])
                if member.get("role") == "outer" and len(member.get("geometry", [])) >= 2
            ]
            geometries += list(polygonize(unary_union(outers))) if outers else []
    return geometries


def main() -> None:
    dem, transform = load_dem()
    elements = json.loads((RAW_DIR / "osm.json").read_text(encoding="utf-8"))

    river = rasterize(
        [(geometry, 1) for geometry in river_geometries(elements)],
        out_shape=dem.shape,
        transform=transform,
        all_touched=True,
        dtype="uint8",
    ).astype(bool)
    print(f"grid {dem.shape}, river cells {river.sum()} ({river.mean():.1%})")

    nearest = ndimage.distance_transform_edt(~river, return_distances=False, return_indices=True)
    height_above_river = np.clip(dem - dem[nearest[0], nearest[1]], 0, None)

    lat_mid = math.radians((SOUTH + NORTH) / 2)
    cell_km2 = (CELL_DEGREES * 111.32) ** 2 * math.cos(lat_mid)

    first_flooded = np.full(dem.shape, np.nan)
    timestamp = datetime.now(timezone(timedelta(hours=5, minutes=30))).isoformat(timespec="minutes")
    SIMULATED_DIR.mkdir(parents=True, exist_ok=True)
    REFERENCE_DIR.mkdir(parents=True, exist_ok=True)

    masks = {}
    for rise in RISES_M:
        labels, _ = ndimage.label((height_above_river <= rise) | river)
        connected_labels = np.unique(labels[river])
        flooded = np.isin(labels, connected_labels[connected_labels > 0]) & ~river
        first_flooded[flooded & np.isnan(first_flooded)] = rise
        masks[rise] = flooded

    # Settlements on river islands sit inside the mapped channel, so they flood first
    first_flooded[river] = RISES_M[0]

    settlements = []
    for element in elements:
        if element["type"] != "node":
            continue
        row, col = rowcol(transform, element["lon"], element["lat"])
        if not (0 <= row < dem.shape[0] and 0 <= col < dem.shape[1]):
            continue
        value = first_flooded[row, col]
        settlements.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [element["lon"], element["lat"]]},
                "properties": {
                    "kind": "simulated",
                    "name": element["tags"]["name"],
                    "source": f"Location from {RIVER_SOURCE}; flood level from NodiBondhu HAND model",
                    "timestamp": timestamp,
                    "quality": QUALITY,
                    "place": element["tags"]["place"],
                    "first_flooded_at_m": None if np.isnan(value) else int(value),
                },
            }
        )
    (REFERENCE_DIR / "settlements.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": settlements}), encoding="utf-8"
    )

    for rise, flooded in masks.items():
        polygons = [
            shape(geometry)
            for geometry, value in shapes(flooded.astype("uint8"), mask=flooded, transform=transform)
            if value == 1
        ]
        min_degrees2 = MIN_POLYGON_KM2 / (111.32**2 * math.cos(lat_mid))
        polygons = [polygon for polygon in polygons if polygon.area >= min_degrees2]
        merged = unary_union(polygons).simplify(SIMPLIFY_DEGREES).buffer(0)
        if merged.geom_type == "Polygon":
            merged = MultiPolygon([merged])
        affected = sum(
            1
            for settlement in settlements
            if (settlement["properties"]["first_flooded_at_m"] or 99) <= rise
        )
        area = round(float(flooded.sum()) * cell_km2, 1)
        feature = {
            "type": "Feature",
            "geometry": mapping(merged),
            "properties": {
                "kind": "simulated",
                "name": f"Scenario: rivers {rise} m above the terrain data's water surface",
                "source": f"NodiBondhu HAND model using {DEM_SOURCE} and rivers from {RIVER_SOURCE}",
                "timestamp": timestamp,
                "quality": QUALITY,
                "rise_m": rise,
                "flooded_area_km2": area,
                "settlements_affected": affected,
            },
        }
        path = SIMULATED_DIR / f"flood_plus_{rise}m.geojson"
        path.write_text(
            json.dumps({"type": "FeatureCollection", "features": [feature]}), encoding="utf-8"
        )
        print(
            f"+{rise} m: {area} km2, {affected}/{len(settlements)} settlements, "
            f"{path.stat().st_size / 1e6:.2f} MB"
        )


if __name__ == "__main__":
    main()
