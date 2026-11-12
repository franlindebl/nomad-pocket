"""Jamaica's public hospitals and health centres from the Ministry of Health and Wellness: 24 hospitals and about 320
health centres (types 1-5, with coordinates), the whole public primary care network. Written as one TSV that
scripts/official/merge.py adds to Jamaica's emergency points where OpenStreetMap lacks them. Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "Health Facilities" on the Jamaica Open Data Portal (data.gov.jm, a DKAN site), published by the Ministry
of Health; licence Open Data Commons Attribution License 1.0 (the dataset's `license` field). The CSV carries the
point as a GeoJSON string and its file URL changes with the portal's re-imports, so it is read from the portal's
metastore API. The dataset dates from 2016 and has not been revised, so it is a stable snapshot: it will miss
facilities opened since, and some points were digitised by hand (column Accuracy). Private clinics, pharmacies and
dentists are not in it.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I jm.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
DATASET = "https://data.gov.jm/api/1/metastore/schemas/dataset/items/66f1bfad-4518-41b2-99d4-27bb2675dca7"
MIN_SHARE = 0.8
BBOX = (17.6, -78.5, 18.6, -76.1)
SOURCES = {
    "jm-moh": {
        "name": "Health Facilities (public health centres and hospitals)",
        "publisher": "Ministry of Health (Jamaica)",
        "licence": "Open Data Commons Attribution License 1.0",
        "url": "https://data.gov.jm/dataset/health-facilities",
    },
}
KINDS = {"Hospital": "hospital", "Health Centre": "clinic"}


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


def csv_url():
    meta = json.loads(get(DATASET, timeout=60))
    urls = [d.get("data", d).get("downloadURL") for d in meta.get("distribution", [])]
    urls = [u for u in urls if u and u.lower().endswith(".csv")]
    if not urls:
        raise RuntimeError("no CSV in the dataset")
    return urls[0], (meta.get("modified") or "")[:10]


def clean(v):
    return str(v or "").replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


def establishments(raw):
    rows, seen = [], set()
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        kind = KINDS.get((r.get("Type") or "").strip())
        try:
            lon, lat = json.loads(r["GeoJSON"])["coordinates"][:2]
            lat, lon = float(lat), float(lon)
        except (KeyError, ValueError, TypeError):
            continue
        if not kind or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        name = re.sub(r"\s+", " ", r.get("H_Name") or "").strip()
        if not name:
            continue
        # Health centres are listed by their place alone ("Alston"): say what it is.
        if not re.search(r"\b(hospital|health cent(re|er)|clinic|infirmary)\b", name, re.I):
            name = f"{name} Health Centre" if kind == "clinic" else f"{name} Hospital"
        # No id in the file: the name and parish identify a facility between months.
        code = re.sub(r"[^a-z0-9]+", "-", f"{name} {r.get('Parish') or ''}".lower()).strip("-")
        if code in seen:
            code += f"-{round(lat, 3)}"
        seen.add(code)
        rows.append({
            "source": "jm-moh", "code": code, "kind": kind, "lat": lat, "lon": lon, "name": name,
            "holder": "Ministry of Health and Wellness", "phone": clean(r.get("Telephone")),
            "address": clean(r.get("Address")), "municipality": clean(r.get("Parish")),
            "precision": "source" if (r.get("Accuracy") or "").strip() == "GPS" else "digitised",
        })
    return rows


def read_tsv(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
            rows.append(r)
    return rows


def main(argv):
    out_path = argv[0]
    opt = lambda name: argv[argv.index(name) + 1] if name in argv else None  # noqa: E731
    previous = read_tsv(opt("--previous")) if opt("--previous") else []
    report, failed, updated = {}, [], None
    try:
        url, updated = csv_url()
        rows = establishments(get(url))
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["jm-moh"] = {"rows": len(rows), "status": "fresh", "file": url}
        print(f"[jm-moh] {len(rows)} rows (dataset of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("jm-moh")
        rows = previous
        report["jm-moh"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[jm-moh] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
