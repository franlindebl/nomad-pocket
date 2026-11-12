"""DR Congo's health facilities from GRID3 COD - Health Facilities (v9.0 or newest) on HDX: hospitals and health
centres, health posts, dispensaries and clinics. Written as one TSV that scripts/official/merge.py adds to the `cd`
pack where OpenStreetMap lacks them.

The source: GRID3 COD Health Facilities, a GeoPackage of about 39,000 points compiled by CIESIN (Columbia University)
and GRID3 with the Ministère de la Santé Publique, Hygiène et Prévention, from the ministry's DHIS2 list, GPS
surveys and vaccination-campaign data. Published by CIESIN/GRID3, not by the ministry itself, and "operational": the
dataset's caveats say it is not fully validated by the government and that some provinces rely on 2018 data.
Licence CC BY 4.0 (HDX: "Creative Commons Attribution International (CC BY)"). No pharmacies in it.
Left out: community care sites (volunteer "Site Soin Communautaire"), zone health-office buildings, "Autre" and
untyped rows, health centres and posts placed before 2024 (CLINICS_SINCE: the older points are much further from
OSM's), points outside the country, and points stacked three or more on one spot. The dataset's id carries its
version (v9.0): a new version is a new HDX dataset, so PACKAGE needs updating then. Names get their type in
front when the name alone says nothing.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I cd.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import json
import math
import os
import re
import sqlite3
import sys
import tempfile
import time
import urllib.parse
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
MIN_SHARE = 0.8
BBOX = (-13.5, 12.0, 5.4, 31.4)
PACKAGE = "https://data.humdata.org/api/3/action/package_show?id=grid3-cod-health-facilities-v9-0"
SOURCES = {
    "cd-grid3": {
        "name": "GRID3 COD - Health Facilities v9.0",
        "publisher": "CIESIN (Columbia University) and GRID3, with the Ministère de la Santé Publique, Hygiène et Prévention de la RDC",
        "licence": "Creative Commons Attribution 4.0 (CC BY)",
        "url": "https://data.humdata.org/dataset/grid3-cod-health-facilities-v9-0",
    },
}
KINDS = {
    "Hôpital": "hospital", "Hôpital Général de Référence": "hospital", "Centre Hopitalier": "hospital",
    "Centre de Santé": "clinic", "Centre de Santé de Référence": "clinic", "Poste de Santé": "clinic",
    "Centre Médical": "clinic", "Dispensaire": "clinic", "Clinique": "clinic", "Polyclinque": "clinic",
}
LABEL = {"Centre de Santé": "Centre de santé", "Centre de Santé de Référence": "Centre de santé de référence",
         "Poste de Santé": "Poste de santé", "Centre Médical": "Centre médical", "Dispensaire": "Dispensaire",
         "Clinique": "Clinique", "Polyclinque": "Polyclinique"}
TYPE_WORDS = re.compile(r"\b(h[oô]pital|centre|clinique|polyclinique|dispensaire|poste|cs|csr|hgr|ps|cm|cmr|maternit[eé]|cmq|chu)\b", re.I)
SAME_SPOT = 15  # metres
# Health centres and posts placed before this year are left out: of those sharing a name with an OSM clinic, the
# 2024-and-later ones sit 26 m from it at the median (5.6% over 2 km), the older ones 177 m (15%: Nigeria's GRID3
# v4.0 was rejected at 25%). Hospitals pass at any date (median 54 m, 3% over 2 km).
CLINICS_SINCE = 2024


def get(url, timeout=600, tries=3):
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
    out, grid, cell = [], {}, 0.0005
    for r in rows:
        key = (r["kind"], int(r["lat"] // cell), int(r["lon"] // cell))
        near = [o for di in (-1, 0, 1) for dj in (-1, 0, 1) for o in grid.get((key[0], key[1] + di, key[2] + dj), ())]
        if any(meters((o["lat"], o["lon"]), (r["lat"], r["lon"])) <= SAME_SPOT for o in near):
            continue
        grid.setdefault(key, []).append(r)
        out.append(r)
    return out


def gpkg_url():
    """The newest GeoPackage of the dataset (the resource is re-uploaded under a new id on each version)."""
    meta = json.loads(get(PACKAGE, timeout=60))["result"]
    for res in meta["resources"]:
        if res["format"].lower() == "geopackage" and re.search(r"health_facilities_v[\d_]+\.gpkg$", res["download_url"], re.I):
            return res["download_url"]
    raise RuntimeError("no GeoPackage resource in the dataset")


def places(raw):
    fd, path = tempfile.mkstemp(suffix=".gpkg")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        db = sqlite3.connect(path)
        table = db.execute("select table_name from gpkg_contents where data_type='features'").fetchone()[0]
        cur = db.execute(f'select essnom1, esstype, categorie, zonesante, airesante, localite, lat, lon, grid3id, date from "{table}"')
        data = cur.fetchall()
        db.close()
    finally:
        os.unlink(path)
    rows = []
    for nm, t, cat, zs, aire, loc, lat, lon, gid, date in data:
        kind = KINDS.get((t or "").strip())
        year = int(str(date)[:4]) if str(date or "")[:4].isdigit() else 0
        if kind == "clinic" and year < CLINICS_SINCE:
            continue
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            continue
        name = re.sub(r"\s+", " ", nm or "").strip()
        if not kind or not name or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        if kind == "clinic" and not TYPE_WORDS.search(name):
            name = f"{LABEL[t.strip()]} {name}"
        rows.append({
            "source": "cd-grid3", "kind": kind, "lat": lat, "lon": lon, "name": name, "holder": (cat or "").strip(),
            "phone": "", "precision": "source", "code": gid or "",
            "address": ", ".join(x for x in ((loc or "").strip(), (aire or "").strip()) if x), "municipality": (zs or "").strip(),
        })
    stacks = {}
    for r in rows:
        k = (round(r["lat"], 4), round(r["lon"], 4))
        stacks[k] = stacks.get(k, 0) + 1
    rows = [r for r in rows if stacks[(round(r["lat"], 4), round(r["lon"], 4))] < 3]
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    rows = one_per_spot(sorted(rows, key=lambda r: order[r["kind"]]))
    for r in rows:  # GRID3's own id is stable between versions; fall back to name + point
        r["code"] = r["code"] or re.sub(r"\W+", "-", f"{r['name']}-{r['lat']:.3f}-{r['lon']:.3f}".lower()).strip("-")
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
    previous = read_tsv(opt("--previous")) if opt("--previous") else []
    report, failed = {}, []
    try:
        rows = places(get(gpkg_url()))
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["cd-grid3"] = {"rows": len(rows), "status": "fresh"}
        print(f"[cd-grid3] {len(rows)} rows", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("cd-grid3")
        rows = previous
        report["cd-grid3"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[cd-grid3] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
