"""Peru's hospitals and primary care from RENIPRESS, the national register of health service providers (SUSALUD):
hospitals and inpatient clinics, health centres, polyclinics and health posts (puestos de salud, a village's
post). Written as one TSV that scripts/official/merge.py adds to Peru's emergency points where OpenStreetMap lacks
them. Run monthly by .github/workflows/official-points.yml into the `official-points` release, which the pack build
reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "Registro Nacional de IPRESS (RENIPRESS)" on datosabiertos.gob.pe, a monthly CSV whose name carries the
date (RENIPRESS_30-10-2026.csv): the newest link is read from the dataset page. Open Data Commons Attribution
(ODC-By). About a quarter of the active establishments have no coordinates: left out (no national open geocoder).
Left out too: private doctors' offices, labs, dental, opticians, imaging and the like, and closed establishments.
Pharmacies are in DIGEMID's register, which has no bulk download.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I pe.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import io
import json
import re
import sys
import time
import urllib.request

# The portal answers 418 to a User-Agent carrying a URL (and to Python's own): the bare name it accepts.
UA = "NomadPocket-official/1.0"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
PAGE = "https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress"
MIN_SHARE = 0.8
BBOX = (-18.5, -81.5, 0.1, -68.5)
SOURCES = {
    "pe-renipress": {
        "name": "Registro Nacional de Instituciones Prestadoras de Servicios de Salud (RENIPRESS)",
        "publisher": "Superintendencia Nacional de Salud (SUSALUD)",
        "licence": "Open Data Commons Attribution License (ODC-By)",
        "url": PAGE,
    },
}
# CLASIFICACION → kind.
KINDS = {
    "HOSPITALES O CLINICAS DE ATENCION GENERAL": "hospital",
    "HOSPITALES O CLINICAS DE ATENCION ESPECIALIZADA": "hospital",
    "CENTROS DE SALUD CON CAMAS DE INTERNAMIENTO": "clinic",
    "CENTROS DE SALUD O CENTROS MEDICOS": "clinic",
    "POLICLINICOS": "clinic",
    "PUESTOS DE SALUD O POSTAS DE SALUD": "clinic",
}


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
    page = get(PAGE, timeout=60).decode("utf-8", "replace")
    links = re.findall(r'href="(https://www\.datosabiertos\.gob\.pe/sites/default/files/RENIPRESS_(\d\d)-(\d\d)-(\d{4})\.csv)"', page)
    if not links:
        raise RuntimeError("no RENIPRESS CSV link on the page")
    url, d, m, y = max(links, key=lambda x: (x[3], x[2], x[1]))
    return url, f"{y}-{m}-{d}"


def num(v):
    try:
        return float((v or "").strip().replace(",", "."))
    except ValueError:
        return None


SMALL = {"de", "del", "la", "las", "los", "y", "e", "el", "en"}


def title(s):
    words = re.sub(r"\s+", " ", s or "").strip().lower().split(" ")
    return " ".join(w if i and w in SMALL else w[:1].upper() + w[1:] for i, w in enumerate(words))


# A health post is often named after its village alone ("La Novia"): say what it is.
LABELS = {"PUESTOS DE SALUD O POSTAS DE SALUD": "Puesto de Salud", "CENTROS DE SALUD O CENTROS MEDICOS": "Centro de Salud",
          "CENTROS DE SALUD CON CAMAS DE INTERNAMIENTO": "Centro de Salud", "POLICLINICOS": "Policlínico",
          "HOSPITALES O CLINICAS DE ATENCION GENERAL": "Hospital", "HOSPITALES O CLINICAS DE ATENCION ESPECIALIZADA": "Hospital"}
TYPE_WORDS = re.compile(r"\b(puesto|posta|centro|c\.\s?s\.|hospital|cl[ií]nica|policl[ií]nico|essalud|ministerio|instituto)\b", re.I)


def named(name, classification):
    label = LABELS.get((classification or "").strip(), "")
    return name if not label or TYPE_WORDS.search(name) else f"{label} {name}".strip()


def establishments(raw):
    rows, seen = [], set()
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"):
        kind = KINDS.get((r.get("CLASIFICACION") or "").strip())
        code = (r.get("COD_IPRESS") or "").strip()
        if not kind or (r.get("ESTADO") or "").strip() != "ACTIVO" or not code or code in seen:
            continue
        lat, lon = num(r.get("NORTE")), num(r.get("ESTE"))
        if lat is None or lon is None or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        seen.add(code)
        rows.append({
            "source": "pe-renipress", "code": code, "kind": kind, "lat": lat, "lon": lon,
            "name": named(title(r.get("NOMBRE")), r.get("CLASIFICACION")), "holder": (r.get("INSTITUCION") or "").strip(),
            "phone": (r.get("TELEFONO") or "").strip(),
            "address": ", ".join(x for x in ((r.get("DIRECCION") or "").strip(), title(r.get("DISTRITO"))) if x),
            "municipality": (r.get("UBIGEO") or "").strip(), "precision": "source",
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
        report["pe-renipress"] = {"rows": len(rows), "status": "fresh", "file": url}
        print(f"[pe-renipress] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("pe-renipress")
        rows = previous
        report["pe-renipress"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[pe-renipress] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
