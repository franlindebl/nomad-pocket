"""Dominican Republic's public health facilities from the Servicio Nacional de Salud's open data (datos.gob.do,
"Establecimientos de Salud del SNS"): hospitals, first-level health centres, consultorios and community centres.
Written as one TSV that scripts/official/merge.py adds to the `do` pack (Haiti + Dominican Republic) where
OpenStreetMap lacks them; only Dominican points are in it.

The source: the SNS's CSV of the public network (about 1,900 rows, 'Habilitado'), with a point per facility;
licence ODbL (the dataset's licence on datos.gob.do, `odc-odbl`). The SNS publishes no pharmacies.
Left out: diagnostic centres (labs and imaging), rows not 'Habilitado', points outside the country, and points
stacked three or more on one spot (a place's centre standing in for several). Names get their type in front when
the name alone says nothing ("CENTRO DE PRIMER NIVEL"-class rows are named after the barrio).
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I do.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
URL = "https://sns.gob.do/archivos/datosabiertos/establecimientos/Establecimientos%20de%20Salud%20Habilitados,%20SNS,%201878-2026.csv"
MIN_SHARE = 0.8
BBOX = (17.4, -72.1, 20.1, -68.2)
SOURCES = {
    "do-sns": {
        "name": "Establecimientos de Salud del SNS (datos.gob.do)",
        "publisher": "Servicio Nacional de Salud (SNS), República Dominicana",
        "licence": "ODbL (Open Data Commons Open Database License)",
        "url": "https://datos.gob.do/dataset/establecimientos-de-salud-sns",
    },
}
KINDS = {
    "HOSPITAL": "hospital",
    "CENTRO DE PRIMER NIVEL": "clinic",
    "CONSULTORIO": "clinic",
    "CENTRO DE ZONA": "clinic",
    "CENTRO COMUNITARIO": "clinic",
    "CENTRO AMBULATORIO": "clinic",
}
LABEL = {"CENTRO DE PRIMER NIVEL": "Centro de salud", "CONSULTORIO": "Consultorio", "CENTRO DE ZONA": "Centro de zona",
         "CENTRO COMUNITARIO": "Centro comunitario", "CENTRO AMBULATORIO": "Centro ambulatorio"}
TYPE_WORDS = re.compile(r"\b(hospital|centro|clinica|clínica|consultorio|dispensario|upsc|unap|policlinico|policlínico)\b", re.I)
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


def kind_of(tipo):
    t = tipo.strip().upper()
    return "hospital" if t.startswith("HOSPITAL") else KINDS.get(t), t


def places(raw):
    rows = []
    for i, r in enumerate(csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))):
        if (r.get("ESTADO") or "").strip().lower() != "habilitado":
            continue
        kind, t = kind_of(r.get("TIPO") or "")
        try:
            lat, lon = float(r["LATCENTRO"]), float(r["LONCENTRO"])
        except (TypeError, ValueError):
            continue
        if not kind or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        name = re.sub(r"\s+", " ", r.get("NOMBRE DEL ESTABLECIMIENTO") or "").strip().title()
        if kind == "clinic" and not TYPE_WORDS.search(name):
            name = f"{LABEL[t]} {name}"
        mun = (r.get("MUNICIPIO") or "").strip().title()
        rows.append({
            "source": "do-sns", "kind": kind, "lat": lat, "lon": lon, "name": name,
            "holder": "Servicio Nacional de Salud", "phone": "", "precision": "source",
            "address": ", ".join(x for x in (re.sub(r"\s+", " ", r.get("DIRECCION DEL CENTRO") or "").strip().title(),
                                             (r.get("BARRIO") or "").strip().title(), mun) if x),
            "municipality": mun,
        })
    stacks = {}
    for r in rows:
        stacks[(round(r["lat"], 4), round(r["lon"], 4))] = stacks.get((round(r["lat"], 4), round(r["lon"], 4)), 0) + 1
    rows = [r for r in rows if stacks[(round(r["lat"], 4), round(r["lon"], 4))] < 3]
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    rows = one_per_spot(sorted(rows, key=lambda r: order[r["kind"]]))
    # No stable id in the CSV: name + rounded point (a facility keeps both between months).
    for r in rows:
        r["code"] = re.sub(r"\W+", "-", f"{r['name']}-{r['lat']:.3f}-{r['lon']:.3f}".lower()).strip("-")
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
        report["do-sns"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[do-sns] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("do-sns")
        rows = previous
        report["do-sns"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[do-sns] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
