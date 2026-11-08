"""The Situation Report's main figures as labelled lines, the only things the AI summary may use.

Each line starts with Simulated, Observed or Forecast, which the summary uses to group them.
To add a figure to the summary, add a line in the matching section below.
"""
from datetime import datetime

from fastapi import HTTPException

from data import DATA_DIR, first_properties, floods_by, read_flood_reports, read_land_use, read_model_check
from data import read_routes, read_settlements, read_villages


def long_date(value: str) -> str:
    day = datetime.fromisoformat(value[:10])
    return f"{day.day} {day:%B %Y}"


def for_rise(items: list[dict], rise: int) -> dict | None:
    return next((item for item in items if item["rise_m"] == rise), None)


def simulated_facts(location: dict, rise: int) -> list[str]:
    location_id = location["id"]
    scenario = first_properties(DATA_DIR / "simulated" / location_id / f"flood_plus_{rise}m.geojson")
    if scenario is None:
        raise HTTPException(status_code=404, detail=f"No scenario for +{rise} m")
    facts = [
        f"Simulated: a +{rise} m river rise in the {location['name']} map area would flood about "
        f"{scenario['flooded_area_km2']} km2 of land."
    ]

    places = [place["properties"] for place in read_settlements(location_id)["features"]]
    reached = [place for place in places if floods_by(place, rise)]
    facts.append(f"Simulated: it would reach {len(reached)} of {len(places)} mapped settlements.")
    focus = next((place for place in places if place.get("name") == location["focus"]), None)
    if focus:
        status = "would flood" if focus in reached else "would not flood"
        facts.append(f"Simulated: {location['focus']} {status} in this scenario.")

    villages = [village["properties"] for village in read_villages(location_id)["features"]]
    hit = [village for village in villages if floods_by(village, rise)]
    counted = [village for village in hit if village.get("population_2001") is not None]
    if villages:
        facts.append(
            f"Simulated: {len(hit)} of {len(villages)} census villages would have flooded land. {len(counted)} of them "
            f"have a census figure, with a whole population of {sum(v['population_2001'] for v in counted)} in 2001."
        )

    km = f"flooded_km_{rise}"
    routes = [r["properties"] for r in read_routes(location_id)["features"] if r["properties"].get("segment") == "route"]
    cut = sorted((r for r in routes if (r.get(km) or 0) > 0), key=lambda r: -r[km])
    if routes:
        worst = ", ".join(f"{r['name']} (about {r[km]} km)" for r in cut[:3])
        facts.append(
            f"Simulated: {len(cut)} of {len(routes)} main routes would pass through the flood area"
            + (f". Most affected: {worst}." if worst else ".")
        )

    land = for_rise(read_land_use(location_id).get("scenarios", []), rise)
    if land:
        kinds = ", ".join(f"{k['name']} about {round(k['flooded_km2'])} km2" for k in land["land_types"][:3])
        facts.append(f"Simulated estimate of flooded land: {kinds}.")
    return facts


def observed_facts(location: dict, rise: int) -> list[str]:
    location_id = location["id"]
    facts = []
    check = read_model_check(location_id)
    score = for_rise(check.get("scenarios", []), rise)
    if score:
        facts.append(
            f"Observed check: this scenario overlaps {round(score['overlap_score'] * 100)}% with flood seen by "
            f"radar on {check['image_date']}, so the model only partly matches a real flood."
        )

    gauge = first_properties(DATA_DIR / "observed" / location_id / "river_levels.geojson")
    if gauge and gauge.get("level_m") is not None:
        limit = next(
            (
                f", {label} level {gauge[key]} m"
                for key, label in (("danger_level_m", "danger"), ("warning_level_m", "warning"))
                if gauge.get(key) is not None
            ),
            "",
        )
        facts.append(
            f"Observed past reading, not live: {gauge['name']} was {gauge['level_m']} m on "
            f"{long_date(gauge['timestamp'])}{limit}."
        )

    reports = read_flood_reports(location_id)
    days = [day for day in reports.get("days", []) if day["people"] is not None]
    if days:
        peak = max(days, key=lambda day: day["people"])
        facts.append(
            f"Observed official report for {reports['area']}, the whole area and not the map area: the most people "
            f"affected were {peak['people']} in {peak['villages']} villages on {long_date(peak['date'])}."
        )
    elif reports:
        facts.append(f"Observed: the official reports used do not list {reports['area']} as affected.")
    return facts


def forecast_facts(location: dict, rise: int) -> list[str]:
    facts = []
    folder = DATA_DIR / "forecast" / location["id"]
    rain = first_properties(folder / "rain.geojson")
    if rain and rain.get("rain_next_24h_mm") is not None:
        facts.append(
            f"Forecast: {rain['rain_next_24h_mm']} mm of rain in the next 24 hours and "
            f"{rain['rain_next_72h_mm']} mm in the next 72 hours."
        )
    flow = first_properties(folder / "river_flow.geojson")
    if flow and flow.get("flow_peak_next_7d_m3s") is not None:
        facts.append(
            f"Forecast: river flow peaks at {flow['flow_peak_next_7d_m3s']} m3/s in the next 7 days, "
            f"against a 2026 monsoon peak of {flow['monsoon_peak_2026_m3s']} m3/s."
        )
    return facts


def summary_facts(location: dict, rise: int) -> list[str]:
    return [
        fact
        for section in (simulated_facts, observed_facts, forecast_facts)
        for fact in section(location, rise)
    ]
