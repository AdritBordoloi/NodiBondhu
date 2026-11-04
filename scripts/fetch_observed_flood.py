"""Map a real flood from Sentinel-1 radar and check the flood scenarios against it.

Run: python scripts/fetch_observed_flood.py
Radar sees open water as dark. A cell counts as flooded when it is dark just after the flood and
much darker than an earlier image from the same radar track. No account is needed. Radar images are saved in data/raw, so a later run
only redoes the mapping.
"""
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize, shapes
from rasterio.transform import rowcol
from rasterio.vrt import WarpedVRT
from scipy import ndimage
from shapely import set_precision
from shapely.geometry import MultiPolygon, box, mapping, shape
from shapely.ops import unary_union

from build_flood_scenarios import MIN_POLYGON_KM2, RISES_M, SIMPLIFY_DEGREES, COORDINATE_DEGREES, load_dem
from pilot_area import GRIDS, load_boundary, load_locations

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
TOKEN_URL = "https://planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-1-rtc"
HEADERS = {"User-Agent": "NodiBondhu-hackathon-prototype"}
IST = timezone(timedelta(hours=5, minutes=30))

# Each pair of images comes from the same satellite track, so they can be compared directly
EVENTS = {
    "upper_assam": {
        "orbit": 70,
        "flood_date": "2026-07-22",
        "before_date": "2026-07-10",
        "event": "19 July 2026 flood in Sivasagar and Nazira",
        "note": "Compared with just before the flood, so water already there, such as wet rice fields, is left out",
    },
    "barak_valley": {
        "orbit": 77,
        "flood_date": "2026-07-22",
        # This area already held about as much water on 10 July, so a comparison with that date
        # shows almost nothing. It is compared with the dry season instead
        "before_date": "2026-02-09",
        "event": "July 2026 flood on the Kushiyara, above danger level at Karimganj on 22 July",
        "note": "Compared with the dry season, so this can include wet rice fields and seasonal wetlands as well as flood water",
    },
}
DARK_DB = -15.0  # open water is usually darker than this
DROP_DB = 3.0  # how much darker a cell must become
MAX_SLOPE_DEGREES = 5.0  # hill shadows also look dark
MIN_CELLS = 4  # about 3 hectares a cell, which removes radar noise

SOURCE = "Copernicus Sentinel-1 radar (RTC) from Microsoft Planetary Computer, mapped by NodiBondhu"
QUALITY = (
    "Satellite observation from one moment, which can miss the peak and water that had already "
    "drained. Radar cannot see water under trees, tea gardens or in built-up areas, so real "
    "flooding was larger. Thresholds are simple and have not been checked on the ground"
)

GDAL_OPTIONS = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MAX_RETRY": "4",
    "GDAL_HTTP_RETRY_DELAY": "2",
    "VSI_CACHE": "TRUE",
}


def find_scenes(client: httpx.Client, grid: str, date: str, orbit: int) -> list[dict]:
    response = client.post(
        STAC_URL,
        json={
            "collections": ["sentinel-1-rtc"],
            "bbox": list(GRIDS[grid]),
            "datetime": f"{date}T00:00:00Z/{date}T23:59:59Z",
            "query": {"sat:relative_orbit": {"eq": orbit}},
            "limit": 10,
        },
    )
    response.raise_for_status()
    scenes = response.json()["features"]
    if not scenes:
        raise SystemExit(f"No radar image for {grid} on {date}")
    return scenes


def read_radar(scenes: list[dict], token: str, transform, shape_: tuple[int, int]) -> np.ndarray:
    """Average the radar image onto the model grid, in decibels."""
    total = np.zeros(shape_, dtype="float64")
    count = np.zeros(shape_, dtype="float64")
    with rasterio.Env(**GDAL_OPTIONS):
        for scene in scenes:
            href = f"{scene['assets']['vv']['href']}?{token}"
            with rasterio.open(href) as source, WarpedVRT(
                source,
                crs="EPSG:4326",
                transform=transform,
                width=shape_[1],
                height=shape_[0],
                resampling=Resampling.average,
                src_nodata=source.nodata if source.nodata is not None else 0,
                nodata=np.nan,
                dtype="float32",
            ) as view:
                values = view.read(1)
            good = np.isfinite(values) & (values > 0)
            total[good] += values[good]
            count[good] += 1
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(np.where(count > 0, total / count, np.nan))


