"""New Caledonia's health points from the government's open data portal (data.gouv.nc, DASS): "Situation des
structures de santé de Nouvelle Calédonie": pharmacies, hospitals (CHT, CHN, private clinics) and primary care
(provincial dispensaries / CMS and the few medical centres). Written as one TSV that scripts/official/merge.py adds to the
`nc` pack where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into the
`official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: Opendatasoft dataset `situation_etablissements_sante` (CSV export, ~1,240 rows with a point and the
register's FINESS-like number `resemseg`; "declarative data", professionals update it themselves); Licence Ouverte
v2.0 (Etalab), the dataset's own licence field. Only rows with situation OUVERT are kept.
Left out on purpose: every liberal practitioner's cabinet (a named doctor, nurse or physiotherapist, often at home:
privacy), group cabinets of specialists, dentists, opticians, labs, ambulances, rehab, psychiatric and day-hospital
units, care homes and administrations, and propharmacies (a shop's counter, not a pharmacy). A "centre de santé" or
"centre de soins médicaux" is kept only when its name says it is a medical centre or health post.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I nc.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
URL = "https://data.gouv.nc/api/explore/v2.1/catalog/datasets/situation_etablissements_sante/exports/csv?delimiter=%3B"
MIN_SHARE = 0.8
BBOX = (-23.2, 163.4, -19.4, 168.3)
SOURCES = {
    "nc-situation": {
        "name": "Situation des structures de santé de Nouvelle Calédonie",
        "publisher": "Gouvernement de la Nouvelle-Calédonie, DASS (data.gouv.nc)",
        "licence": "Licence Ouverte v2.0 (Etalab)",
        "url": "https://data.gouv.nc/explore/dataset/situation_etablissements_sante/",
    },
}
PHARMACY = {"pharmacie d'officine", "pharmacie mutualiste"}
HOSPITAL = {"centre hospitalier (ch)", "centre hospitalier territorial (cht)", "clinique privée", "etablissement de soins pluridisciplinaire"}
SAME_SPOT = 15  # metres


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


def kind_of(typ, name):
    t, n = typ.strip().lower(), name.strip().lower()
    if t in PHARMACY:
        return None if n.startswith("remplaçant") else "pharmacy"
    if t in HOSPITAL:
        return None if re.search(r"\b(ssr|psy|crnc)\b", n) else "hospital"
    if t in ("dispensaire polyvalent", "dispensaire provincial"):
        return None if re.search(r"\bcmp\b|psych", n) else "clinic"
    if t in ("centre de santé", "centre de soins médicaux"):
        if re.search(r"esth|rééduc|reeduc|kin[eé]|sos m|\bcssr\b", n):
            return None
        return "clinic" if re.search(r"centre m[ée]dical|cabinet m[ée]dical|centre de soins|\bcms\b|poste m[ée]dical", n) else None
    return None


def phone(v):
    first = re.split(r"[/;]", v or "")[0]
    return re.sub(r"[^\d+() ]", "", first).strip()


def places(raw):
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"):
        if (r.get("situation") or "").strip().upper() != "OUVERT":
            continue
        name = re.sub(r"\s+", " ", r.get("denomination") or "").strip()
        kind = kind_of(r.get("type_etablissement") or "", name)
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except (TypeError, ValueError):
            continue
        if not kind or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        commune = (r.get("commune") or "").strip().title()
        rows.append({
            "source": "nc-situation", "code": (r.get("resemseg") or "").strip(), "kind": kind, "lat": lat, "lon": lon,
            "name": name, "holder": re.sub(r"\s+", " ", r.get("raison_sociale") or "").strip(),
            "phone": phone(r.get("contact_telephonique_1")),
            "address": ", ".join(x for x in (re.sub(r"[/\s]+$", "", re.sub(r"\s+", " ", r.get("adresse") or "")), commune) if x),
            "municipality": commune, "precision": "source",
        })
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    rows = one_per_spot(sorted(rows, key=lambda r: order[r["kind"]]))
    codes = [r["code"] for r in rows]
    if "" in codes or len(set(codes)) != len(codes):
        raise RuntimeError("register numbers missing or repeated")
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
        raw, updated = get(URL)
        rows = places(raw)
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["nc-situation"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[nc-situation] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("nc-situation")
        rows = previous
        report["nc-situation"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[nc-situation] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
