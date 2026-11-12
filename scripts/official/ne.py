"""Niger's health structures from the Ministry of Public Health's "carte sanitaire" (`NER_Carte_sanitaire_du_Niger.xlsx`,
5,013 rows, October 2023), as published on HDX by OCHA Niger (dataset source "Ministere de la Santé du Niger"): integrated
health centres (CSI), health centres (CS), health huts / care rooms (SS), private clinics and care cabinets, and
pharmacies, with coordinates for about two thirds. Written as one TSV that scripts/official/merge.py adds to Niger's
emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into the
`official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: the XLSX resource of HDX dataset niger-structures-sanitaires, resolved through HDX's CKAN API; licence CC BY
(HDX: "Creative Commons Attribution International (CC BY)"). The XLSX is read with the standard library (zip + XML); the
sheet is "Entités", whose second row holds HXL tags. Its coordinates column is "[lon, lat]" despite the #geo+latlon tag.
Left out: rows without coordinates ("N/A", about a third), closed ones ("Cloturée", "fermé"), the hospitals' services
(Chirurgie, Pédiatrie...: no coordinates, and the hospitals themselves are not rows), infirmeries (army, prison, police
sick bays), laboratories, dental cabinets, points outside Niger, points stacked three or more on one spot (a district's
centre) and duplicates within 15 m. There is no hospital kind: no hospital has a row of its own.
Pharmacies are kind pharmacy (hospital "pharmacie de cession" included), everything else kind clinic.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I ne.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
CKAN = "https://data.humdata.org/api/3/action/package_show?id=niger-structures-sanitaires"
MIN_SHARE = 0.8
BBOX = (11.6, 0.1, 23.6, 16.1)  # south, west, north, east
SOURCES = {
    "ne-msp": {
        "name": "Niger - Structures sanitaires, carte sanitaire (Ministère de la Santé, 2023)",
        "publisher": "Ministère de la Santé publique du Niger (via OCHA Niger, Humanitarian Data Exchange)",
        "licence": "Creative Commons Attribution International (CC BY)",
        "url": "https://data.humdata.org/dataset/niger-structures-sanitaires",
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
    """The "Entités" sheet as lists of strings (columns A-H)."""
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
            rows.append([cells.get(i, "") for i in range(8)])
        if rows and rows[0][5].strip() == "Name" and rows[0][7].strip() == "Coordinates":
            return rows
    raise RuntimeError("no sheet with Name and Coordinates columns")


CLOSED = re.compile(r"cl[oô]tur|ferm[eé]|\bclos|d[eé]sactiv|supprim", re.I)
SKIP = re.compile(r"infirmerie|laboratoire|dentaire|buccodentaire|ophtalm|kin[eé]|imagerie|radio|optique|vétérinaire|veterinaire", re.I)


def kind_and_label(name):
    """(kind, name with a type word) from the register's abbreviations, or None for what isn't a place to get care."""
    if SKIP.search(name) or CLOSED.search(name):
        return None
    m = re.match(r"(CSI|CS|SS|CM)\b\s*(.*)", name, re.I)
    if m:
        label = {"csi": "Centre de santé intégré", "cs": "Centre de santé", "ss": "Salle de soins", "cm": "Centre médical"}[m.group(1).lower()]
        return "clinic", f"{label} {m.group(2)}".strip()
    if re.match(r"pharmacie", name, re.I):
        return "pharmacy", name
    if re.match(r"(clinique|polyclinique|cabinet|centre|dispensaire)", name, re.I):
        return "clinic", name
    return None


def places(raw):
    table = sheet_rows(raw)
    rows = []
    for vals in table[2:]:  # row 2 is the HXL tags
        # The sheet has a few UTF-8 letters read as Latin-1 on the way in ("Poudrié¨re", "Ché¢teau"): è and â.
        name = re.sub(r"\s+", " ", (vals[5] or "").replace("é¨", "è").replace("é¢", "â")).strip(" .")
        got = kind_and_label(name) if name else None
        nums = re.findall(r"-?\d+(?:\.\d+)?", vals[7] or "") if (vals[7] or "").startswith("[") else []
        if not got or len(nums) != 2 or not all("." in n and len(n.split(".")[1]) >= 3 for n in nums):
            continue
        kind, name = got
        lon, lat = float(nums[0]), float(nums[1])  # the file says latlon but it is [lon, lat]
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        commune = re.sub(r"^commune\s+(de\s+)?", "", (vals[3] or "").strip(), flags=re.I)
        district = re.sub(r"^DS\s+", "", (vals[2] or "").strip())
        rows.append({
            "source": "ne-msp", "code": f"{vals[2].strip()}|{vals[3].strip()}|{vals[5].strip()}", "kind": kind, "lat": lat, "lon": lon,
            "name": name, "holder": "", "phone": "", "address": ", ".join(x for x in (commune, district, vals[1].strip()) if x),
            "municipality": commune, "precision": "source",
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
        report["ne-msp"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[ne-msp] {len(rows)} rows (data of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("ne-msp")
        rows = previous
        report["ne-msp"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[ne-msp] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
