"""Australia's health points from the National Health Services Directory, as Geoscience Australia publishes them:
pharmacies, hospitals and emergency departments, general practices and other walk-in primary care. Written as one
TSV that scripts/official/merge.py adds to Australia's emergency points where OpenStreetMap lacks them (2026-11:
5,526 pharmacies against OSM's 3,407; 6,254 general practices). Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "National HealthDirect Health Facilities", three point layers (general practice, hospital, pharmacy) of
a Geoscience Australia map service, each place on its G-NAF address; CC BY 4.0 (© Commonwealth of Australia,
Geoscience Australia; incorporates G-NAF © Geoscape Australia). The directory itself (Healthdirect's NHSD) is
reusable for non-commercial purposes only, which this free app is; its terms also ask not to rely on it to find a
service in an emergency, which the app's own notice about its points' age covers. The layers are a snapshot GA
refreshes now and then (March 2025 when written): the script reads whatever is there.
Left out: hospital pharmacies and outpatient clinics (inside the hospital), maternal and child health, skin cancer
and cancer services. A practice listed for several services is one point: points of a kind within 15 m are one.
A layer that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I au.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import datetime
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
SERVICE = "https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer"
MIN_SHARE = 0.8
BBOX = (-44.0, 112.0, -9.0, 154.5)  # mainland and Tasmania (Christmas, Cocos, Norfolk are other packs)
SOURCES = {
    "au-nhsd": {
        "name": "National HealthDirect Health Facilities (National Health Services Directory)",
        "publisher": "Geoscience Australia / Healthdirect Australia",
        "licence": "CC BY 4.0 (© Commonwealth of Australia, Geoscience Australia; incorporates G-NAF © Geoscape Australia)",
        "url": "https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer",
    },
}
# layer → {nhsd_service_type: kind}
LAYERS = {
    2: {"Pharmacy service": "pharmacy"},
    1: {"Hospital service": "hospital", "Emergency department service": "hospital"},
    0: {"General practice service": "clinic", "Aboriginal and Torres Strait Islander health service": "clinic",
        "Nurse led clinic": "clinic", "Nurse practitioner led clinic": "clinic", "Walk-in centre": "clinic"},
}
SAME_SPOT = 15  # metres


def get(url, timeout=120, tries=3):
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


def features(layer):
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": "operationalstatus='active'", "outFields": "*", "returnGeometry": "true",
                                    "outSR": 4326, "resultOffset": offset, "resultRecordCount": 2000,
                                    "orderByFields": "objectid", "f": "json"})
        page = json.loads(get(f"{SERVICE}/{layer}/query?{q}"))
        if "error" in page:
            raise RuntimeError(str(page["error"])[:200])
        got = page.get("features") or []
        out += got
        offset += len(got)
        if not got or not page.get("exceededTransferLimit"):
            return out


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


def places():
    rows, dates = [], set()
    for layer, kinds in LAYERS.items():
        got = 0
        for f in features(layer):
            a, g = f.get("attributes") or {}, f.get("geometry") or {}
            kind = kinds.get(a.get("nhsd_service_type"))
            lat, lon = g.get("y"), g.get("x")
            if not kind or lat is None or lon is None or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
                continue
            got += 1
            if a.get("ga_source_date"):
                dates.add(datetime.datetime.fromtimestamp(a["ga_source_date"] / 1000, datetime.timezone.utc).date().isoformat())
            address = re.sub(r"\s+Australia$", "", re.sub(r"\s+", " ", a.get("address") or "").strip())
            rows.append({
                "source": "au-nhsd", "code": a.get("nhsd_service_id") or str(a.get("objectid")), "kind": kind,
                "lat": lat, "lon": lon, "name": re.sub(r"\s+", " ", a.get("organisation_name") or "").strip(),
                "holder": "", "phone": "", "address": address,
                "municipality": (a.get("suburb") or "").strip(), "precision": "source",
            })
        if not got:
            raise RuntimeError(f"layer {layer}: no rows")
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    return one_per_spot(sorted(rows, key=lambda r: order[r["kind"]])), max(dates) if dates else None


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
    report, failed, snapshot = {}, [], None
    try:
        rows, snapshot = places()
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        report["au-nhsd"] = {"rows": len(rows), "status": "fresh", "snapshot": snapshot}
        print(f"[au-nhsd] {len(rows)} rows (snapshot of {snapshot})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("au-nhsd")
        rows = previous
        report["au-nhsd"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[au-nhsd] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\t".join(COLUMNS) + "\n")
        for r in rows:
            f.write("\t".join(clean(f"{r[c]:.6f}" if c in ("lat", "lon") else r.get(c, "")) for c in COLUMNS) + "\n")
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": kinds, "published": snapshot, "sources": report, "meta": SOURCES}, f,
                  indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
