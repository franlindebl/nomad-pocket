"""Iceland's health points from Heilsuvera, the Directorate of Health's map of health services: health centres
(heilsugæslustöðvar), the evening and weekend walk-in clinic (Læknavaktin) and the hospitals' emergency departments
(bráðamóttaka). Written as one TSV that scripts/official/merge.py adds to Iceland's emergency points where
OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into the `official-points` release,
which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: the `heilsuvera` layer of the Directorate's WFS (gis.is/geoserver/embaetti_landlaeknis/ows, data of
Embætti landlæknis and the capital area's health service), refreshed daily. Licence: the layer's metadata record on
gatt.lmi.is states "Creative Commons Attribution 4.0 International (CC BY 4.0). Use and redistribution are permitted".
The layer has no pharmacies. Left out: care homes (Hjúkrunarheimili, Dvalarheimili) and the children's psychiatric
unit's emergency room. The WFS ids change on every refresh, so the code is a slug of name and postcode.
GeoJSON from GeoServer is lon,lat for EPSG:4326, which is what is read here.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I is.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
URL = "https://gis.is/geoserver/embaetti_landlaeknis/ows?" + urllib.parse.urlencode({
    "service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": "embaetti_landlaeknis:heilsuvera",
    "outputFormat": "application/json", "srsName": "EPSG:4326"})
MIN_SHARE = 0.8
BBOX = (63.0, -25.0, 66.8, -13.0)
SOURCES = {
    "is-heilsuvera": {
        "name": "Heilsuvera (health services map), layer embaetti_landlaeknis:heilsuvera",
        "publisher": "Embætti landlæknis (Directorate of Health of Iceland)",
        "licence": "CC BY 4.0",
        "url": "https://gatt.lmi.is/geonetwork/srv/eng/catalog.search#/metadata/7f7f78af-01ae-4769-b759-47930a390922",
    },
}
KINDS = {"Heilsugæslustöðvar": "clinic", "Walk-in Clinic": "clinic", "Bráðamóttaka": "hospital"}
NOT_EMERGENCY = re.compile(r"geðdeild|geðsvið", re.I)


def get(url, timeout=120, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 (any network failure: retry, then the caller keeps last month's)
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def places(raw):
    rows = []
    for f in json.loads(raw)["features"]:
        p = f["properties"]
        kind = KINDS.get(p.get("stationtype"))
        name = re.sub(r"\s+", " ", p.get("name") or "").strip()
        if not kind or not name or NOT_EMERGENCY.search(name):
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        zipcode = (p.get("zip") or "").strip()
        town = re.sub(r"^\d+\s*", "", zipcode)
        rows.append({
            "source": "is-heilsuvera", "code": slug(f"{name} {zipcode}"), "kind": kind, "lat": lat, "lon": lon,
            "name": name + (" (bráðamóttaka)" if kind == "hospital" and "bráðamót" not in name.lower() else ""),
            "holder": "", "phone": (p.get("phone") or "").strip(),
            "address": ", ".join(x for x in ((p.get("address") or "").strip(), zipcode) if x),
            "municipality": town, "precision": "source",
        })
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
        rows = places(get(URL))
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["is-heilsuvera"] = {"rows": len(rows), "status": "fresh"}
        print(f"[is-heilsuvera] {len(rows)} rows", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("is-heilsuvera")
        rows = previous
        report["is-heilsuvera"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[is-heilsuvera] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
