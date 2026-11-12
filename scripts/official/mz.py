"""Mozambique's health units from the Ministry of Health's (MISAU, SIS-MA) Master Health Facility List, as published on
HDX by OCHA Mozambique: hospitals (central, provincial, general, district, rural) and the health centres and posts as
clinics. Written as one TSV that scripts/official/merge.py adds to Mozambique's emergency points where OpenStreetMap
lacks them. Run monthly by .github/workflows/official-points.yml into the `official-points` release, which the pack
build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: `Mozambique Master Health Facility List.xlsx` ("HealthFacilities" sheet, one row per unit with code,
classification, province, district, LAT and LON), resolved through HDX's CKAN API so a re-uploaded file is found;
licence "Public Domain / No restrictions (CC0)" (dataset "Mozambique - Health facilities", source "SIS-MA, Mozambique
Ministry of Health"). The data is from 2017 and HDX has not changed it since; it is the newest ministry list that is
open. LAT and LON are stored as integers with the decimal point dropped (-150303001403809 is -15.0303001403809): the
point goes back after the second digit, and values that are too short to be a coordinate are left out.
There is no status column, so every unit counts as open. Left out: psychiatric and mental-health hospitals (specialist),
the one unclassified unit, rows without a usable point or outside Mozambique, and points stacked three or more on one
spot. A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I mz.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
CKAN = "https://data.humdata.org/api/3/action/package_show?id=mozambique-health-facilities"
MIN_SHARE = 0.8
BBOX = (-26.95, 30.2, -10.4, 41.0)
SOURCES = {
    "mz-misau": {
        "name": "Mozambique Master Health Facility List (MISAU, SIS-MA), HealthFacilities sheet",
        "publisher": "Ministério da Saúde de Moçambique (SIS-MA), via OCHA Mozambique on the Humanitarian Data Exchange",
        "licence": "Public Domain / No restrictions (CC0)",
        "url": "https://data.humdata.org/dataset/mozambique-health-facilities",
    },
}
HAS_NAME = re.compile(r"hospital|centro|posto|saúde|saude", re.I)
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
    """The XLSX's 'HealthFacilities' sheet as lists of strings (the workbook also has a pivot sheet)."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    strings = [("".join(t.text or "" for t in si.iter(NS + "t"))) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    target = None
    for sh in wb.iter(NS + "sheet"):
        if sh.get("name") == "HealthFacilities":
            target = rels[sh.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")]
    if not target:
        raise RuntimeError("no 'HealthFacilities' sheet")
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
        rows.append([cells.get(i, "") for i in range(18)])
    return rows


def coord(v):
    """-150303001403809 -> -15.0303001403809 (two integer digits for both latitude and longitude here)."""
    s = str(v if v is not None else "").strip()
    sign = -1 if s.startswith("-") else 1
    s = s.lstrip("-")
    if not s.isdigit() or len(s) < 9:
        return None
    return sign * float(s[:2] + "." + s[2:])


def places(raw):
    table = sheet_rows(raw)
    head = [(h or "").split(" (")[0].strip().upper() for h in table[0]]
    rows = []
    for vals in table[1:]:
        r = dict(zip(head, vals))
        cls = (r.get("CLASSIFICATION") or "").strip()
        low = cls.lower()
        if low.startswith("hospital") and "psiqui" not in low:
            kind = "hospital"
        elif low.startswith("centro de saúde") and "mental" not in low or low == "posto de saúde":
            kind = "clinic"
        else:
            continue
        lat, lon = coord(r.get("LAT")), coord(r.get("LON"))
        name = re.sub(r"\s+", " ", r.get("US") or "").strip(" .")
        if lat is None or lon is None or not name:
            continue
        if lat > 0:
            lat = -lat
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        if not HAS_NAME.search(name):
            label = re.sub(r"\s+(Rural|Urbano)\s+[IABC]+$", "", cls)  # "Centro de Saúde Rural II" -> "Centro de Saúde"
            name = f"{label} {name}"
        district = (r.get("ADMIN2NAMES") or "").strip()
        rows.append({
            "source": "mz-misau", "code": str(r.get("CUUS") or "").strip(), "kind": kind, "lat": lat, "lon": lon, "name": name,
            "holder": "Ministério da Saúde", "phone": "", "address": ", ".join(x for x in (district, (r.get("ADMIN1NAME") or "").strip()) if x),
            "municipality": district, "precision": "source",
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
        res = next(x for x in pkg["resources"] if "master health facility list" in (x.get("name") or "").lower())
        raw, updated = get(res["url"])
        updated = res.get("last_modified") or updated
        rows = places(raw)
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["mz-misau"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[mz-misau] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("mz-misau")
        rows = previous
        report["mz-misau"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[mz-misau] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
