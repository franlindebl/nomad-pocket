"""Ethiopia's health points from the Ministry of Health's master facility registry, as published on HDX: pharmacies,
hospitals, health centres, health posts (a kebele's post, the first level of care) and clinics. Written as one TSV
that scripts/official/merge.py adds to Ethiopia's emergency points where OpenStreetMap lacks them (2025-02: 9,026
approved pharmacies against OSM's 300; ~29k health centres, posts and clinics against 424). Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "Ethiopia - Health Facilities" on data.humdata.org, source Ministry of Health Ethiopia (its MFR),
uploaded by 3iS, CC BY; a snapshot of 2025-02 (the registry itself needs a login). Only approved facilities.
Measured against OSM where both name a hospital: median 85 m apart (campuses). Points stacked three or more on the
same coordinates (a woreda's centre standing in for several) are left out; specialty clinics, labs, imaging and
offices too.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I et.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import collections
import csv
import io
import json
import re
import sys
import time
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
PACKAGE = "https://data.humdata.org/api/3/action/package_show?id=ethiopian-health-facilities"
MIN_SHARE = 0.8
BBOX = (3.0, 32.9, 15.0, 48.1)
SOURCES = {
    "et-moh": {
        "name": "Ethiopia - Health Facilities (Master Facility Registry)",
        "publisher": "Ministry of Health Ethiopia, via 3iS on HDX",
        "licence": "CC BY 4.0",
        "url": "https://data.humdata.org/dataset/ethiopian-health-facilities",
    },
}
# Type → kind.
KINDS = {"Pharmacy": "pharmacy", "Hospital": "hospital", "Health Center": "clinic", "Health Post": "clinic", "Clinic": "clinic"}


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


def latest_csv():
    resources = json.loads(get(PACKAGE, timeout=60))["result"]["resources"]
    csvs = [r for r in resources if (r.get("format") or "").lower() == "csv"]
    if not csvs:
        raise RuntimeError("no CSV in the dataset")
    best = max(csvs, key=lambda r: r.get("last_modified") or r.get("created") or "")
    return best["url"], (best.get("last_modified") or best.get("created") or "")[:10]


def num(v):
    try:
        return float((v or "").strip().replace(",", "."))
    except ValueError:
        return None


def establishments(raw):
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        kind = KINDS.get((r.get("Type") or "").strip())
        lat, lon = num(r.get("Latitude")), num(r.get("Longitude"))
        code = (r.get("Id") or "").strip()
        if not kind or (r.get("Status") or "").strip() != "Approved" or not code:
            continue
        if lat is None or lon is None or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        name = re.sub(r"^[^\w]+", "", re.sub(r"\s+", " ", r.get("Name") or "")).strip()
        rows.append({
            "source": "et-moh", "code": code, "kind": kind, "lat": lat, "lon": lon, "name": name,
            "holder": (r.get("Ownership") or "").strip(), "phone": "",
            "address": ", ".join(x for x in ((r.get("City") or "").strip(), (r.get("admin3Name") or "").strip()) if x),
            "municipality": (r.get("admin3Pcod") or "").strip(), "precision": "source",
        })
    stacked = collections.Counter((round(r["lat"], 4), round(r["lon"], 4)) for r in rows)
    return [r for r in rows if stacked[(round(r["lat"], 4), round(r["lon"], 4))] < 3]


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
    report, failed, updated = {}, [], None
    try:
        url, updated = latest_csv()
        rows = establishments(get(url))
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["et-moh"] = {"rows": len(rows), "status": "fresh", "file": url}
        print(f"[et-moh] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("et-moh")
        rows = previous
        report["et-moh"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[et-moh] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\t".join(COLUMNS) + "\n")
        for r in rows:
            f.write("\t".join(clean(f"{r[c]:.6f}" if c in ("lat", "lon") else r.get(c, "")) for c in COLUMNS) + "\n")
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": kinds, "published": updated, "sources": report, "meta": SOURCES}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
