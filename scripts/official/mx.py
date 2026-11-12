"""Mexico's hospitals and public primary care from CLUES (Clave Única de Establecimientos de Salud), the Health
Ministry's catalogue of every health establishment (DGIS, Secretaría de Salud). Written as one TSV that
scripts/official/merge.py adds to Mexico's emergency points where OpenStreetMap lacks them. Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "Establecimientos de Salud" (XLSX, ~26 MB, monthly; the file name carries the month, so it is found on
DGIS's CLUES page), one row per establishment with its point. DGIS: "Las variables de las CLUES están abiertas a
todo el sector salud, no existen restricciones para su uso." Only establishments in operation; hospitals
(establecimientos de hospitalización) of every institution, and outpatient care of the public institutions
(centros de salud, unidades de medicina familiar, rural units, CAAPS); private surgeries, labs, dental, support
and social-assistance establishments left out.
The host doesn't answer some networks (it timed out from the office, 2026-11-12): CI runs it.
The report lists the file's columns, so a change of layout is visible.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I mx.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import collections
import csv
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
PAGE = "http://www.dgis.salud.gob.mx/contenidos/intercambio/clues_gobmx.html"
MIN_SHARE = 0.8
BBOX = (14.3, -118.6, 32.8, -86.5)
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
SOURCES = {
    "mx-clues": {
        "name": "CLUES: Establecimientos de Salud",
        "publisher": "Dirección General de Información en Salud (DGIS), Secretaría de Salud",
        "licence": "Free use: \"no existen restricciones para su uso\" (DGIS)",
        "url": PAGE,
    },
}
PUBLIC = re.compile(r"\b(SSA|IMSS|ISSSTE|PEMEX|SEDENA|SEMAR|BIENESTAR|DIF|ESTATAL|MUNICIPAL|SECRETARIA DE SALUD|"
                    r"SERVICIOS DE SALUD|UNIVERSITARIO|CRUZ ROJA)", re.I)
PRIMARY = re.compile(r"CENTRO DE SALUD|MEDICINA FAMILIAR|RURAL|CAAPS|ATENCION PRIMARIA|CASA DE SALUD|UNIDAD MOVIL|"
                     r"CENTRO AVANZADO", re.I)
NOT_PRIMARY = re.compile(r"DENTAL|ODONTO|LABORATORIO|PSIQUI|REHABILITACION|HEMODIALISIS|OFTALM|ADICCION|SALUD MENTAL|"
                         r"UNIDAD MOVIL|BANCO DE SANGRE|CAPASITS|CAUSES", re.I)


def get(url, timeout=600, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 (any network failure: retry, then the caller keeps last month's)
            last = e
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def plain(s):
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().upper().strip()


def latest_file():
    page = get(PAGE, timeout=120).decode("utf-8", "replace")
    links = re.findall(r'href="([^"]*ESTABLECIMIENTO_SALUD_(\d{6})\.xlsx[^"]*)"', page, re.I)
    if not links:
        raise RuntimeError("no ESTABLECIMIENTO_SALUD_YYYYMM.xlsx link on the CLUES page")
    href, month = max(links, key=lambda h: h[1])
    return urllib.parse.urljoin(PAGE, href.replace("&amp;", "&")), month


def rows_of(raw):
    """The first sheet whose rows include a LATITUD header, as lists of strings (streamed: the sheet is large)."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for _, el in ET.iterparse(z.open("xl/sharedStrings.xml")):
            if el.tag == NS + "si":
                strings.append("".join(t.text or "" for t in el.iter(NS + "t")))
                el.clear()
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    for name in sheets:
        out, header = [], None
        for _, el in ET.iterparse(z.open(name)):
            if el.tag != NS + "row":
                continue
            cells = {}
            for c in el.findall(NS + "c"):
                idx = 0
                for ch in re.match(r"[A-Z]+", c.get("r")).group():
                    idx = idx * 26 + ord(ch) - 64
                v = c.find(NS + "v")
                text = None
                if c.get("t") == "s" and v is not None:
                    text = strings[int(v.text)]
                elif c.get("t") == "inlineStr":
                    text = "".join(t.text or "" for t in c.iter(NS + "t"))
                elif v is not None:
                    text = v.text
                if text is not None:
                    cells[idx - 1] = text
            el.clear()
            row = [cells.get(i, "") for i in range(max(cells) + 1)] if cells else []
            if header is None:
                if any(plain(x) == "LATITUD" for x in row):
                    header = [plain(x) for x in row]
                continue
            out.append(dict(zip(header, row)))
        if header:
            return header, out
    raise RuntimeError("no sheet with a LATITUD column")