def load_images(client, grid, event, transform, shape_) -> tuple[np.ndarray, np.ndarray, str, str]:
    path = RAW_DIR / f"sentinel1_{grid}.npz"
    if path.exists():
        saved = np.load(path)
        return saved["flood"], saved["before"], str(saved["flood_time"]), str(saved["before_time"])
    token = client.get(TOKEN_URL).raise_for_status().json()["token"]
    flood_scenes = find_scenes(client, grid, event["flood_date"], event["orbit"])
    before_scenes = find_scenes(client, grid, event["before_date"], event["orbit"])
    print(f"{grid}: reading {len(flood_scenes)} flood and {len(before_scenes)} earlier images", flush=True)
    flood = read_radar(flood_scenes, token, transform, shape_)
    before = read_radar(before_scenes, token, transform, shape_)
    flood_time = flood_scenes[0]["properties"]["datetime"]
    before_time = before_scenes[0]["properties"]["datetime"]
    np.savez_compressed(path, flood=flood, before=before, flood_time=flood_time, before_time=before_time)
    return flood, before, flood_time, before_time


def slope_degrees(dem: np.ndarray, north: float, south: float) -> np.ndarray:
    cell_y = 110.57 * 1000 / 1200
    cell_x = 111.32 * 1000 / 1200 * math.cos(math.radians((north + south) / 2))
    dz_dy, dz_dx = np.gradient(dem, cell_y, cell_x)
    return np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))


def map_flood(flood: np.ndarray, before: np.ndarray, slope: np.ndarray) -> np.ndarray:
    with np.errstate(invalid="ignore"):
        water = (flood <= DARK_DB) & (before - flood >= DROP_DB) & (slope <= MAX_SLOPE_DEGREES)
    labels, count = ndimage.label(water)
    if count == 0:
        return water
    sizes = ndimage.sum_labels(water, labels, np.arange(1, count + 1))
    return np.isin(labels, np.flatnonzero(sizes >= MIN_CELLS) + 1)


def to_multipolygon(mask: np.ndarray, transform, min_degrees2: float):
    polygons = [
        shape(geometry)
        for geometry, value in shapes(mask.astype("uint8"), mask=mask, transform=transform)
        if value == 1 and shape(geometry).area >= min_degrees2
    ]
    if not polygons:
        return MultiPolygon()
    merged = set_precision(unary_union(polygons).simplify(SIMPLIFY_DEGREES).buffer(0), COORDINATE_DEGREES)
    if merged.geom_type == "Polygon":
        return MultiPolygon([merged])
    return MultiPolygon([part for part in merged.geoms if part.geom_type == "Polygon"])


