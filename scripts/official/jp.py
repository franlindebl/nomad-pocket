"""Japan's health points from the Ministry of Health's register: pharmacies, hospitals and primary-care clinics.
Written as one TSV that scripts/official/merge.py adds to Japan's emergency points where OpenStreetMap lacks them
(2026-06: the register has 61,398 pharmacies, OSM 24,129). Run monthly by .github/workflows/official-points.yml
into the `official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: 医療情報ネット (Iryō Jōhō Net), the national system where every hospital, clinic and pharmacy must report
its details (医療法 / 医薬品医療機器等法). MHLW publishes it as open data twice a year (June and December), one zip
per kind, file names carrying the date: the newest are read from the page. Licence: 公共データ利用規約 (PDL 1.0),
compatible with CC BY 4.0; it asks for the source and a note that the data was processed.
- Pharmacies: all (05_pharmacy).
- Hospitals: all (01-1_hospital_facility_info; 病院 = 20 beds or more).
- Clinics: the register's 80k 診療所 include eye, skin and cosmetic practices; only those offering internal medicine,
  paediatrics, surgery, general practice or emergency care (02-2 speciality file) are kept: a primary-care point.
About 12% of the pharmacies and 6% of the clinics report no coordinates (0.0): their address is placed with GSI's
address search (国土地理院, the national mapping agency; same open terms), keeping only an answer down to the block
or house number whose numbers agree with the address (measured on 200 pharmacies with coordinates: 79% placed,
median 24 m, 90% within 190 m). Answers are kept between runs (--geocache), so a run only asks for new addresses.
A kind whose file can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I jp.py <out.tsv> [--previous <tsv>] [--geocache <tsv>] [--limit N]
Standard library only (CI runs it on a bare runner).
"""
import concurrent.futures
import csv
import io
import json
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
PAGE = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html"
GEOCODER = "https://msearch.gsi.go.jp/address-search/AddressSearch?q="
GEOCODER_THREADS = 4
# A kind with fewer rows than this share of last month's keeps last month's (a truncated or half-published file).
MIN_SHARE = 0.8
# Main islands to Okinotorishima and Minamitorishima.
BBOX = (20.0, 122.0, 46.0, 154.0)
# Clinic specialities that make a clinic a primary-care point (exact names in the register).
PRIMARY = {"内科", "小児科", "外科", "総合診療科", "救急科"}
SOURCES = {
    "jp-mhlw": {
        "name": "医療情報ネットのオープンデータ (pharmacies, hospitals, clinics)",
        "publisher": "厚生労働省 (Ministry of Health, Labour and Welfare)",
        "licence": "公共データ利用規約 第1.0版 (PDL 1.0), compatible with CC BY 4.0",
        "url": PAGE,
    },
}
# file prefix on the page → (kind, name column)
FILES = {
    "05_pharmacy": ("pharmacy", "名称"),
    "01-1_hospital_facility_info": ("hospital", "正式名称"),
    "02-1_clinic_facility_info": ("clinic", "正式名称"),
}
SPECIALITIES = "02-2_clinic_speciality_hours"


def get(url, timeout=180, tries=3):
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


def latest_files():
    """{prefix: url} of the newest publication on the page (links like /content/11121000/05_pharmacy_20260601.csv.zip)."""
    page = get(PAGE).decode("utf-8", "replace")
    found = {}
    for path, prefix, date in re.findall(r'href="(/content/[^"]*?/((?:0\d-\d|0\d)_[a-z_]+)_(\d{8})(?:\.csv)?\.zip)"', page):
        if date > found.get(prefix, ("", ""))[0]:
            found[prefix] = (date, "https://www.mhlw.go.jp" + path)
    missing = [p for p in [*FILES, SPECIALITIES] if p not in found]
    if missing:
        raise RuntimeError(f"no link on the page for {' '.join(missing)}")
    return {p: url for p, (date, url) in found.items()}, max(d for d, _ in found.values())


def zip_rows(raw):
    """Rows of the zip's one CSV as dicts (UTF-8 with BOM), streamed: the speciality file is 130 MB unzipped."""
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = next(n for n in z.namelist() if n.lower().endswith(".csv"))
        with z.open(name) as f:
            yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline=""))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def inside(lat, lon):
    return BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


# --- Addresses ------------------------------------------------------------------------------------------

