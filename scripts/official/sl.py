"""Sierra Leone's health facilities from the Ministry of Health and Sanitation's National Health Facilities Dataset
v01 (MoHS + CIESIN/GRID3, 2023): hospitals, community health centres (CHC), community health posts (CHP),
maternal and child health posts (MCHP) and clinics. Written as one TSV that scripts/official/merge.py adds to
Sierra Leone's emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml
into the `official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: GRID3's public ArcGIS FeatureServer layer sle_htlfac_grid3_v01 (1,616 rows with lat/long attributes, 99%
GPS or village-centre points). Licence CC BY 4.0 ("Copyright 2023. Sierra Leone Ministry of Health and Sanitation
(MoHS) and Trustees of Columbia University", item licence text: "Users are free to use, copy, distribute, transmit, and
adapt the work for commercial and non-commercial purposes, without restriction, as long as clear attribution of the
source is provided"). A static 2023 snapshot: the script re-reads it each month but it will rarely change.
Left out: rows flagged "Non-Functional" (21), rows without a usable point (under three decimals) or outside Sierra
Leone, and points stacked three or more on one spot. No pharmacies are listed.
A layer that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I sl.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
LAYER = "https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/sle_htlfac_grid3_v01/FeatureServer/0"
MIN_SHARE = 0.8
BBOX = (6.9, -13.4, 10.0, -10.2)
SOURCES = {
    "sl-moh": {
        "name": "Sierra Leone National Health Facilities Dataset v01 (GRID3 SLE Health Facilities v1.0)",
        "publisher": "Ministry of Health and Sanitation, Sierra Leone, and CIESIN Columbia University (GRID3)",
        "licence": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
        "url": "https://doi.org/10.7916/ag19-s334",
    },
}
KINDS = {"HOSPITAL": "hospital", "CHC": "clinic", "CHP": "clinic", "MCHP": "clinic", "CLINIC": "clinic"}
LABEL = {"CHC": "Community Health Centre", "CHP": "Community Health Post", "MCHP": "MCHP"}
SAME_SPOT = 15  # metres

def get(url, timeout=300, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read(), r.headers.get("Last-Modified", "")
        except Exception as e:  # noqa: BLE001 (any network failure: retry, then the caller keeps last month's)
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def meters(a, b):
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[0] - a[0]))


def one_per_spot(rows):
    out, grid, cell = [], {}, 0.0005
    for r in rows:
        key = (r["kind"], int(r["lat"] // cell), int(r["lon"] // cell))
        near = [o for di in (-1, 0, 1) for dj in (-1, 0, 1) for o in grid.get((key[0], key[1] + di, key[2] + dj), ())]
        if any(meters((o["lat"], o["lon"]), (r["lat"], r["lon"])) <= SAME_SPOT for o in near):
            continue
        grid.setdefault(key, []).append(r)
        out.append(r)
    return out


def finish(rows):
    """Drop points stacked three or more on one ~100 m spot (a place's centre), then merge duplicates within 15 m."""
    stacks = {}
    for r in rows:
        k = (round(r["lat"], 3), round(r["lon"], 3))
        stacks[k] = stacks.get(k, 0) + 1
    rows = [r for r in rows if stacks[(round(r["lat"], 3), round(r["lon"], 3))] < 3]
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    return one_per_spot(sorted(rows, key=lambda r: order[r["kind"]]))


def coord(v):
    """Number with at least three decimals, else None (a hand-rounded centre is ~1 km off)."""
    t = re.sub(r"\s+", "", str(v if v is not None else "")).replace(",", ".")
    if not re.fullmatch(r"-?\d+\.\d{3,}", t):
        return None
    return float(t)


def fetch():
    rows, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": "1=1", "outFields": "*", "returnGeometry": "false", "f": "json",
                                    "resultOffset": offset, "resultRecordCount": 1000, "orderByFields": "FID"})
        d = json.loads(get(f"{LAYER}/query?{q}")[0])
        if "error" in d:
            raise RuntimeError(str(d["error"])[:200])
        got = [f["attributes"] for f in d.get("features", [])]
        rows += got
        offset += len(got)
        if not got or not d.get("exceededTransferLimit"):
            return rows


def places(attrs):
    rows = []
    for r in attrs:
        kind = KINDS.get((r.get("type") or "").strip().upper())
        lat, lon = coord(r.get("lat")), coord(r.get("long"))
        name = re.sub(r"\s+", " ", r.get("facility") or r.get("fac_name") or "").strip(" .")
        if not kind or lat is None or lon is None or not name or (r.get("functional") or "").strip().lower() != "functional":
            continue
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        t = r["type"].strip().upper()
        if not re.search(r"hospital|centre|center|clinic|post|chc|chp|mchp", name, re.I):
            name = f"{name} {LABEL.get(t, 'Clinic')}"
        district = (r.get("district") or "").strip()
        rows.append({
            "source": "sl-moh", "code": f"{r.get('dhis2_id') or ''}".strip() or f"FID{r['FID']}", "kind": kind, "lat": lat, "lon": lon,
            "name": name, "holder": (r.get("ownership") or "").strip(), "phone": "", "address": (r.get("community") or "").strip(),
            "municipality": district, "precision": "village" if (r.get("source_geo") or "").strip() == "Village Center" else "source",
        })
    return finish(rows)


def read_tsv(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
            rows.append(r)
    return rows


def clean(v):
    return str(v or "").replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


def main(argv):
    out_path = argv[0]
    opt = lambda name: argv[argv.index(name) + 1] if name in argv else None  # noqa: E731
    previous = read_tsv(opt("--previous")) if opt("--previous") else []
    report, failed = {}, []
    try:
        updated = "2023 snapshot (GRID3 v01)"
        rows = places(fetch())
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["sl-moh"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[sl-moh] {len(rows)} rows (data of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("sl-moh")
        rows = previous
        report["sl-moh"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[sl-moh] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\t".join(COLUMNS) + "\n")
        for r in rows:
            f.write("\t".join(clean(f"{r[c]:.6f}" if c in ("lat", "lon") else r.get(c, "")) for c in COLUMNS) + "\n")
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": kinds, "sources": report, "meta": SOURCES}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
