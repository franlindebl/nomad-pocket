"""Italy's pharmacies from the Ministry of Health's register (farmacie and dispensari, the rural or seasonal outposts
of a pharmacy), placed by address with ANNCSU. Written as one TSV that scripts/official/merge.py adds to Italy's
emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into the
`official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The register: "Farmacie" (FRM_FARMA_5) on dati.salute.gov.it, updated daily from the regions' notifications; one row
per pharmacy and period, the open ones have no end date. File names carry the date, so the newest link is read from
the dataset page. Licence: Italian Open Data Licence v2.0 (attribution, compatible with CC BY 4.0). Its own
coordinates are NOT used: they are bad (median 377 m from OSM, thousands stacked on one spot).

The placement: ANNCSU (Archivio Nazionale dei Numeri Civici delle Strade Urbane, Agenzia delle Entrate + ISTAT), the
national "indirizzario" open data (INDIR_ITA, ~340 MB zip, 27 M house numbers, ~76% with coordinates set by the
municipalities), CC BY 4.0 (dati.gov.it / RNDT record "Stradari ed indirizzari regionali e nazionali da ANNCSU"). It is read through the zip stream (never unpacked) keeping only the streets the pharmacies are on.
A pharmacy is kept only when its ISTAT municipality + street name + house number (+ letter) has an ANNCSU point, all
of them within 50 m of each other (else the address is ambiguous): the point is ANNCSU's, precision "address". The
rest is dropped (no street match, no number, no coordinates). Hospitals: the Ministry's lists of strutture di
ricovero have no coordinates; not used.
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I it.py <out.tsv> [--previous <tsv>] [--geocache <tsv>] [--anncsu <INDIR_ITA.zip>]
--geocache stores resolved points by "istat|street|number|letter" so a month only reads ANNCSU for new addresses
(--anncsu: a local copy of the zip instead of downloading it). Standard library only (CI runs it on a bare runner).
"""
import csv
import io
import json
import math
import re
import ssl
import sys
import time
import unicodedata
import urllib.request
import zipfile

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
PAGE = "https://www.dati.salute.gov.it/it/dataset/farmacie"
ANNCSU = "https://anncsu.open.agenziaentrate.gov.it/age-inspire/opendata/anncsu/getds.php?INDIR_ITA"
MIN_SHARE = 0.8
AMBIGUOUS_M = 50
# Mainland, Sicily, Sardinia, Lampedusa (and the enclaves around San Marino and the Vatican, which the packs clip).
BBOX = (35.2, 6.5, 47.2, 18.6)
SOURCES = {
    "it-salute": {
        "name": "Farmacie (FRM_FARMA_5) placed with the ANNCSU indirizzario",
        "publisher": "Ministero della Salute; Agenzia delle Entrate and ISTAT (ANNCSU)",
        "licence": "Italian Open Data Licence v2.0 (register); Creative Commons Attribution 4.0 (ANNCSU)",
        "url": PAGE,
    },
}

# dati.salute.gov.it only offers TLS 1.2 with RSA key exchange (AES256-GCM-SHA384), which Python's default
# context leaves out (it wants forward secrecy): the handshake fails. OpenSSL's own defaults include it.
TLS = ssl.create_default_context()
TLS.set_ciphers("DEFAULT")


def open_url(url, timeout=180):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    return urllib.request.urlopen(req, timeout=timeout, context=TLS)