def check_location(location, event, observed, covered, transform, cell_km2, flood_time, before_time) -> None:
    lid = location["id"]
    area = np.ones(observed.shape, dtype=bool)
    boundary = load_boundary(lid)
    limit = box(*location["bbox"]) if boundary is None else box(*location["bbox"]).intersection(boundary)
    area = rasterize([(limit, 1)], out_shape=observed.shape, transform=transform, dtype="uint8").astype(bool)
    seen = observed & area
    seen_km2 = float(seen.sum()) * cell_km2
    # The radar passes may not cover the whole area, and the model can only be checked where they do
    coverage = float((covered & area).sum()) / max(1, int(area.sum()))
    area = area & covered

    flood_day = datetime.fromisoformat(flood_time.replace("Z", "+00:00")).astimezone(IST)
    before_day = datetime.fromisoformat(before_time.replace("Z", "+00:00")).astimezone(IST)
    min_degrees2 = MIN_POLYGON_KM2 / (111.32**2 * math.cos(math.radians(sum(location["bbox"][1::2]) / 2)))
    geometry = to_multipolygon(seen, transform, min_degrees2)
    folder = ROOT / "data" / "observed" / lid
    folder.mkdir(parents=True, exist_ok=True)
    day_label = f"{flood_day.day} {flood_day:%B %Y}"
    (folder / "flood_radar.geojson").write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": mapping(geometry),
                        "properties": {
                            "kind": "observed",
                            "name": f"Flood seen by radar, {day_label}",
                            "source": SOURCE,
                            "timestamp": flood_day.isoformat(timespec="minutes"),
                            "quality": f"{QUALITY}. {event['note']}",
                            "event": event["event"],
                            "flooded_area_km2": round(seen_km2, 1),
                            "compared_with": f"{before_day.day} {before_day:%B %Y}",
                        },
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    results = []
    for rise in RISES_M:
        path = ROOT / "data" / "simulated" / lid / f"flood_plus_{rise}m.geojson"
        model_shape = shape(json.loads(path.read_text(encoding="utf-8"))["features"][0]["geometry"])
        model = rasterize([(model_shape, 1)], out_shape=observed.shape, transform=transform, dtype="uint8").astype(bool) & area
        both = int((model & seen).sum())
        either = int((model | seen).sum())
        results.append(
            {
                "rise_m": rise,
                "model_km2": round(float(model.sum()) * cell_km2, 1),
                "observed_inside_model_share": round(both / max(1, int(seen.sum())), 3),
                "model_seen_by_radar_share": round(both / max(1, int(model.sum())), 3),
                "overlap_score": round(both / max(1, either), 3),
            }
        )
    best = max(results, key=lambda item: item["overlap_score"])

    settlements = json.loads((ROOT / "data" / "reference" / lid / "settlements.geojson").read_text(encoding="utf-8"))["features"]
    near = ndimage.binary_dilation(seen, iterations=3)  # within about 270 m
    named = []
    for feature in settlements:
        lon, lat = feature["geometry"]["coordinates"]
        row, col = rowcol(transform, lon, lat)
        if 0 <= row < seen.shape[0] and 0 <= col < seen.shape[1] and near[row, col]:
            named.append(feature["properties"]["name"])

    result = {
        "name": f"Flood scenarios checked against radar, {day_label}",
        "kind": "observed",
        "source": SOURCE,
        "timestamp": flood_day.isoformat(timespec="minutes"),
        "quality": f"{QUALITY}. {event['note']}",
        "event": event["event"],
        "image_date": day_label,
        "compared_with": f"{before_day.day} {before_day:%B %Y}",
        "observed_km2": round(seen_km2, 1),
        "radar_coverage_share": round(coverage, 3),
        "best_rise_m": best["rise_m"],
        "settlements_near_flood": sorted(set(named)),
        "settlements_total": len(settlements),
        "scenarios": results,
    }
    (ROOT / "data" / "reference" / lid / "model_check.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"{lid}: radar covers {coverage:.0%}, {seen_km2:.1f} km2 on {day_label}, best +{best['rise_m']} m, settlements near flood {len(named)}/{len(settlements)}")
    for item in results:
        print(
            f"  +{item['rise_m']} m model {item['model_km2']} km2, radar inside model "
            f"{item['observed_inside_model_share']:.0%}, model seen by radar "
            f"{item['model_seen_by_radar_share']:.0%}, overlap {item['overlap_score']:.0%}"
        )


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:]
    with httpx.Client(timeout=60, headers=HEADERS) as client:
        for grid, event in EVENTS.items():
            if wanted and grid not in wanted:
                continue
            dem, transform = load_dem(grid)
            west, south, east, north = GRIDS[grid]
            flood, before, flood_time, before_time = load_images(client, grid, event, transform, dem.shape)
            print(f"{grid}: flood image median {np.nanmedian(flood):.1f} dB, earlier {np.nanmedian(before):.1f} dB, valid {np.isfinite(flood).mean():.0%}", flush=True)
            observed = map_flood(flood, before, slope_degrees(dem, north, south))
            covered = np.isfinite(flood) & np.isfinite(before)
            cell_km2 = (111.32 / 1200) ** 2 * math.cos(math.radians((south + north) / 2))
            for location in load_locations():
                if location["grid"] == grid:
                    check_location(location, event, observed, covered, transform, cell_km2, flood_time, before_time)


if __name__ == "__main__":
    main()
