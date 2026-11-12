"""The United States' community health centres from HRSA (Health Resources and Services Administration, Department of
Health and Human Services): every permanent site where a Federally Qualified Health Center or look-alike sees
patients, primary care for anyone whatever they can pay. Written as TSVs that scripts/official/merge.py adds to the
emergency points of the US packs where OpenStreetMap lacks them. Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The US is several packs (scripts/routing/packs.json: us-west, us-south… as Geofabrik cuts it, plus Puerto Rico and
the other territories): us.official.tsv holds every row, and one <pack>.official.tsv per pack holds that pack's
states, which is what the build reads.
The source: "Health Center Service Delivery and Look-Alike Sites", data.hrsa.gov, updated daily, with each site's
geocoded point; a work of the US federal government (public domain). Left out: school-based sites (for their
students), seasonal ones and mobile vans, purely administrative offices, sites in prisons, nursing homes and
shelters, and sites whose name says they only do dentistry, behavioural health, WIC, a pharmacy or the eyes.
Hospitals and pharmacies have no such federal list with points (docs/OFFICIAL_POINTS_WORLD.md).
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I us.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
URL = "https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
MIN_SHARE = 0.8
SOURCES = {
    "us-hrsa": {
        "name": "Health Center Service Delivery and Look-Alike Sites",
        "publisher": "Health Resources and Services Administration (HRSA), U.S. Department of Health and Human Services",
        "licence": "Public domain (work of the U.S. federal government)",
        "url": "https://data.hrsa.gov/data/download",
    },
}
# State → pack (Geofabrik's regions: download.geofabrik.de/north-america/<region>.poly; Alaska and Hawaii are packs
# of their own, as are the territories).
PACKS = {
    "us-west": "AZ CA CO ID MT NV NM OR UT WA WY",
    "us-midwest": "IL IN IA KS MI MN MO NE ND OH SD WI",
    "us-northeast": "CT ME MA NH NJ NY PA RI VT",
    "us-south": "AL AR DE DC FL GA KY LA MD MS NC OK SC TN TX VA WV",
    "us-alaska": "AK", "us-hawaii": "HI", "pr": "PR", "vi": "VI", "gu": "GU", "as": "AS", "mp": "MP",
}
PACK_OF = {state: pack for pack, states in PACKS.items() for state in states.split()}
SETTINGS = {"All Other Clinic Types", "Hospital", "Unknown"}
# Sites that only do one thing a person in trouble doesn't come for (the file has no list of services).
NOT_PRIMARY = re.compile(r"dental|dentist|behavio(u)?ral|counsel|\bwic\b|pharmacy|vision|optometr|mental|recovery|substance|"
                         r"administrat", re.I)


def get(url, timeout=300, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 (any network failure: retry, then the caller keeps last month's)
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def phone(v):
    digits = re.sub(r"\D", "", v or "")
    return f"+1{digits[-10:]}" if len(digits) >= 10 else ""


def sites(raw):
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        if (r.get("Site Status Description") != "Active" or r.get("Health Center Location Type Description") != "Permanent"
                or r.get("Health Center Type Description") == "Administrative"
                or r.get("Health Center Service Delivery Site Location Setting Description") not in SETTINGS
                or NOT_PRIMARY.search(r.get("Site Name") or "")):
            continue
        try:
            lon = float(r["Geocoding Artifact Address Primary X Coordinate"])
            lat = float(r["Geocoding Artifact Address Primary Y Coordinate"])
        except (KeyError, ValueError):
            continue
        state = (r.get("Site State Abbreviation") or "").strip()
        if state not in PACK_OF or not (-15 <= lat <= 72 and (-180 <= lon <= -60 or 140 <= lon <= 180)):
            continue
        city = re.sub(r"\s+", " ", r.get("Site City") or "").strip()
        rows.append({
            "source": "us-hrsa", "code": (r.get("BPHC Assigned Number") or "").strip(), "kind": "clinic",
            "lat": lat, "lon": lon, "name": re.sub(r"\s+", " ", r.get("Site Name") or "").strip(),
            "holder": re.sub(r"\s+", " ", r.get("Health Center Name") or "").strip(),
            "phone": phone(r.get("Site Telephone Number")),
            "address": ", ".join(x for x in (re.sub(r"\s+", " ", r.get("Site Address") or "").strip(), city,
                                              f"{state} {(r.get('Site Postal Code') or '').strip()}".strip()) if x),
            "municipality": city, "precision": "source", "state": state,
        })
    return [r for r in rows if r["code"]]


def read_tsv(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
            rows.append(r)
    return rows


def clean(v):
    return str(v or "").replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


def write(path, rows, columns):
    with open(path, "w", encoding="utf-8") as f:
        f.write("\t".join(columns) + "\n")
        for r in rows:
            f.write("\t".join(clean(f"{r[c]:.6f}" if c in ("lat", "lon") else r.get(c, "")) for c in columns) + "\n")


def main(argv):
    out_path = argv[0]
    opt = lambda name: argv[argv.index(name) + 1] if name in argv else None  # noqa: E731
    previous = read_tsv(opt("--previous")) if opt("--previous") else []
    report, failed = {}, []
    try:
        rows = sites(get(URL))
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["us-hrsa"] = {"rows": len(rows), "status": "fresh"}
        print(f"[us-hrsa] {len(rows)} rows", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("us-hrsa")
        rows = previous
        report["us-hrsa"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[us-hrsa] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
    # The whole file carries each row's state (to split last month's rows again); the packs' files don't need it.
    write(out_path, rows, COLUMNS + ["state"])
    folder = os.path.dirname(out_path) or "."
    packs = {}
    for r in rows:
        packs.setdefault(PACK_OF.get(r.get("state", "")), []).append(r)
    for pack, part in sorted((k, v) for k, v in packs.items() if k):
        write(os.path.join(folder, f"{pack}.official.tsv"), part, COLUMNS)
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": {"clinic": len(rows)}, "packs": {k: len(v) for k, v in sorted(packs.items()) if k},
                   "sources": report, "meta": SOURCES}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows; packs {', '.join(f'{k} {len(v)}' for k, v in sorted(packs.items()) if k)}; failed: {' '.join(failed) or 'none'}",
          file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