def get(url, timeout=180, tries=3):
    last = None
    for attempt in range(tries):
        try:
            with open_url(url, timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 (any network failure: retry, then the caller keeps last month's)
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def latest_csv():
    page = get(PAGE).decode("utf-8", "replace")
    links = re.findall(r'href="(/sites/default/files/opendata/FRM_FARMA_5_(\d{8})\.csv)"', page)
    if not links:
        raise RuntimeError("no FRM_FARMA_5 CSV link on the page")
    path, date = max(links, key=lambda x: x[1])
    return "https://www.dati.salute.gov.it" + path, date


def num(v):
    try:
        return float((v or "").replace(",", "."))
    except ValueError:
        return None


SMALL = {"di", "del", "della", "delle", "dei", "degli", "da", "e", "in", "al", "alla", "s.n.c.", "s.a.s.", "s.r.l."}


def title(s):
    out = []
    for i, w in enumerate(s.lower().split()):
        out.append(w if i and w in SMALL else w[:1].upper() + w[1:])
    return " ".join(out)


def pharmacy_name(description, kind):
    """The register's name is the shop's sign, its company or its holder ("GALLO MARIO"): always say what it is."""
    name = title(re.sub(r"\s+", " ", description or "").strip())
    word = "Dispensario" if kind == "botiquin" else "Farmacia"
    if not name or name == "-":
        return word
    return name if re.match(r"(farmacia|dispensario|parafarmacia)\b", name, re.I) else f"{word} {name}"


# --- address matching -------------------------------------------------------------------------------------------

# Street-type words and particles carry no identity ("Via Roma" = "VIA ROMA" = "Roma").
TYPES = {"via", "viale", "corso", "piazza", "piazzale", "piazzetta", "largo", "vicolo", "vico", "strada", "stradone",
         "contrada", "localita", "loc", "borgo", "salita", "discesa", "lungomare", "lungotevere", "lungo", "passaggio",
         "traversa", "trav", "rione", "frazione", "fraz", "regione", "reg", "vial", "pza", "so", "sda", "str", "vle",
         "cso", "pzza", "pzzale", "pzle", "strad", "circonvallazione", "galleria", "calle", "campo", "fondamenta"}
PARTICLES = {"di", "del", "della", "delle", "dei", "degli", "dello", "da", "de", "d", "l", "la", "il", "lo", "le", "i",
             "gli", "e", "ed", "a", "al", "alla", "ai", "in", "su", "sul", "sulla", "dal", "dalla", "dell", "all",
             "nell", "sull", "dall", "un", "una"}


def fold(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def street_key(s):
    """Normalised street identity: the significant words, in order. An initial ("C. Felice") stays a letter, so such
    an address fails to match instead of guessing."""
    s = re.sub(r"\b(\d+)\s*[°ºª]", r"\1", fold(s))
    words = [w for w in re.split(r"[^a-z0-9]+", s) if w and w not in PARTICLES]
    while words and words[0] in TYPES:
        words.pop(0)
    return " ".join("san" if w in ("s", "santo", "santa", "sant") else w for w in words)


ADDRESS_RE = re.compile(r"^(.*?)[,\s]+(?:n\.?\s*|n°\s*)?(\d{1,5})\s*(?:[/\-\s]?\s*([a-zA-Z]{1,2}))?\s*$")


def split_address(addr):
    """'Via San Francesco Da Paola, 10' -> ('Via San Francesco Da Paola', '10', ''); None when there is no usable
    number (snc, km, ranges)."""
    a = re.sub(r"\s*\(.*?\)\s*$", "", re.sub(r"\s+", " ", addr or "").strip())
    m = ADDRESS_RE.match(a)
    if not m:
        return None
    street, number, letter = m.group(1).strip(" ,"), m.group(2), (m.group(3) or "").lower()
    # "Via Roma 3/5" would read number 5 on the street "Via Roma 3": reject streets ending in a number.
    if not street or re.search(r"\bkm\b", street.lower()) or re.search(r"\d\s*/?$", street):
        return None
    return street, number, letter


def meters(a, b, c, d):
    return math.hypot((c - a) * 111320, (d - b) * 111320 * math.cos(math.radians(a)))


def pharmacies(raw):
    out = []
    # The file is ASCII with a few broken sequences in names (CIRIEÃ\x82Â¿): read it as Latin-1 so nothing fails.
    for r in csv.DictReader(io.StringIO(raw.decode("latin-1")), delimiter=";"):
        if (r.get("data_fine_validita") or "").strip() not in ("", "-"):
            continue
        kind = "botiquin" if (r.get("descrizione_tipologia") or "").lower().startswith("dispensario") else "pharmacy"
        holder = re.sub(r"\s+", " ", r.get("descrizione_farmacia") or "").strip()
        out.append({
            "source": "it-salute", "code": r["cod_farmacia"].strip(), "kind": kind, "lat": None, "lon": None,
            "reg_lat": num(r.get("latitudine")), "reg_lon": num(r.get("longitudine")),
            "name": pharmacy_name(holder, kind), "holder": holder, "phone": "",
            "address": (r.get("indirizzo") or "").strip(), "municipality": (r.get("cod_comune") or "").strip(),
            "precision": "",
        })
    return out


def stream_anncsu(path_or_url, wanted):
    """Yield (istat, street key, number, letter, lat, lon) for the wanted (istat, street key) pairs that have
    coordinates. The zip holds one ~2 GB CSV: it is read through the zip stream, never unpacked."""
    if path_or_url.startswith("http"):
        tmp = "anncsu.tmp.zip"
        with open_url(path_or_url, 600) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        path_or_url = tmp
    streets = {}
    for istat, key in wanted:
        streets.setdefault(istat, set()).add(key)
    cache = {}
    with zipfile.ZipFile(path_or_url) as z:
        name = next(n for n in z.namelist() if n.upper().startswith("INDIR_ITA") and n.lower().endswith(".csv"))
        with z.open(name) as raw:
            lines = io.TextIOWrapper(raw, encoding="utf-8", newline="")
            next(lines)
            for line in lines:
                p = line.split(";")
                if len(p) < 17 or not p[15] or not p[16] or not p[10].isdigit():
                    continue
                keys = streets.get(p[1])
                if keys is None:
                    continue
                k = cache.get(p[4])
                if k is None:
                    k = cache[p[4]] = street_key(p[4])
                if k not in keys:
                    continue
                lat, lon = num(p[16]), num(p[15])
                if lat is not None and lon is not None:
                    yield p[1], k, p[10], fold(p[11]).strip(), lat, lon


def place(rows, anncsu, cache):
    """Set lat/lon on every row whose address has an unambiguous ANNCSU point; returns counters."""
    stats = {"noNumber": 0, "noMatch": 0, "ambiguous": 0, "placed": 0, "registerWithin50m": 0}
    for r in rows:
        sp = split_address(r["address"])
        k = street_key(sp[0]) if sp else ""
        if not k:
            stats["noNumber"] += 1
            continue
        r["_k"] = (r["municipality"], k, sp[1], sp[2])
    todo = [r for r in rows if "_k" in r and "|".join(r["_k"]) not in cache]
    index = {}
    if todo:
        for istat, k, number, letter, lat, lon in stream_anncsu(anncsu, {(r["_k"][0], r["_k"][1]) for r in todo}):
            index.setdefault((istat, k, number, letter), []).append((lat, lon))
    for r in rows:
        if "_k" not in r:
            continue
        key = "|".join(r["_k"])
        hit = cache.get(key)
        if hit is None:
            pts = index.get(r["_k"])
            if not pts:
                stats["noMatch"] += 1
                continue
            if any(meters(pts[0][0], pts[0][1], la, lo) > AMBIGUOUS_M for la, lo in pts[1:]):
                stats["ambiguous"] += 1
                continue
            hit = cache[key] = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
        lat, lon = hit
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            continue
        r["lat"], r["lon"], r["precision"] = lat, lon, "address"
        stats["placed"] += 1
        if r["reg_lat"] is not None and meters(lat, lon, r["reg_lat"], r["reg_lon"]) <= 50:
            stats["registerWithin50m"] += 1
    return stats


def load_cache(path):
    cache = {}
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                for line in f:
                    k, lat, lon = line.rstrip("\n").split("\t")
                    cache[k] = (float(lat), float(lon))
        except FileNotFoundError:
            pass
    return cache


def save_cache(path, cache, rows):
    used = {"|".join(r["_k"]) for r in rows if "_k" in r}  # only today's pharmacies, so the file doesn't grow
    with open(path, "w", encoding="utf-8") as f:
        for k in sorted(used & set(cache)):
            f.write(f"{k}\t{cache[k][0]:.6f}\t{cache[k][1]:.6f}\n")


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
    cache = load_cache(opt("--geocache"))
    report, failed = {}, []
    try:
        url, date = latest_csv()
        got = pharmacies(get(url))
        seen = set()  # a pharmacy's code is unique among the open ones; keep the first if a day's file repeats one
        got = [r for r in got if not (r["code"] in seen or seen.add(r["code"]))]
        if not got:
            raise RuntimeError("no rows")
        stats = place(got, opt("--anncsu") or ANNCSU, cache)
        rows = [r for r in got if r["lat"] is not None]
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} placed rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows with a point")
        report["it-salute"] = {"rows": len(rows), "status": "fresh", "file": url, "register": len(got), **stats}
        print(f"[it-salute] {len(rows)} of {len(got)} placed ({date}): {stats}", file=sys.stderr)
        if opt("--geocache"):
            save_cache(opt("--geocache"), cache, got)
    except Exception as e:  # noqa: BLE001
        failed.append("it-salute")
        rows, date = previous, None
        report["it-salute"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[it-salute] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("\t".join(COLUMNS) + "\n")
        for r in rows:
            f.write("\t".join(clean(f"{r[c]:.6f}" if c in ("lat", "lon") else r.get(c, "")) for c in COLUMNS) + "\n")
    kinds = {}
    for r in rows:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    with open(out_path.rsplit(".", 1)[0] + ".report.json", "w", encoding="utf-8") as f:
        json.dump({"rows": len(rows), "kinds": kinds, "published": date, "sources": report, "meta": SOURCES}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
