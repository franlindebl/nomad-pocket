"""Chad's health facilities from the Ministry of Public Health's list of health centres and health districts
(`TCD_data_ListeCdsDistrictsSanitaires_MSP_2020.xlsx`, 1,985 rows, 2020), as published on HDX by OCHA Chad: district,
provincial and national hospitals and health centres, with latitude/longitude. Written as one TSV that
scripts/official/merge.py adds to Chad's emergency points where OpenStreetMap lacks them. Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: the XLSX resource of HDX dataset chad-list-of-health-facilities-and-health-districts (dataset source
"Chad, Ministry of health"), resolved through HDX's CKAN API; licence CC BY (HDX: "Creative Commons Attribution
International (CC BY)"). The XLSX is read with the standard library (zip + XML); the data sheet is the one whose
header has LATITUDE. Left out: rows flagged "Non Fonctionnelle" (9%) or "Planifiée" (not built yet), points with under
three decimals or outside Chad, and points stacked three or more on one spot. No pharmacies are listed; health
centres are kind clinic, every "Hôpital ..." is a hospital.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I td.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
CKAN = "https://data.humdata.org/api/3/action/package_show?id=chad-list-of-health-facilities-and-health-districts"
MIN_SHARE = 0.8
BBOX = (7.3, 13.4, 23.6, 24.1)
SOURCES = {
    "td-msp": {
        "name": "Chad - List of health facilities and health districts (MSP 2020)",
        "publisher": "Ministry of Public Health, Chad (via OCHA Chad, Humanitarian Data Exchange)",
        "licence": "Creative Commons Attribution International (CC BY)",
        "url": "https://data.humdata.org/dataset/chad-list-of-health-facilities-and-health-districts",
    },
}
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




def sheet_rows(raw):
    """The data sheet as lists of strings (the workbook has an empty second sheet)."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    strings = [("".join(t.text or "" for t in si.iter(NS + "t"))) for si in ET.fromstring(z.read("xl/sharedStrings.xml"))]
    for name in sorted(n for n in z.namelist() if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", n)):
        rows = []
        for row in ET.fromstring(z.read(name)).iter(NS + "row"):
            cells = {}
            for c in row.findall(NS + "c"):
                idx = 0
                for ch in re.match(r"[A-Z]+", c.get("r")).group():
                    idx = idx * 26 + ord(ch) - 64
                v = c.find(NS + "v")
                if v is not None:
                    cells[idx - 1] = strings[int(v.text)] if c.get("t") == "s" else v.text
            rows.append([cells.get(i, "") for i in range(11)])
        if rows and "LATITUDE" in [h.strip().upper() for h in rows[0]]:
            return rows
    raise RuntimeError("no sheet with a LATITUDE column")


def places(raw):
    table = sheet_rows(raw)
    head = [h.strip().upper() for h in table[0]]
    rows = []
    for vals in table[1:]:
        r = dict(zip(head, vals))
        t = (r.get("TYPES") or "").strip().lower()
        kind = "hospital" if t.startswith(("hôpital", "hopital")) else "clinic" if t.startswith("centre de sant") else None
        lat, lon = coord(r.get("LATITUDE")), coord(r.get("LONGITUDE"))
        name = re.sub(r"\s+", " ", r.get("NOM") or "").strip(" .")
        if not kind or lat is None or lon is None or not name or (r.get("FONCTIONNALITE") or "").strip().lower() != "fonctionnelle":
            continue
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        if kind == "hospital" and not re.search(r"h[oô]pital|\bch[ur]?\b", name, re.I):
            name = f"Hôpital {name}"
        if kind == "clinic" and not re.search(r"centre|\bcs\b|clinique|dispensaire", name, re.I):
            name = f"Centre de santé {name}"
        district = (r.get("NOMDISTRICT") or "").strip()
        rows.append({
            "source": "td-msp", "code": (r.get("CODE_CS_MSP") or "").strip() or f"{name}", "kind": kind, "lat": lat, "lon": lon,
            "name": name, "holder": (r.get("AFFILIATION") or "").strip(), "phone": "", "address": district,
            "municipality": district, "precision": "source",
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
        pkg = json.loads(get(CKAN)[0])["result"]
        res = max((x for x in pkg["resources"] if (x.get("format") or "").upper() == "XLSX"), key=lambda x: x.get("last_modified") or "")
        raw, updated = get(res["url"])
        updated = res.get("last_modified") or updated
        rows = places(raw)
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["td-msp"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[td-msp] {len(rows)} rows (data of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("td-msp")
        rows = previous
        report["td-msp"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[td-msp] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
