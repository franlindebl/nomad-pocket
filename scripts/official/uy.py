"""Uruguay's public hospitals and primary care from ASSE (Administración de los Servicios de Salud del Estado, the
public health provider): hospitals, health centres, polyclinics and consultorios, most of them in small towns.
Written as one TSV that scripts/official/merge.py adds to Uruguay's emergency points where OpenStreetMap lacks
them. Run monthly by .github/workflows/official-points.yml into the `official-points` release, which the pack build
reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "Unidades Asistenciales de ASSE" on catalogodatos.gub.uy (CKAN), monthly, with coordinates; Licencia
de Datos Abiertos de Uruguay (attribution: the provider, the licence, the dataset and that it was modified). The
file name carries the date, so its URL is read from the dataset. Private providers (mutualistas) and pharmacies are
not in it. Left out: mental health units, residences and units without a category.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I uy.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
PACKAGE = "https://catalogodatos.gub.uy/api/3/action/package_show?id=unidades-asistenciales-de-asse"
MIN_SHARE = 0.8
BBOX = (-35.2, -58.6, -30.0, -53.0)
SOURCES = {
    "uy-asse": {
        "name": "Unidades Asistenciales de ASSE",
        "publisher": "Administración de los Servicios de Salud del Estado (ASSE)",
        "licence": "Licencia de Datos Abiertos de Uruguay",
        "url": "https://catalogodatos.gub.uy/dataset/unidades-asistenciales-de-asse",
    },
}
# Categoria → kind.
KINDS = {"HOSPITAL": "hospital", "CENTRO DE SALUD": "clinic", "POLICLINICA": "clinic", "CONSULTORIO": "clinic"}
LABELS = {"HOSPITAL": "Hospital", "CENTRO DE SALUD": "Centro de Salud", "POLICLINICA": "Policlínica", "CONSULTORIO": "Consultorio"}


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
    csvs = [r for r in resources if (r.get("format") or "").lower() == "csv" and "unidades_asistenciales_" in r.get("url", "")]
    if not csvs:
        raise RuntimeError("no CSV in the dataset")
    best = max(csvs, key=lambda r: r.get("last_modified") or r.get("created") or "")
    return best["url"], (best.get("last_modified") or best.get("created") or "")[:10]


def num(v):
    try:
        return float((v or "").strip().replace(",", "."))
    except ValueError:
        return None


SMALL = {"de", "del", "la", "las", "los", "y", "e", "el", "en"}


def title(s):
    words = re.sub(r"\s+", " ", s or "").strip().lower().split(" ")
    return " ".join(w if i and w in SMALL else w[:1].upper() + w[1:] for i, w in enumerate(words))


def establishments(raw):
    rows = []
    text = raw.decode("utf-8-sig")
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        category = (r.get("Categoria") or "").strip()
        kind = KINDS.get(category)
        lat, lon = num(r.get("Latitud")), num(r.get("Longitud"))
        code = (r.get("GID") or "").strip()
        if not kind or not code or lat is None or lon is None or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        name = title(r.get("Nombre"))
        # Polyclinics are often named after their place alone ("Aiguá"): say what it is.
        if not re.search(r"\b(hospital|centro|policl[ií]nica|consultorio|sanatorio|cl[ií]nica)\b", name, re.I):
            name = f"{LABELS[category]} {name}"
        street = " ".join(x for x in ((r.get("Calle") or "").strip(), (r.get("Nro Puerta") or "").strip()) if x and x not in ("0", "S/N"))
        rows.append({
            "source": "uy-asse", "code": code, "kind": kind, "lat": lat, "lon": lon, "name": name, "holder": "ASSE",
            "phone": "" if (r.get("Telefono") or "").strip().upper() in ("S/D", "SIN DATO", "0") else (r.get("Telefono") or "").strip(),
            "address": ", ".join(x for x in (street, title(r.get("Localidad"))) if x),
            "municipality": title(r.get("Departamento")), "precision": "source",
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
    report, failed, updated = {}, [], None
    try:
        url, updated = latest_csv()
        rows = establishments(get(url))
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["uy-asse"] = {"rows": len(rows), "status": "fresh", "file": url}
        print(f"[uy-asse] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("uy-asse")
        rows = previous
        report["uy-asse"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[uy-asse] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
