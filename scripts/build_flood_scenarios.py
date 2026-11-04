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
from rasterio.windows import Window
from rasterio.windows import transform as window_transform
from scipy import ndimage
from shapely import set_precision
from shapely.geometry import LineString, MultiPolygon, mapping, shape
from shapely.ops import polygonize, unary_union

from pilot_area import EAST, NORTH, SOUTH, WEST, load_locations

ROOT =Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
SIMULATED_DIR = ROOT / "data" / "simulated"
REFERENCE_DIR = ROOT / "data" / "reference"

CELL_DEGREES = 1 / 1200  # 3 arc-seconds, about 90 m
RISES_M = (1, 2, 3, 4, 5, 6)
MIN_POLYGON_KM2 = 0.05
SIMPLIFY_DEGREES = 0.0004
COORDINATE_DEGREES = 0.00001  # about 1 m, far finer than the 90 m grid

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

    masks = {}
    for rise in RISES_M:
        labels, _ = ndimage.label((height_above_river <= rise) | river)
        connected_labels = np.unique(labels[river])
        flooded = np.isin(labels, connected_labels[connected_labels > 0]) & ~river
        first_flooded[flooded & np.isnan(first_flooded)] = rise
        masks[rise] = flooded

    # Settlements on river islands sit inside the mapped channel, so they flood first
    first_flooded[river] = RISES_M[0]

    for location in load_locations():
        write_location(location, masks, first_flooded, elements, transform, cell_km2, timestamp)


def write_location(location, masks, first_flooded, elements, transform, cell_km2, timestamp) -> None:
    """Cut one location out of the full grid and write its scenario and settlement files."""
    west, south, east, north = location["bbox"]
    # Python slices wrap on negative indexes, which would silently give wrong numbers
    if not (WEST <= west < east <= EAST and SOUTH <= south < north <= NORTH):
        raise ValueError(f"{location['id']} bbox {location['bbox']} is outside the model grid")
    col_start = round((west - transform.c) / transform.a)
    col_end = round((east - transform.c) / transform.a)
    row_start = round((north - transform.f) / transform.e)
    row_end = round((south - transform.f) / transform.e)
    window = Window(col_start, row_start, col_end - col_start, row_end - row_start)
    location_transform = window_transform(window, transform)

    simulated_dir = SIMULATED_DIR / location["id"]
    reference_dir = REFERENCE_DIR / location["id"]
    simulated_dir.mkdir(parents=True, exist_ok=True)
    reference_dir.mkdir(parents=True, exist_ok=True)

    min_degrees2 = MIN_POLYGON_KM2 / (111.32**2 * math.cos(math.radians((SOUTH + NORTH) / 2)))
    settlements = []
    for element in elements:
        if element["type"] != "node":
            continue
        if not (west <= element["lon"] <= east and south <= element["lat"] <= north):
            continue
        row, col = rowcol(transform, element["lon"], element["lat"])
        if not (0 <= row < first_flooded.shape[0] and 0 <= col < first_flooded.shape[1]):
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
    (reference_dir / "settlements.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": settlements}), encoding="utf-8"
    )

    for rise, full_mask in masks.items():
        flooded = full_mask[row_start:row_end, col_start:col_end]
        polygons = [
            shape(geometry)
            for geometry, value in shapes(
                flooded.astype("uint8"), mask=flooded, transform=location_transform
            )
            if value == 1
        ]
        polygons = [polygon for polygon in polygons if polygon.area >= min_degrees2]
        merged = set_precision(
            unary_union(polygons).simplify(SIMPLIFY_DEGREES).buffer(0), COORDINATE_DEGREES
        )
        if merged.is_empty:
            merged = MultiPolygon()
        elif merged.geom_type == "Polygon":
            merged = MultiPolygon([merged])
        elif merged.geom_type != "MultiPolygon":
            # Rounding can leave stray lines, which a flood area does not need
            merged = MultiPolygon(
                [part for part in merged.geoms if part.geom_type == "Polygon"]
            )
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
                "name": (
                    f"{location['name']} scenario: rivers {rise} m above the terrain data's "
                    "water surface"
                ),
                "source": f"NodiBondhu HAND model using {DEM_SOURCE} and rivers from {RIVER_SOURCE}",
                "timestamp": timestamp,
                "quality": QUALITY,
                "rise_m": rise,
                "flooded_area_km2": area,
                "settlements_affected": affected,
            },
        }
        path = simulated_dir / f"flood_plus_{rise}m.geojson"
        path.write_text(
            json.dumps({"type": "FeatureCollection", "features": [feature]}), encoding="utf-8"
        )
        print(
            f"{location['id']} +{rise} m: {area} km2, {affected}/{len(settlements)} settlements, "
            f"{path.stat().st_size / 1e6:.2f} MB"
        )


if __name__ == "__main__":
    main()
