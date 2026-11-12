"""Ukraine's pharmacies and primary-care points from the National Health Service of Ukraine (НСЗУ): the places that
dispense reimbursed medicines (Доступні ліки) and the divisions of the primary-care providers it pays: ambulatories,
feldsher-midwife posts (ФАП, a village's nurse post) and other places of practice. Written as one TSV that
scripts/official/merge.py adds to Ukraine's emergency points where OpenStreetMap lacks them (2026-11: 17,611
pharmacy points, OSM 13,907; 14,250 primary-care divisions, OSM 5,487 clinics, and almost no ФАП). Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The sources: two CSVs on data.gov.ua (CKAN), refreshed weekly from the eHealth system, CC BY 4.0. Each division
has its own coordinates, entered by the provider. Left out: points with under four decimals (a few hundred, a
kilometre off), and points stacked three or more on the same coordinates (a town's centre or the provider's
office standing in for several divisions); two on one spot (a pharmacy and its kiosk, a village's ambulatory and
ФАП) are kept. Only contracted pharmacies are listed (most of the country's, not all), and hospitals are not.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I ua.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
CKAN = "https://data.gov.ua/api/3/action/package_show?id="
MIN_SHARE = 0.8
BBOX = (44.0, 22.0, 52.5, 40.3)
SOURCES = {
    "ua-nszu-pharmacy": {
        "name": "Місця відпуску за договорами із НСЗУ про реімбурсацію лікарських засобів",
        "publisher": "Національна служба здоров'я України (NSZU)",
        "licence": "CC BY 4.0",
        "url": "https://data.gov.ua/dataset/d0f0755f-ce75-4d6b-8310-6e4ddf320c11",
        "package": "d0f0755f-ce75-4d6b-8310-6e4ddf320c11",
        "resource": "reimbursement_legal_entity_divisions_info.csv",
        "kind": "pharmacy",
    },
    "ua-nszu-primary": {
        "name": "Підрозділи надавачів за програмою медичних гарантій (первинна медична допомога)",
        "publisher": "Національна служба здоров'я України (NSZU)",
        "licence": "CC BY 4.0",
        "url": "https://data.gov.ua/dataset/46fa40f9-875b-41ee-8d6f-be2cc3e40ace",
        "package": "46fa40f9-875b-41ee-8d6f-be2cc3e40ace",
        "resource": "pmg_legal_entity_divisions_info.csv",
        "kind": "clinic",
    },
}
# Division types that read as a place's name ("Амбулаторія №3" says it; "Рогозівська 6" doesn't).
TYPE_LABEL = {"Амбулаторія": "Амбулаторія", "ФАП": "ФАП", "Аптека": "Аптека", "Аптечний пункт": "Аптечний пункт"}


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


def resource_url(source):
    """The resource's current URL from CKAN (its id stays, the file is replaced in place each week)."""
    package = json.loads(get(CKAN + source["package"], timeout=60))["result"]
    for r in package["resources"]:
        if r.get("url", "").endswith(source["resource"]):
            return r["url"], (r.get("last_modified") or r.get("created") or "")[:10]
    raise RuntimeError(f"no {source['resource']} in {source['package']}")


def coordinate(v):
    """A coordinate with at least four decimals (~10 m), else None."""
    v = (v or "").strip()
    if not re.fullmatch(r"-?\d+\.\d{4,}", v):
        return None
    return float(v)


def name_of(raw_name, division_type):
    # Pharmacies write their address after a tab in the name ("Аптека №57\tОдеська обл., …").
    name = re.sub(r"\s+", " ", (raw_name or "").split("\t")[0]).strip()
    label = TYPE_LABEL.get(division_type)
    if label and label.lower() not in name.lower():
        name = f"{label} {name}".strip()
    return name or label or ""


def divisions(raw, sid, kind):
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        lat, lon = coordinate(r.get("lat")), coordinate(r.get("lng"))
        if lat is None or lon is None or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        rows.append({
            "source": sid, "code": r["division_id"].strip(), "kind": kind, "lat": lat, "lon": lon,
            "name": name_of(r.get("division_name"), r.get("division_type")),
            "holder": re.sub(r"\s+", " ", r.get("legal_entity_name") or "").strip(),
            "phone": (r.get("division_phone") or "").strip(),
            "address": (r.get("division_addresses") or r.get("residence_addresses") or "").strip(),
            "municipality": (r.get("division_settlement_koatuu") or r.get("residence_settlement_koatuu") or "").strip(),
            "precision": "source",
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
    before = {}
    for r in read_tsv(opt("--previous")) if opt("--previous") else []:
        before.setdefault(r["source"], []).append(r)
    rows, report, failed = [], {}, []
    for sid, source in SOURCES.items():
        old = before.get(sid, [])
        try:
            url, updated = resource_url(source)
            got = divisions(get(url), sid, source["kind"])
            if old and len(got) < MIN_SHARE * len(old):
                raise RuntimeError(f"{len(got)} rows, last month {len(old)}")
            if not got:
                raise RuntimeError("no rows")
            rows.extend(got)
            report[sid] = {"rows": len(got), "status": "fresh", "updated": updated}
            print(f"[{sid}] {len(got)} rows (file of {updated})", file=sys.stderr)
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
    meta = {k: {x: v[x] for x in ("name", "publisher", "licence", "url")} for k, v in SOURCES.items()}
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": kinds, "sources": report, "meta": meta}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
