"""Download the Copernicus DEM GLO-30 terrain tiles for the model grid into data/raw."""
import math
from pathlib import Path

import httpx

from pilot_area import EAST, NORTH, SOUTH, WEST

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"


def tile_names() -> list[str]:
    """Northern and eastern hemisphere tiles covering the grid."""
    return [
        f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
        for lat in range(math.floor(SOUTH), math.ceil(NORTH))
        for lon in range(math.floor(WEST), math.ceil(EAST))
    ]


def main() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for name in tile_names():
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