def pick(header, *names):
    for n in names:
        for h in header:
            if h == n:
                return h
    for n in names:
        for h in header:
            if n in h:
                return h
    return None


def establishments(header, rows):
    col = {
        "code": pick(header, "CLUES"),
        "name": pick(header, "NOMBRE DE LA UNIDAD", "NOMBRE DE LA UNIDAD MEDICA", "NOMBRE"),
        "institution": pick(header, "NOMBRE DE LA INSTITUCION", "INSTITUCION"),
        "type": pick(header, "NOMBRE TIPO ESTABLECIMIENTO", "TIPO ESTABLECIMIENTO", "TIPO DE ESTABLECIMIENTO"),
        "typology": pick(header, "NOMBRE DE TIPOLOGIA", "TIPOLOGIA"),
        "subtypology": pick(header, "NOMBRE DE SUBTIPOLOGIA", "SUBTIPOLOGIA"),
        "status": pick(header, "NOMBRE ESTATUS DE OPERACION", "ESTATUS DE OPERACION", "ESTATUS"),
        "lat": pick(header, "LATITUD"), "lon": pick(header, "LONGITUD"),
        "street": pick(header, "VIALIDAD", "NOMBRE DE VIALIDAD"), "number": pick(header, "NUMERO EXTERIOR"),
        "town": pick(header, "NOMBRE DE LA LOCALIDAD", "LOCALIDAD"),
        "municipality": pick(header, "NOMBRE DEL MUNICIPIO", "MUNICIPIO"),
        "state": pick(header, "NOMBRE DE LA ENTIDAD", "ENTIDAD"),
    }
    missing = [k for k in ("code", "name", "type", "status", "lat", "lon") if not col[k]]
    if missing:
        raise RuntimeError(f"columns not found: {missing}")
    out = []
    for r in rows:
        val = lambda k: (r.get(col[k]) or "").strip() if col[k] else ""  # noqa: E731
        if "OPERACION" not in plain(val("status")) or "FUERA" in plain(val("status")):
            continue
        try:
            lat, lon = float(val("lat")), float(val("lon"))
        except ValueError:
            continue
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        kind_text = plain(val("type"))
        typology = plain(f"{val('typology')} {val('subtypology')}")
        institution = plain(val("institution"))
        if "HOSPITALIZACION" in kind_text and not NOT_PRIMARY.search(typology):
            kind = "hospital"
        elif ("CONSULTA EXTERNA" in kind_text and PUBLIC.search(institution) and PRIMARY.search(typology)
              and not NOT_PRIMARY.search(typology)):
            kind = "clinic"
        else:
            continue
        name = re.sub(r"\s+", " ", val("name")).strip()
        if kind == "clinic" and not re.search(r"CENTRO|UNIDAD|CLINICA|CASA|HOSPITAL|UMF|CAAPS|CESSA", plain(name)):
            name = f"{val('typology').strip().title()} {name}".strip()
        address = ", ".join(x for x in (f"{val('street')} {val('number')}".strip(), val("town"), val("state")) if x)
        out.append({"source": "mx-clues", "code": val("code"), "kind": kind, "lat": lat, "lon": lon,
                    "name": name.title() if name.isupper() else name, "holder": val("institution"), "phone": "",
                    "address": address, "municipality": val("municipality"), "precision": "source"})
    # A municipality's centre standing in for several establishments.
    stacked = collections.Counter((round(r["lat"], 4), round(r["lon"], 4)) for r in out)
    return [r for r in out if stacked[(round(r["lat"], 4), round(r["lon"], 4))] < 3 and r["code"]], col


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
    report, failed, month, header, col = {}, [], None, [], {}
    try:
        url, month = latest_file()
        header, table = rows_of(get(url))
        rows, col = establishments(header, table)
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["mx-clues"] = {"rows": len(rows), "status": "fresh", "file": url, "tableRows": len(table)}
        print(f"[mx-clues] {len(rows)} rows of {len(table)} ({month})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("mx-clues")
        rows = previous
        report["mx-clues"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[mx-clues] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\t".join(COLUMNS) + "\n")
        for r in rows:
            f.write("\t".join(clean(f"{r[c]:.6f}" if c in ("lat", "lon") else r.get(c, "")) for c in COLUMNS) + "\n")
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": kinds, "published": month, "columns": header, "columnsUsed": col,
                   "sources": report, "meta": SOURCES}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