KANJI = {"〇": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def kanji_number(m):
    n, cur = 0, 0
    for ch in m.group(0):
        if ch == "十":
            n, cur = n + (cur or 1) * 10, 0
        else:
            cur = KANJI[ch]
    return str(n + cur)


def normal(s):
    """NFKC (full-width digits), and the dashes the register writes between numbers (ー, －, ‐…) as '-'."""
    s = unicodedata.normalize("NFKC", s or "").strip()
    return re.sub(r"(?<=\d)\s*[ー−‐―─-]\s*(?=\d)", "-", s)


def numbers(s):
    # GSI writes 丁目 and 番町 numbers in kanji (東梅坪町八丁目), the register in digits.
    s = re.sub(r"[〇一二三四五六七八九十]+(?=丁目|丁|番町|条)", kanji_number, normal(s))
    return [int(x) for x in re.findall(r"\d+", s)]


def good_answer(address, title):
    """GSI answers with the deepest level it knows: a bare town (km off) or another block number (島根県大田市大田町
    大田ロ928 → 大田ロ１０番地). Keep it when it reaches a block or house number and its numbers begin the address's."""
    t, a = numbers(title), numbers(address)
    return bool(t) and t == a[: len(t)] and bool(re.search(r"(号|番地?|\d)$", normal(title)))


class Geocoder:
    """GSI address search, answers cached by normalised address (only found ones)."""

    def __init__(self, path=None):
        self.cache, self.used, self.asked = {}, {}, 0
        self.lock = threading.Lock()
        if path:
            try:
                with open(path, encoding="utf-8") as f:
                    for line in f:
                        k, lat, lon = line.rstrip("\n").split("\t")
                        self.cache[k] = (float(lat), float(lon))
            except FileNotFoundError:
                pass

    def save(self, path):
        # Only the answers this run used (addresses gone from the register drop out); all when it asked none.
        with open(path, "w", encoding="utf-8") as f:
            for k, (lat, lon) in sorted((self.used or self.cache).items()):
                f.write(f"{k}\t{lat:.6f}\t{lon:.6f}\n")

    def locate(self, address):
        key = normal(address).replace("\t", " ")
        with self.lock:
            if key in self.cache:
                self.used[key] = self.cache[key]
                return self.cache[key]
            self.asked += 1
        try:
            answers = json.loads(get(GEOCODER + urllib.parse.quote(key), timeout=30, tries=3))
        except Exception as e:  # noqa: BLE001
            print(f"[geocoder] {key}: {e}", file=sys.stderr)
            return None
        for a in answers[:1]:
            lon, lat = a["geometry"]["coordinates"]
            if good_answer(key, a["properties"].get("title", "")) and inside(lat, lon):
                with self.lock:
                    self.cache[key] = self.used[key] = (lat, lon)
                return (lat, lon)
        return None


# --- The register -----------------------------------------------------------------------------------------


def primary_clinics(raw):
    ids = set()
    for r in zip_rows(raw):
        if r.get("診療科目名") in PRIMARY:
            ids.add(r["ID"])
    return ids


def read_kind(raw, kind, name_column, keep=None):
    out = []
    for r in zip_rows(raw):
        code = (r.get("ID") or "").strip()
        if not code or (keep is not None and code not in keep):
            continue
        lat, lon = num(r.get("所在地座標（緯度）")), num(r.get("所在地座標（経度）"))
        ok = inside(lat, lon)
        out.append({
            "source": "jp-mhlw", "code": code, "kind": kind, "lat": lat if ok else None, "lon": lon if ok else None,
            "name": normal(r.get(name_column)), "holder": "", "phone": "", "address": normal(r.get("所在地")),
            "municipality": (r.get("都道府県コード") or "") + (r.get("市区町村コード") or ""),
            "precision": "source" if ok else "",
        })
    return out


def place_missing(rows, geocoder, limit=None):
    todo = [r for r in rows if r["lat"] is None and r["address"]]
    if limit is not None:
        todo = todo[:limit]

    def one(r):
        hit = geocoder.locate(r["address"])
        if hit:
            r["lat"], r["lon"], r["precision"] = hit[0], hit[1], "address"

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
    before = {}
    for r in previous:
        before.setdefault(r["kind"], []).append(r)
    rows, report, failed = [], {}, []
    try:
        urls, published = latest_files()
        clinics = primary_clinics(get(urls[SPECIALITIES]))
    except Exception as e:  # noqa: BLE001
        urls, published, clinics, failed = {}, None, None, ["page"]
        print(f"[jp-mhlw] FAILED ({e}); keeping last month's rows", file=sys.stderr)
    for prefix, (kind, name_column) in FILES.items():
        old = before.get(kind, [])
        try:
            if not urls:
                raise RuntimeError("no page")
            got = read_kind(get(urls[prefix]), kind, name_column, clinics if kind == "clinic" else None)
            if old and len(got) < MIN_SHARE * len(old):
                raise RuntimeError(f"{len(got)} rows, last month {len(old)}")
            if not got:
                raise RuntimeError("no rows")
            missed = place_missing(got, geocoder, limit)
            placed = [r for r in got if r["lat"] is not None]
            rows.extend(placed)
            geocoded = sum(1 for r in placed if r["precision"] == "address")
            report[kind] = {"rows": len(placed), "status": "fresh", "file": urls[prefix], "geocoded": geocoded, "notPlaced": missed}
            print(f"[jp-mhlw] {kind}: {len(placed)} rows ({geocoded} placed by address, {missed} not placed)", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            failed.append(kind)
            rows.extend(old)
            report[kind] = {"rows": len(old), "status": f"kept last month's: {e}"[:300]}
            print(f"[jp-mhlw] {kind} FAILED ({e}); keeping {len(old)} rows from last month", file=sys.stderr)
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
        json.dump({"rows": len(rows), "kinds": kinds, "published": published, "geocoderRequests": geocoder.asked,
                   "sources": report, "meta": SOURCES}, f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; geocoder requests {geocoder.asked}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
