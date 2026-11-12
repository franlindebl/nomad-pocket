"""Chile's hospitals and public primary care from the Ministry of Health's register of establishments (DEIS):
hospitals and inpatient clinics, family health centres (CESFAM, CECOSF), rural posts (postas de salud rural, a
village's nurse post) and urgent care (SAPU, SAR, SUR). Written as one TSV that scripts/official/merge.py adds to
Chile's emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into
the `official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "Establecimientos de Salud" on datos.gob.cl (CKAN), updated about weekly, CC0; the file name carries
the date, so its URL is read from the dataset. Each establishment has its coordinates. Left out: private centres,
labs, dental, dialysis and specialist centres (not where you go first), and closed ones. Pharmacies: the Ministry's
Farmanet service refuses automated clients (HTTP 403), so none yet.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I cl.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
PACKAGE = "https://datos.gob.cl/api/3/action/package_show?id=establecimientos-de-salud-vigentes"
MIN_SHARE = 0.8
# Mainland Chile, Chiloé, Tierra del Fuego, Juan Fernández (Easter Island is too far west for the pack's outline).
BBOX = (-56.0, -81.0, -17.4, -66.0)
SOURCES = {
    "cl-deis": {
        "name": "Establecimientos de Salud",
        "publisher": "Ministerio de Salud de Chile (DEIS)",
        "licence": "CC0 1.0",
        "url": "https://datos.gob.cl/dataset/establecimientos-de-salud-vigentes",
    },
}
# TipoEstablecimientoGlosa → kind (clinics only when they admit patients: "Atención Cerrada").
KINDS = {
    "Hospital": "hospital",
    "Centro de Salud Familiar (CESFAM)": "clinic",
    "Centro Comunitario de Salud Familiar (CECOSF)": "clinic",
    "Posta de Salud Rural (PSR)": "clinic",
    "Servicio de Atención Primaria de Urgencia (SAPU)": "clinic",
    "Servicio de Atención Primaria de Urgencia de Alta Resolutividad (SAR)": "clinic",
    "Servicio de Urgencia Rural (SUR)": "clinic",
    "Consultorio General Rural (CGR)": "clinic",
    "Consultorio General Urbano (CGU)": "clinic",
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
    resources = json.loads(get(PACKAGE, timeout=60))["result"]["resources"]
    csvs = [r for r in resources if (r.get("format") or "").lower() == "csv" and "establecimientos" in r.get("url", "")]
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
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig")), delimiter=";"):
        if not (r.get("EstadoFuncionamiento") or "").lower().startswith("vigente"):
            continue
        kind = KINDS.get((r.get("TipoEstablecimientoGlosa") or "").strip())
        if not kind and r.get("TipoEstablecimientoGlosa") == "Clínica" and "Cerrada" in (r.get("TipoAtencionEstabGlosa") or ""):
            kind = "hospital"
        lat, lon = num(r.get("Latitud")), num(r.get("Longitud"))
        if not kind or lat is None or lon is None or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        street = " ".join(x for x in ((r.get("NombreVia") or "").strip(), (r.get("Numero") or "").strip()) if x and x != "S/N")
        rows.append({
            "source": "cl-deis", "code": (r.get("EstablecimientoCodigo") or "").strip(), "kind": kind, "lat": lat, "lon": lon,
            "name": re.sub(r"\s+", " ", r.get("EstablecimientoGlosa") or "").strip(), "holder": "",
            "phone": (r.get("TelefonoMovil_TelefonoFijo") or "").strip(),
            "address": ", ".join(x for x in (street, (r.get("ComunaGlosa") or "").strip()) if x),
            "municipality": (r.get("ComunaCodigo") or "").strip(), "precision": "source",
        })
    return [r for r in rows if r["code"]]


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
        report["cl-deis"] = {"rows": len(rows), "status": "fresh", "file": url}
        print(f"[cl-deis] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("cl-deis")
        rows = previous
        report["cl-deis"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[cl-deis] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
