"""Read the DRIMS daily flood report PDFs from ASDMA into one checked data file.

Run: python scripts/parse_flood_reports.py <folder with Daily_Flood_Report_YYYY-MM-DD.pdf files>
Needs pdftotext. Each day's revenue circle figures are added up and compared with the report's own
state total, and a day that does not match is marked, so its figures are not treated as checked.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "observed" / "flood_reports.json"
DISTRICTS = ("Sivasagar", "Charaideo", "Sribhumi")
SOURCE = "Daily Flood Reports, DRIMS Assam, Assam State Disaster Management Authority"
SOURCE_URL = "https://sdrf.assam.gov.in/dfr/"
QUALITY = (
    "Official counts for whole districts and revenue circles, not the study area boxes. People "
    "affected is not the same as people in floodwater, and reports can be revised after their date"
)

PAGE_HEADER = re.compile(r"DRIMS Assam\s+Disaster Reporting and Information Management System")
CIRCLE_FIGURES = re.compile(
    r"\(\s*([A-Za-z .\-]+?)\s*\|\s*Population\s+Affected\s*:\s*([\d,]+)\s*\|\s*Crop\s+Area\s+Submerged\s*:\s*([\d.,]+)\s*\)"
)
CIRCLE_PEOPLE = re.compile(r"\(\s*([A-Za-z .\-]+?)\s*\|\s*Population\s+Affected\s*:\s*([\d,]+)\s*\|")
DISTRICT_ROW = re.compile(r"([A-Z][a-z]+(?: \(M\))?) [\d,]+ [\d,]+ [\d,]+ ([\d,]+) ([\d.,]+) \(")
DISTRICT_VILLAGES = re.compile(r"([A-Z][a-z]+(?: [A-Z][a-z]+)*) (\d+) ((?:\( ?[A-Za-z .\-]+ ?\| ?\d+ ?\),? ?)+)")
CIRCLE_VILLAGES = re.compile(r"\( ?([A-Za-z .\-]+?) ?\| ?(\d+) ?\)")
STATE_TOTAL = re.compile(r"Total ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+) ([\d.,]+)")
RIVER = re.compile(r"[A-Z][A-Za-z]*(?: \([A-Z]\))? \((?:[^()]|\([^()]*\))+\)")
LABEL_WORDS = re.compile(
    r"\b(?:Rivers|flowing|above|Danger|Level|highest|flood|level|as per|CWC|bulletin|issued|at 8|AM|Particulars)\b|[()](?=\s*(?:as|AM))"
)


def number(text: str) -> float:
    return float(text.replace(",", ""))


def rivers_in(text: str) -> list[str]:
    return sorted({re.sub(r"\s+", " ", found).strip() for found in RIVER.findall(LABEL_WORDS.sub(" ", text))})


def read_report(path: Path) -> dict:
    text = subprocess.run(["pdftotext", "-raw", str(path), "-"], capture_output=True, encoding="utf-8", errors="replace", check=True).stdout
    flat = re.sub(r"\s+", " ", PAGE_HEADER.sub(" ", text))
    date = re.search(r"(\d{4}-\d{2}-\d{2})", path.name).group(1)

    affected_at = flat.find("Name of Affected")
    header = flat[: affected_at if affected_at > 0 else 800]
    split = re.search(r"above highest flood level", header, re.I)
    danger_part = header[: split.start()] if split else header
    highest_part = header[split.end() :] if split else ""

    villages_at = flat.find("Villages")
    population_at = flat.find("Population", villages_at)
    circles_by_district: dict[str, dict[str, int]] = {}
    village_totals: dict[str, int] = {}
    for district, total, members in DISTRICT_VILLAGES.findall(flat[villages_at:population_at]):
        # The first row follows the table's headings, which the pattern can read as part of the name
        name = re.sub(r"^(?:(?:Villages|Affected|District|Total|Revenue|Circle) )+", "", district).strip()
        village_totals[name] = int(total)
        circles_by_district[name] = {circle.strip(): int(count) for circle, count in CIRCLE_VILLAGES.findall(members)}

    circle_figures = {}
    for circle, people, crops in CIRCLE_FIGURES.findall(flat):
        circle_figures.setdefault(circle.strip(), (int(number(people)), number(crops)))
    # Some PDFs cut off the end of each row, which loses the crop figure but keeps the people count
    for circle, people in CIRCLE_PEOPLE.findall(flat):
        circle_figures.setdefault(circle.strip(), (int(number(people)), None))
    # District rows hold the totals when circle crop figures are cut off
    district_rows = {
        name.strip(): (int(number(people)), number(crops))
        for name, people, crops in DISTRICT_ROW.findall(flat[population_at:])
    }
    total = STATE_TOTAL.search(flat)
    state_people = int(number(total.group(4))) if total else None
    state_crops = number(total.group(5)) if total else None
    people_sum = sum(people for people, _ in circle_figures.values())
    if all(crops is not None for _, crops in circle_figures.values()):
        crops_sum = sum(crops for _, crops in circle_figures.values())
    else:
        # Cut-off rows can lose whole circles, so the check uses the complete district rows instead
        people_sum = sum(people for people, _ in district_rows.values())
        crops_sum = sum(crops for _, crops in district_rows.values())
    checked = (
        total is not None
        and people_sum == state_people
        and abs(crops_sum - state_crops) < 1
        and sum(village_totals.values()) > 0
    )

    districts = {}
    for name in DISTRICTS:
        if name not in circles_by_district:
            continue  # Not listed that day, which is different from a reported zero
        circles = {
            circle: {
                "villages": count,
                "people": circle_figures.get(circle, (None, None))[0],
                "crop_hectares": circle_figures.get(circle, (None, None))[1],
            }
            for circle, count in circles_by_district[name].items()
        }
        people_known = all(item["people"] is not None for item in circles.values())
        crops_known = all(item["crop_hectares"] is not None for item in circles.values())
        row = district_rows.get(name, (None, None))
        districts[name] = {
            "villages": village_totals[name],
            "people": sum(item["people"] for item in circles.values()) if people_known else row[0],
            "crop_hectares": round(sum(item["crop_hectares"] for item in circles.values()), 2) if crops_known else row[1],
            "circles": circles,
        }
    generated = re.findall(r"Report Generated On: (\d{2}-\d{2}-\d{4})", flat)
    return {
        "date": date,
        "report_generated": generated[-1] if generated else None,
        "rivers_above_danger": rivers_in(danger_part),
        "rivers_above_highest": rivers_in(highest_part),
        "state_people": state_people,
        "state_crop_hectares": state_crops,
        "checked_against_state_total": checked,
        "districts": districts,
    }


def main() -> None:
    folder = Path(sys.argv[1])
    days = [read_report(path) for path in sorted(folder.glob("Daily_Flood_Report_*.pdf"))]
    OUTPUT.write_text(
        json.dumps({"kind": "observed", "source": SOURCE, "source_url": SOURCE_URL, "quality": QUALITY, "days": days}, indent=1),
        encoding="utf-8",
    )
    for day in days:
        parts = ", ".join(f"{name} v{item['villages']} p{item['people']} c{item['crop_hectares']}" for name, item in day["districts"].items())
        print(
            f"{day['date']} generated {day['report_generated']} checked={day['checked_against_state_total']} state {day['state_people']} | {parts}\n"
            f"   danger {day['rivers_above_danger']}\n   highest {day['rivers_above_highest']}"
        )


if __name__ == "__main__":
    main()
