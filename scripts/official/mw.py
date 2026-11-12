"""Malawi's health facilities from the Ministry of Health and Population's Malawi Health Facility Registry (MHFR,
zipatala.health.gov.mw), as published on HDX by the Health Cluster: hospitals (central, district, other), health
centres, dispensaries, health posts and clinics. Written as one TSV that scripts/official/merge.py adds to Malawi's
emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into the
`official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: `mhfr_facilities.xlsx` ("Facilities" sheet, one row per facility with code, name, type, ownership,
district and latitude/longitude as text), resolved through HDX's CKAN API so a re-uploaded file is found; licence
CC BY (HDX dataset "Malawi Health Facility Registry", uploaded by the Ministry of Health). The XLSX is read with
the standard library (zip + XML). Coordinates are free text with stray spaces ("34. 6162227"): spaces are removed,
and a point with fewer than three decimals (a district's centre typed by hand, ~1 km) is left out.
The register's STATUS flag is not used to drop facilities (about 3 in 4 are "Non-functional", which is a stale
flag: see the quality notes); only "Closed" rows go. Left out: opticians, dental, laboratories and the like among
the "clinics", rows without a usable point or outside Malawi, and points stacked three or more on one spot.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I mw.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import io
import json
import math
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
CKAN = "https://data.humdata.org/api/3/action/package_show?id=malawi-health-facility-registry"
MIN_SHARE = 0.8
BBOX = (-17.2, 32.6, -9.3, 35.95)
SOURCES = {
    "mw-mhfr": {
        "name": "Malawi Health Facility Registry (MHFR), mhfr_facilities.xlsx",
        "publisher": "Ministry of Health and Population, Malawi (via the Health Cluster, Humanitarian Data Exchange)",
        "licence": "Creative Commons Attribution International (CC BY)",
        "url": "https://data.humdata.org/dataset/malawi-health-facility-registry",
    },
}
KINDS = {"hospital": "hospital", "district hospital": "hospital", "central hospital": "hospital", "health centre": "clinic",
         "dispensary": "clinic", "health post": "clinic", "clinic": "clinic"}
NOT_PRIMARY = re.compile(r"optic|dental|dentist|\beye\b|laborator|\blab\b|pharmac|chemist|veterin|physio|x-?ray|scan\b|funeral", re.I)
SAME_SPOT = 15  # metres
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


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


def sheet_rows(raw):
    """The XLSX's 'Facilities' sheet as lists of strings (the workbook also has a pivot sheet)."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    strings = [("".join(t.text or "" for t in si.iter(NS + "t"))) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    target = None
    for sh in wb.iter(NS + "sheet"):
        if sh.get("name") == "Facilities":
            target = rels[sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")]
    if not target:
        raise RuntimeError("no 'Facilities' sheet")
    rows = []
    for row in ET.fromstring(z.read("xl/" + target.lstrip("/").replace("xl/", ""))).iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            letters = re.match(r"[A-Z]+", c.get("r")).group()
            idx = 0
            for ch in letters:
                idx = idx * 26 + ord(ch) - 64
            v = c.find(NS + "v")
            if v is not None:
                cells[idx - 1] = strings[int(v.text)] if c.get("t") == "s" else v.text
        rows.append([cells.get(i, "") for i in range(11)])
    return rows


def coord(v):
    """'34. 6162227' -> 34.6162227; None when it isn't a number or has under three decimals."""
    t = re.sub(r"\s+", "", v or "")
    if not re.fullmatch(r"-?\d+\.\d{3,}", t):
        return None
    return float(t)


def places(raw):
    table = sheet_rows(raw)
    head = [h.strip().upper() for h in table[0]]
    rows = []
    for vals in table[1:]:
        r = dict(zip(head, vals))
        kind = KINDS.get((r.get("TYPE") or "").strip().lower())
        lat, lon = coord(r.get("LATITUDE")), coord(r.get("LONGITUDE"))
        name = re.sub(r"\s+", " ", r.get("NAME") or "").strip(" .")
        if not kind or lat is None or lon is None or not name or (r.get("STATUS") or "").strip().lower() == "closed":
            continue
        if lat > 0:  # a few rows lost the minus sign
            lat = -lat
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]) or NOT_PRIMARY.search(name):
            continue
        t = r["TYPE"].strip()
        if kind == "clinic" and not re.search(r"hospital|centre|center|clinic|dispensary|health post|post\b", name, re.I):
            name = f"{name} {t}"
        district = (r.get("DISTRICT") or "").strip()
        rows.append({
            "source": "mw-mhfr", "code": r["CODE"].strip(), "kind": kind, "lat": lat, "lon": lon, "name": name,
            "holder": (r.get("OWNERSHIP") or "").strip(), "phone": "", "address": district, "municipality": district,
            "precision": "source",
        })
    stacks = {}
    for r in rows:
        k = (round(r["lat"], 3), round(r["lon"], 3))
        stacks[k] = stacks.get(k, 0) + 1
    rows = [r for r in rows if stacks[(round(r["lat"], 3), round(r["lon"], 3))] < 3]
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    return one_per_spot(sorted(rows, key=lambda r: order[r["kind"]]))


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
        pkg = json.loads(get(CKAN)[0])["result"]
        res = next(x for x in pkg["resources"] if (x.get("format") or "").upper() == "XLSX")
        raw, updated = get(res["url"])
        updated = res.get("last_modified") or updated
        rows = places(raw)
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["mw-mhfr"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[mw-mhfr] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("mw-mhfr")
        rows = previous
        report["mw-mhfr"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[mw-mhfr] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
