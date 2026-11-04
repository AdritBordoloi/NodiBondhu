"""Download the Copernicus DEM GLO-30 terrain tiles for the model grids into data/raw.

Run: python scripts/fetch_dem.py [grid]
With no grid name, it downloads the tiles for every grid.
"""
import sys
from pathlib import Path

import httpx

from pilot_area import GRIDS, dem_tile_names

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    grids = sys.argv[1:] or list(GRIDS)
    for name in (tile for grid in grids for tile in dem_tile_names(grid)):
        target = RAW_DIR / f"{name}.tif"
        if target.exists():
            print(f"{target.name} already downloaded")
            continue
        partial = target.with_suffix(".part")
        with httpx.stream("GET", f"{BUCKET}/{name}/{name}.tif", timeout=300) as response:
            response.raise_for_status()
            with partial.open("wb") as file:
                for chunk in response.iter_bytes():
                    file.write(chunk)
        partial.replace(target)
        print(f"{target.name}: {target.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
