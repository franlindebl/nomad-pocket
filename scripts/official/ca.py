"""Canada's health points from two provinces' open registers: Ontario's Ministry of Health service provider
locations (pharmacies, hospitals, community health centres, family health teams, nurse practitioner-led and
Indigenous primary-care clinics) and British Columbia's HealthLink BC directory (pharmacies, hospitals, walk-in
clinics). Written as one TSV that scripts/official/merge.py adds to Canada's emergency points where OpenStreetMap
lacks them. Run monthly by .github/workflows/official-points.yml into the `official-points` release, which the pack
build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The sources, both with each place's point:
- Ontario: MOHSERLO (Ministry of Health Service Provider Locations), an ArcGIS layer of Land Information Ontario,
  Open Government Licence - Ontario. A hospital is listed as its corporation and its sites, often at one door:
  points of a kind within 15 m are one.
- British Columbia: HealthLink BC's pharmacies, hospitals and walk-in clinics on the BC Data Catalogue, Open
  Government Licence - British Columbia.
The other provinces publish no such list with points yet (docs/OFFICIAL_POINTS_WORLD.md).
A source that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I ca.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
MIN_SHARE = 0.8
BBOX = (41.6, -141.1, 83.2, -52.5)
ONTARIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/26"
BC = "https://catalogue.data.gov.bc.ca/dataset/"
SOURCES = {
    "ca-on-mohserlo": {
        "name": "Ministry of Health Service Provider Locations (MOHSERLO)",
        "publisher": "Ontario Ministry of Health / Land Information Ontario",
        "licence": "Open Government Licence - Ontario",
        "url": "https://data.ontario.ca/dataset/ministry-of-health-service-provider-locations-mohserlo",
    },
    "ca-bc-hlbc": {
        "name": "HealthLink BC: Pharmacies, Hospitals and Walk-in Clinics in BC",
        "publisher": "BC Ministry of Health (HealthLink BC)",
        "licence": "Open Government Licence - British Columbia",
        "url": "https://catalogue.data.gov.bc.ca/dataset/f5b6bfad-d06a-4952-ae47-976fb5092bcc",
    },
}
# Ontario: (SERVICE_TYPE, SERVICE_TYPE_DETAIL or None for any) → kind. Left out: hospital outpatient dispensaries
# (inside the hospital), labs, long-term care and retirement homes, mental health and support services.
ONTARIO_KINDS = {
    ("Pharmacy", "Retail Pharmacy"): "pharmacy",
    ("Hospital", None): "hospital",
    ("Community Health Centre", None): "clinic",
    ("Family Health Team", None): "clinic",
    ("Nurse Practitioner-Led Clinic", None): "clinic",
    ("Indigenous Primary Health Care Organization", None): "clinic",
}
# BC: dataset id, resource id, file → kind
BC_FILES = [
    ("f5b6bfad-d06a-4952-ae47-976fb5092bcc", "681b4fa5-13a5-4273-a189-fc101f0f8356", "hlbc_pharmacies.csv", "pharmacy"),
    ("383eaf98-afd7-436a-9556-67ecf14f64a7", "5ff82cf4-0448-4063-804a-7321f0f2b4c6", "hlbc_hospitals.csv", "hospital"),
    ("5e2707c3-0aa4-4d2d-aedc-4dd0914b686a", "3ca6b086-c92b-4654-ae82-ff5723d00611", "hlbc_walkinclinics.csv", "clinic"),
]
SAME_SPOT = 15  # metres
TYPE_WORD = {"pharmacy": (r"pharm|drug|apothecar|rexall|london drugs|guardian|ida\b", "Pharmacy"),
             "clinic": (r"clinic|medical|health|centre|center|doctor", "Walk-in Clinic")}


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


def meters(a, b):
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[0] - a[0]))


def one_per_spot(rows):
    """A kind's points within SAME_SPOT metres are one place (a hospital's corporation and its main site)."""
    out, grid, cell = [], {}, 0.0005
    for r in rows:
        key = (r["kind"], int(r["lat"] // cell), int(r["lon"] // cell))
        near = [o for di in (-1, 0, 1) for dj in (-1, 0, 1) for o in grid.get((key[0], key[1] + di, key[2] + dj), ())]
        if any(meters((o["lat"], o["lon"]), (r["lat"], r["lon"])) <= SAME_SPOT for o in near):
            continue
        grid.setdefault(key, []).append(r)
        out.append(r)
    return out


def inside(lat, lon):
    return lat is not None and lon is not None and BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


def clean_space(v):
    return re.sub(r"\s+", " ", v or "").strip()


def ontario():
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": 4326,
                                    "resultOffset": offset, "resultRecordCount": 2000, "orderByFields": "OBJECTID", "f": "json"})
        page = json.loads(get(f"{ONTARIO}/query?{q}", timeout=120))
        if "error" in page:
            raise RuntimeError(str(page["error"])[:200])
        got = page.get("features") or []
        feats += got
        offset += len(got)
        if not got or not page.get("exceededTransferLimit"):
            break
    rows = []
    for f in feats:
        a, g = f.get("attributes") or {}, f.get("geometry") or {}
        kind = ONTARIO_KINDS.get((a.get("SERVICE_TYPE"), a.get("SERVICE_TYPE_DETAIL"))) or ONTARIO_KINDS.get((a.get("SERVICE_TYPE"), None))
        lat, lon = g.get("y"), g.get("x")
        if not kind or not inside(lat, lon):
            continue
        town = clean_space(a.get("COMMUNITY")).title()
        rows.append({
            "source": "ca-on-mohserlo", "code": str(a.get("MOH_SERVICE_PROVIDER_IDENT") or a.get("OGF_ID") or a.get("OBJECTID")),
            "kind": kind, "lat": lat, "lon": lon, "name": clean_space(a.get("ENGLISH_NAME")), "holder": "", "phone": "",
            "address": ", ".join(x for x in (clean_space(a.get("ADDRESS_LINE_1")), town, clean_space(a.get("POSTAL_CODE"))) if x),
            "municipality": town, "precision": "source",
        })
    return rows


def named(kind, org, service):
    """BC writes a pharmacy's or clinic's company as its name ("Loblaws") and the service apart ("Pharmacy Services")."""
    if kind == "hospital":
        return service or org
    pattern, label = TYPE_WORD[kind]
    return org if re.search(pattern, org, re.I) else f"{org} {label}".strip()


def british_columbia():
    rows = []
    for dataset, resource, file, kind in BC_FILES:
        raw = get(f"{BC}{dataset}/resource/{resource}/download/{file}")
        got = 0
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            try:
                lat, lon = float(r.get("LATITUDE") or ""), float(r.get("LONGITUDE") or "")
            except ValueError:
                continue
            if not inside(lat, lon):
                continue
            street = clean_space(" ".join(r.get(c) or "" for c in ("STREET_NUMBER", "STREET_NAME", "STREET_TYPE", "STREET_DIRECTION")))
            town = clean_space(r.get("CITY"))
            got += 1
            rows.append({
                "source": "ca-bc-hlbc", "code": clean_space(r.get("SL_REFERENCE") or r.get("LC_REFERENCE")), "kind": kind,
                "lat": lat, "lon": lon, "name": named(kind, clean_space(r.get("RG_NAME")), clean_space(r.get("SV_NAME"))),
                "holder": clean_space(r.get("RG_NAME")) if kind == "hospital" else "", "phone": clean_space(r.get("PHONE_NUMBER")),
                "address": ", ".join(x for x in (street, town, clean_space(r.get("POSTAL_CODE"))) if x),
                "municipality": town, "precision": "source",
            })
        if not got:
            raise RuntimeError(f"{file}: no rows")
    return rows


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
    before = {}
    for r in read_tsv(opt("--previous")) if opt("--previous") else []:
        before.setdefault(r["source"], []).append(r)
    rows, report, failed = [], {}, []
    for sid, fetch in (("ca-on-mohserlo", ontario), ("ca-bc-hlbc", british_columbia)):
        old = before.get(sid, [])
        try:
            order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
            got = one_per_spot(sorted(fetch(), key=lambda r: order[r["kind"]]))
            if old and len(got) < MIN_SHARE * len(old):
                raise RuntimeError(f"{len(got)} rows, last month {len(old)}")
            if not got:
                raise RuntimeError("no rows")
            rows.extend(got)
            report[sid] = {"rows": len(got), "status": "fresh"}
            print(f"[{sid}] {len(got)} rows", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            failed.append(sid)
            rows.extend(old)
            report[sid] = {"rows": len(old), "status": f"kept last month's: {e}"[:300]}
            print(f"[{sid}] FAILED ({e}); keeping {len(old)} rows from last month", file=sys.stderr)
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
