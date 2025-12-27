import json
import argparse
from datetime import datetime
from zoneinfo import ZoneInfo

# The three unix fields you want updated
UNIX_FIELDS = ["Unix Arrival Arrival", "Unix Arrival", "Unix Arrival Departure"]

# Your schedule field (you renamed it)
DEFAULT_PRETTY_FIELD = "Pretty Arrival EDT 2026"

# "EDT" schedule: treat it as America/New_York
SCHEDULE_TZ = ZoneInfo("America/New_York")


def parse_pretty_dt(pretty: str) -> datetime:
    """
    Parse strings like:
      "4/4/2026 23:58:00"
      "4/5/2026 0:00:00"
    Works with 1-digit months/days/hours too.
    """
    dt_naive = datetime.strptime(pretty, "%m/%d/%Y %H:%M:%S")
    return dt_naive.replace(tzinfo=SCHEDULE_TZ)


def convert_item(item: dict, pretty_field: str) -> dict:
    """
    Compute Unix timestamps from the Pretty Arrival schedule time,
    preserving the original second offsets between Arrival Arrival / Arrival / Departure.
    """
    pretty = item.get(pretty_field)
    if not pretty:
        return item

    # New correct schedule datetime (timezone-aware)
    sched_dt = parse_pretty_dt(pretty)
    new_arrival = int(sched_dt.timestamp())

    # Preserve original offsets if possible
    old_aa = item.get("Unix Arrival Arrival")
    old_a = item.get("Unix Arrival")
    old_ad = item.get("Unix Arrival Departure")

    # If old values exist, keep their differences in seconds
    if old_aa is not None and old_a is not None and old_ad is not None:
        try:
            old_aa = int(old_aa)
            old_a = int(old_a)
            old_ad = int(old_ad)

            offset_before = old_a - old_aa      # Arrival - ArrivalArrival
            offset_after = old_ad - old_a       # ArrivalDeparture - Arrival

            item["Unix Arrival"] = new_arrival
            item["Unix Arrival Arrival"] = new_arrival - offset_before
            item["Unix Arrival Departure"] = new_arrival + offset_after
            return item
        except Exception:
            # fall through to "set all to same"
            pass

    # Fallback: if offsets are missing/bad, set all three to the same time
    item["Unix Arrival Arrival"] = new_arrival
    item["Unix Arrival"] = new_arrival
    item["Unix Arrival Departure"] = new_arrival
    return item


def main():
    ap = argparse.ArgumentParser(
        description="Rebuild Unix arrival timestamps using Pretty Arrival EDT 2026 as the source of truth."
    )
    ap.add_argument("input", help="Input route.json")
    ap.add_argument("output", help="Output route_2026.json")
    ap.add_argument(
        "--pretty-field",
        default=DEFAULT_PRETTY_FIELD,
        help='Name of the schedule field (default: "Pretty Arrival EDT 2026")'
    )
    args = ap.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    def conv(x):
        return convert_item(x, args.pretty_field)

    if isinstance(data, list):
        converted = [conv(item) for item in data]
    elif isinstance(data, dict):
        if "stops" in data and isinstance(data["stops"], list):
            data["stops"] = [conv(item) for item in data["stops"]]
        elif "route" in data and isinstance(data["route"], list):
            data["route"] = [conv(item) for item in data["route"]]
        else:
            data = conv(data)
        converted = data
    else:
        raise ValueError("Unsupported JSON structure. Expected a list or dict.")

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(converted, f, ensure_ascii=False, indent=2)

    print(f"Done. Wrote converted file to: {args.output}")


if __name__ == "__main__":
    main()