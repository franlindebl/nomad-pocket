"""France's health points from FINESS (Fichier national des établissements sanitaires et sociaux, Ministry of Health):
pharmacies, hospitals, health centres, multi-professional health homes and walk-in care. Written as one TSV that
scripts/official/merge.py adds to France's emergency points where OpenStreetMap lacks them. Run monthly by
.github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: "FINESS - Structures" (FINESS+, Agence du Numérique en Santé) on data.gouv.fr, a monthly JSON of every
legal entity and its establishments, Licence Ouverte 2.0 (Etalab, attribution). Most establishments carry their
address's point in the national address base (BAN); those without one (~20%) are placed with the national
geocoder (Géoplateforme, IGN, on the BAN; same licence), keeping a house number in the right commune, else the
street. Metropolitan France only: the overseas departments are packs of their own (none built yet for them).
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I fr.py <out.tsv> [--previous <tsv>] [--geocache <tsv>] [--limit N]
Standard library only (CI runs it on a bare runner).
"""
import concurrent.futures
import csv
import gzip
import json
import re
import sys
import threading
import time
import urllib.parse
import urllib.request

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
DATASET = "https://www.data.gouv.fr/api/1/datasets/finess-structures-1/"
GEOCODER = "https://data.geopf.fr/geocodage/search"
GEOCODER_THREADS = 4  # the service allows 50 requests a second
MIN_SHARE = 0.8
BBOX = (41.3, -5.2, 51.2, 9.6)  # metropolitan France and Corsica
SOURCES = {
    "fr-finess": {
        "name": "FINESS - Structures (FINESS+)",
        "publisher": "Ministère de la Santé / Agence du Numérique en Santé",
        "licence": "Licence Ouverte 2.0 (Etalab)",
        "url": "https://www.data.gouv.fr/datasets/finess-structures-1",
    },
}
# FINESS establishment category → kind.
KINDS = {
    "620": "pharmacy",  # Pharmacie d'officine
    "101": "hospital",  # Centre hospitalier régional (CHR/CHU)
    "355": "hospital",  # Centre hospitalier (CH)
    "106": "hospital",  # Centre hospitalier, ex hôpital local
    "365": "hospital",  # Établissement de soins pluridisciplinaire (private clinics with surgery and medicine)
    "124": "clinic",    # Centre de santé
    "603": "clinic",    # Maison de santé pluriprofessionnelle
    "617": "clinic",    # Lieux de soins non programmés (walk-in care)
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


def latest_file():
    """The newest monthly file (finess-structures-mensuel-YYYYMM.json.gz) of the dataset."""
    resources = json.loads(get(DATASET, timeout=60))["resources"]
    monthly = [r for r in resources if re.search(r"mensuel-\d{6}\.json\.gz$", r.get("url", ""))]
    if not monthly:
        raise RuntimeError("no monthly file in the dataset")
    best = max(monthly, key=lambda r: r["url"].rsplit("-", 1)[-1])
    return best["url"], best["url"].rsplit("-", 1)[-1][:6]


def num(v):
    """FINESS writes coordinates as strings."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


SMALL = {"de", "du", "des", "la", "le", "les", "d", "l", "et", "a", "au", "aux", "en", "sur", "sous"}


def title(s):
    words = re.sub(r"\s+", " ", s or "").strip().lower().split(" ")
    out = []
    for i, w in enumerate(words):
        elision = re.match(r"([dl]')(.+)", w)
        if elision:  # d'Ambérieu, l'Hôpital
            out.append((elision.group(1) if i else elision.group(1).upper()) + elision.group(2)[:1].upper() + elision.group(2)[1:])
        elif i and w in SMALL:
            out.append(w)
        else:
            out.append("-".join(p[:1].upper() + p[1:] for p in w.split("-")))
    return " ".join(out)


def establishments(data):
    rows = []
    for pm in data.get("pmej") or []:
        holder = ((pm.get("informationsGeneralesPMEJ") or {}).get("denominationPm") or "").strip()
        for e in pm.get("ege") or []:
            info = e.get("informationsGeneralesEGE") or {}
            kind = KINDS.get(e.get("categorieentiteGeographiqueExercice") or "")
            if not kind or e.get("etatObjet") != "A" or info.get("dateFermeture"):
                continue
            a = (e.get("adresse") or [{}])[0]
            commune = a.get("cogCommune") or ""
            if commune.startswith("97") or commune.startswith("98"):
                continue
            g = a.get("coordonneesGeographique") or {}
            lat, lon = num(g.get("directionLatitude")), num(g.get("directionLongitude"))
            ok = lat is not None and lon is not None and BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]
            phones = [((c.get("telecom") or {}).get("telephone") or "") for c in e.get("contact") or []]
            street = " ".join(str(x) for x in (a.get("numeroVoie"), a.get("typeVoie"), a.get("libelleVoie")) if x)
            name = info.get("nomEgeLong") or info.get("nomEgeCourt") or holder
            rows.append({
                "source": "fr-finess", "code": info.get("numFinessEge") or str(info.get("egeId")), "kind": kind,
                "lat": lat if ok else None, "lon": lon if ok else None, "name": title(name), "holder": holder,
                "phone": next((p for p in phones if p), ""),
                "address": a.get("ligneQuatre") or street, "street": street, "postcode": a.get("codePostal") or "",
                "town": a.get("ligneAcheminement") or "", "municipality": commune,
                "precision": "source" if ok else "",
            })
    return rows


class Geocoder:
    """Géoplateforme (BAN) search filtered to the commune; answers cached by query (only found ones)."""

    def __init__(self, path=None):
        self.cache, self.used, self.asked = {}, {}, 0
        self.lock = threading.Lock()
        if path:
            try:
                with open(path, encoding="utf-8") as f:
                    for line in f:
                        k, lat, lon, prec = line.rstrip("\n").split("\t")
                        self.cache[k] = (float(lat), float(lon), prec)
            except FileNotFoundError:
                pass

    def save(self, path):
        with open(path, "w", encoding="utf-8") as f:
            for k, (lat, lon, prec) in sorted((self.used or self.cache).items()):
                f.write(f"{k}\t{lat:.6f}\t{lon:.6f}\t{prec}\n")

    def locate(self, r):
        text = re.sub(r"\s+", " ", f"{r['street']} {r['postcode']} {r['town']}").strip()
        if not r["street"] or not r["municipality"]:
            return None
        key = f"{r['municipality']}|{text}"
        with self.lock:
            if key in self.cache:
                self.used[key] = self.cache[key]
                return self.cache[key]
            self.asked += 1
        try:
            q = urllib.parse.urlencode({"q": text, "citycode": r["municipality"], "limit": 1, "index": "address"})
            features = json.loads(get(f"{GEOCODER}?{q}", timeout=30, tries=3)).get("features") or []
        except Exception as e:  # noqa: BLE001
            print(f"[geocoder] {text}: {e}", file=sys.stderr)
            return None
        for f in features[:1]:
            p = f.get("properties") or {}
            lon, lat = f["geometry"]["coordinates"]
            if p.get("citycode") != r["municipality"]:
                continue
            if p.get("type") == "housenumber" and p.get("score", 0) >= 0.5:
                hit = (lat, lon, "address")
            elif p.get("type") == "street" and p.get("score", 0) >= 0.6:
                hit = (lat, lon, "street")
            else:
                continue
            with self.lock:
                self.cache[key] = self.used[key] = hit
            return hit
        return None


def place_missing(rows, geocoder, limit=None):
    todo = [r for r in rows if r["lat"] is None]
    if limit is not None:
        todo = todo[:limit]

    def one(r):
        hit = geocoder.locate(r)
        if hit:
            r["lat"], r["lon"], r["precision"] = hit

    with concurrent.futures.ThreadPoolExecutor(GEOCODER_THREADS) as pool:
        list(pool.map(one, todo))
    return sum(1 for r in todo if r["lat"] is None)


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
    limit = int(opt("--limit")) if opt("--limit") else None
    geocoder = Geocoder(opt("--geocache"))
    report, failed, month = {}, [], None
    try:
        url, month = latest_file()
        got = establishments(json.loads(gzip.decompress(get(url))))
        if previous and len(got) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(got)} rows, last month {len(previous)}")
        if not got:
            raise RuntimeError("no rows")
        missed = place_missing(got, geocoder, limit)
        rows = [r for r in got if r["lat"] is not None]
        if not rows:
            raise RuntimeError("no rows with a point")
        geocoded = sum(1 for r in rows if r["precision"] in ("address", "street"))
        report["fr-finess"] = {"rows": len(rows), "status": "fresh", "file": url, "geocoded": geocoded, "notPlaced": missed}
        print(f"[fr-finess] {len(rows)} rows ({geocoded} placed by address, {missed} not placed; {month})", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("fr-finess")
        rows = previous
        report["fr-finess"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[fr-finess] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
    if opt("--geocache"):
        geocoder.save(opt("--geocache"))
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\t".join(COLUMNS) + "\n")
        for r in rows:
            f.write("\t".join(clean(f"{r[c]:.6f}" if c in ("lat", "lon") else r.get(c, "")) for c in COLUMNS) + "\n")
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": kinds, "published": month, "geocoderRequests": geocoder.asked,
                   "sources": report, "meta": SOURCES}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; geocoder requests {geocoder.asked}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
