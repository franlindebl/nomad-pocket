"""Argentina's public hospitals and primary-care centres from the IGN's "Edificio de salud" layer (Instituto Geográfico
Nacional, the national mapping agency). Written as one TSV that scripts/official/merge.py adds to Argentina's
emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into the
`official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: the WFS layer ign:salud_020801 of wms.ign.gob.ar (~8,300 points, hospitals and every kind of health centre,
post and dispensary of the provinces and municipalities, built mostly from the Ministry of Health's SISA register and
placed on the building), downloaded as GeoJSON. Terms: https://www.ign.gob.ar/descargas/tyc1.html, see SOURCES.
Why not REFES/REFAR (the ministry's registers on datos.gob.ar, which list 15,000 pharmacies and 39,000 facilities)?
They carry addresses only and declare "No se especificó la licencia"; placed with the government's Georef address API
only ~30% of the pharmacies got a door-level point, and 10-25% of those landed more than 500 m from their OSM twin
(docs/OFFICIAL_POINTS_WORLD.md). So Argentina has no pharmacies here.
Left out: dental, rehabilitation, mental-health and oncology hospitals and centres, geriatric homes, laboratories,
vaccination points, mobile units, administrative offices and military, naval, air force and police hospitals.
The layer has no phone, address or date; the date of the IGN's last update is not published (the layer is "updated
periodically"). Points stacked 3+ on one spot are dropped, a kind's points within 15 m are one.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I ar.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import json
import math
import re
import sys
import time
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
URL = ("https://wms.ign.gob.ar/geoserver/ows?service=WFS&version=1.0.0&request=GetFeature&typeName=ign:salud_020801"
       "&outputFormat=application/json")
MIN_SHARE = 0.8
BBOX = (-55.2, -73.7, -21.7, -53.5)
SAME_SPOT = 15  # metres
SOURCES = {
    "ar-ign": {
        "name": "Edificio de salud (ign:salud_020801)",
        "publisher": "Instituto Geográfico Nacional de la República Argentina",
        "licence": "IGN Términos y Condiciones: 'Debe reconocerse la autoría del Instituto Geográfico Nacional' (FUENTE: Instituto "
                   "Geográfico Nacional de la República Argentina); reuse may include 'la copia, difusión, modificación, adaptación, "
                   "extracción, reordenamiento y combinación'; 'Los datos descargados deben compartirse de manera libre y gratuita'; "
                   "commercial use only in derived works",
        "url": "https://www.ign.gob.ar/NuestrasActividades/InformacionGeoespacial/CapasSIG",
    },
}
# What the layer calls a building (gna) that isn't general or primary care, or isn't open to everyone.
EXCLUDED = re.compile(
    r"odontol|oftalm|psiqui|neuropsi|geri[aá]tr|rehabilit|salud mental|oncol|zoonosis|quemad|neumonol|tisio|endocrin|gastro|"
    r"transmisibles|cr[oó]nicos|d[ií]a\b|laborator|vacunatorio|m[oó]vil|base operativa|albergue|delegaci|regi[oó]n sanitaria|"
    r"instituto|centro de apoyo|ente descentral|penitenciar|recepci[oó]n|centro vecinal|centro regional|diagn[oó]stico precoz|"
    r"militar|naval|aeron[aá]utic|policial|tercera edad|consumo|ancianos|talleres|colonia|residencial|odonto|fundaci[oó]n|"
    r"oncol|sanidad municipal|ambiental|unidad de respuesta|nutrici[oó]n", re.I)
SMALL = {"de", "del", "la", "las", "los", "y", "e", "el", "a", "en"}


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


def title(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    if s != s.upper():  # already mixed case: keep it
        return s
    return " ".join(w if i and w in SMALL else "-".join(p[:1].upper() + p[1:] for p in w.split("-"))
                    for i, w in enumerate(s.lower().split(" ")))


def meters(a, b):
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[0] - a[0]))


def one_per_spot(rows):
    """3+ points of a kind on one spot are a centroid, not places; the rest within SAME_SPOT metres are one place."""
    stacks = {}
    for r in rows:
        stacks.setdefault((r["kind"], round(r["lat"], 5), round(r["lon"], 5)), []).append(r)
    rows = [r for r in rows if len(stacks[(r["kind"], round(r["lat"], 5), round(r["lon"], 5))]) < 3]
    out, grid, cell = [], {}, 0.0005
    for r in rows:
        key = (r["kind"], int(r["lat"] // cell), int(r["lon"] // cell))
        near = [o for di in (-1, 0, 1) for dj in (-1, 0, 1) for o in grid.get((key[0], key[1] + di, key[2] + dj), ())]
        if any(meters((o["lat"], o["lon"]), (r["lat"], r["lon"])) <= SAME_SPOT for o in near):
            continue
        grid.setdefault(key, []).append(r)
        out.append(r)
    return out


def places(raw):
    rows = []
    for f in json.loads(raw).get("features") or []:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        name, type_ = title(p.get("fna")), (p.get("gna") or "").strip()
        if not name or g.get("type") != "Point" or EXCLUDED.search(type_) or EXCLUDED.search(name):
            continue
        lon, lat = g["coordinates"][:2]
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        kind = "hospital" if re.match(r"hospital|policl[ií]nic|maternidad|cl[ií]nica|sanatorio|mini ?hospital|microhospital", type_, re.I) else "clinic"
        rows.append({"source": "ar-ign", "code": str(p.get("gid")), "kind": kind, "lat": lat, "lon": lon, "name": name, "holder": "",
                     "phone": "", "address": "", "municipality": "", "precision": "source"})
    # Hospitals first so a campus keeps its hospital's name.
    return one_per_spot(sorted(rows, key=lambda r: r["kind"] != "hospital"))


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
        report["ar-ign"] = {"rows": len(rows), "status": "fresh"}
        print(f"[ar-ign] {len(rows)} rows", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("ar-ign")
        rows = previous
        report["ar-ign"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[ar-ign] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
