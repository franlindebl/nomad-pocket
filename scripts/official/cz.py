"""Czechia's health points from the National Register of Health Service Providers (NRPZS, ÚZIS for the Ministry of
Health): pharmacies, hospitals and primary care (general practitioners for adults and children, polyclinics,
health centres). Written as one TSV that scripts/official/merge.py adds to Czechia's emergency points where
OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into the `official-points` release,
which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "Místa poskytování zdravotních služeb" (NR-01-06), one row per place where a provider works, with the
address's RÚIAN point (the national address register), refreshed monthly; CC BY 4.0. A building with a GP and a
paediatrician is two rows on one point: points of a kind within 15 m are one (the first name kept).
Left out: specialists, dentists, physiotherapists, labs, opticians and the like (not where you go first), and
spa or long-term care homes. Ambulance stations (481) are in the register too but not an emergency point kind the
merge adds yet.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I cz.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
URL = "https://datanzis.uzis.gov.cz/data/NR-01-NRPZS/NR-01-06/Otevrena-data-NR-01-06-nrpzs-mista-poskytovani-zdravotnich-sluzeb.csv"
MIN_SHARE = 0.8
BBOX = (48.5, 12.0, 51.1, 18.9)
SOURCES = {
    "cz-nrpzs": {
        "name": "Národní registr poskytovatelů zdravotních služeb: místa poskytování (NR-01-06)",
        "publisher": "Ústav zdravotnických informací a statistiky ČR (ÚZIS), Ministerstvo zdravotnictví",
        "licence": "CC BY 4.0",
        "url": "https://www.nzip.cz/data/1823-narodni-registr-poskytovatelu-zdravotnich-sluzeb",
    },
}
# ZZ_druh_kod → kind
KINDS = {
    "510": "pharmacy",   # Lékárna
    "101": "hospital",   # Fakultní nemocnice
    "102": "hospital",   # Nemocnice
    "103": "hospital",   # Specializovaná nemocnice
    "320": "clinic",     # Samostatná ordinace všeobecného praktického lékaře
    "321": "clinic",     # … praktického lékaře pro děti a dorost
    "301": "clinic",     # Poskytovatel ambulantních služeb (nad 5 oborů): polyclinics
    "302": "clinic",     # … (do 5 oborů)
    "310": "clinic",     # Zdravotnické středisko
}
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


def point(v):
    """'POINT(lat lon)': the register writes latitude first."""
    m = re.fullmatch(r"\s*POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)\s*", v or "")
    if not m:
        return None
    lat, lon = float(m.group(1)), float(m.group(2))
    return (lat, lon) if BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3] else None


def meters(a, b):
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[0] - a[0]))


def one_per_spot(rows):
    """A kind's points within SAME_SPOT metres are one place (a health centre's several doctors)."""
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
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        kind = KINDS.get((r.get("ZZ_druh_kod") or "").strip())
        p = point(r.get("ZZ_GPS"))
        if not kind or not p:
            continue
        street = " ".join(x for x in (r.get("ZZ_ulice") or r.get("ZZ_obec") or "", r.get("ZZ_cislo_domovni_orientacni") or "") if x)
        rows.append({
            "source": "cz-nrpzs", "code": r["ZZ_misto_poskytovani_ID"].strip(), "kind": kind, "lat": p[0], "lon": p[1],
            "name": re.sub(r"\s+", " ", r.get("ZZ_nazev") or "").strip(),
            "holder": re.sub(r"\s+", " ", r.get("poskytovatel_nazev") or "").strip(),
            "phone": (r.get("poskytovatel_telefon") or "").split(",")[0].strip(),
            "address": f"{street}, {r.get('ZZ_PSC', '')} {r.get('ZZ_obec', '')}".strip(", "),
            "municipality": (r.get("ZZ_obec") or "").strip(), "precision": "source",
        })
    # Hospitals first so a campus keeps its hospital's name; then pharmacies, then clinics.
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    return one_per_spot(sorted(rows, key=lambda r: order[r["kind"]]))


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
        raw, updated = get(URL)
        rows = places(raw)
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["cz-nrpzs"] = {"rows": len(rows), "status": "fresh", "updated": updated}
        print(f"[cz-nrpzs] {len(rows)} rows (file of {updated})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("cz-nrpzs")
        rows = previous
        report["cz-nrpzs"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[cz-nrpzs] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
