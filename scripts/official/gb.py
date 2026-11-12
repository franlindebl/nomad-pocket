"""The United Kingdom's pharmacies and GP surgeries from the NHS's Organisation Data Service (ODS), placed on their
postcode with Ordnance Survey's Code-Point Open. Written as one TSV that scripts/official/merge.py adds to the
UK's emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml into
the `official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The sources:
- ODS's Organisation Reference Data API (NHS England), every active community pharmacy (England and Wales), GP
  practice (England and Wales, and Scotland's), and walk-in centre, with its postcode; Open Government Licence v3.
- Code-Point Open (Ordnance Survey), one point per postcode (where its addresses are, a postcode being about
  fifteen of them), monthly; Open Government Licence v3: contains OS data © Crown copyright and database right,
  Royal Mail data © Royal Mail copyright and database right, National Statistics data © Crown copyright and
  database right. Great Britain only: Northern Ireland's postcodes (BT) are not in it, so its practices are left out.
A postcode's point is a few tens of metres from the door in a town and can be further in the country: points
placed only on their sector's centre, or not at all, are left out (Code-Point's quality 60 and 90, a few hundred).
GP practices sharing a postcode (a health centre's) are one point.
A source that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I gb.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
import zipfile

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
ODS = "https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations"
CODEPOINT = "https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect"
MIN_SHARE = 0.8
SOURCES = {
    "gb-ods": {
        "name": "Organisation Data Service: pharmacies, GP practices and walk-in centres (ORD API)",
        "publisher": "NHS England (Organisation Data Service)",
        "licence": "Open Government Licence v3.0",
        "url": "https://digital.nhs.uk/services/organisation-data-service",
    },
    "gb-codepoint": {
        "name": "Code-Point Open (postcode points)",
        "publisher": "Ordnance Survey",
        "licence": "Open Government Licence v3.0 (contains OS data © Crown copyright and database right; Royal Mail data "
                   "© Royal Mail copyright and database right; National Statistics data © Crown copyright and database right)",
        "url": "https://www.ordnancesurvey.co.uk/products/code-point-open",
    },
}
# (query, kind, label added when the name lacks a type word)
QUERIES = [
    ("PrimaryRoleId=RO182", "pharmacy", "Pharmacy"),              # PHARMACY
    ("PrimaryRoleId=RO177&NonPrimaryRoleId=RO76", "clinic", ""),  # GP PRACTICE (a prescribing cost centre)
    ("PrimaryRoleId=RO227", "clinic", ""),                        # SCOTTISH GP PRACTICE
    ("NonPrimaryRoleId=RO87", "clinic", ""),                      # WALK IN CENTRE
]
PAGE = 1000
WORST_QUALITY = 50  # Code-Point's positional quality: 10 on a matched address … 60 the postcode sector's centre, 90 none


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


def osgb_to_wgs84(e, n):
    """British National Grid (OSGB36) easting/northing → WGS84 latitude/longitude (Helmert; a few metres)."""
    a, b = 6377563.396, 6356256.909
    f0, lat0, lon0, n0, e0 = 0.9996012717, math.radians(49), math.radians(-2), -100000, 400000
    e2 = 1 - (b * b) / (a * a)
    nn = (a - b) / (a + b)
    lat, m = lat0, 0
    while True:
        lat = (n - n0 - m) / (a * f0) + lat
        ma = (1 + nn + 1.25 * nn ** 2 + 1.25 * nn ** 3) * (lat - lat0)
        mb = (3 * nn + 3 * nn ** 2 + 2.625 * nn ** 3) * math.sin(lat - lat0) * math.cos(lat + lat0)
        mc = (1.875 * nn ** 2 + 1.875 * nn ** 3) * math.sin(2 * (lat - lat0)) * math.cos(2 * (lat + lat0))
        md = (35 / 24) * nn ** 3 * math.sin(3 * (lat - lat0)) * math.cos(3 * (lat + lat0))
        m = b * f0 * (ma - mb + mc - md)
        if abs(n - n0 - m) < 0.00001:
            break
    s, c, t = math.sin(lat), math.cos(lat), math.tan(lat)
    nu = a * f0 / math.sqrt(1 - e2 * s * s)
    rho = a * f0 * (1 - e2) / (1 - e2 * s * s) ** 1.5
    eta2 = nu / rho - 1
    vii = t / (2 * rho * nu)
    viii = t / (24 * rho * nu ** 3) * (5 + 3 * t * t + eta2 - 9 * t * t * eta2)
    ix = t / (720 * rho * nu ** 5) * (61 + 90 * t * t + 45 * t ** 4)
    x = 1 / (c * nu)
    xi = 1 / (c * 6 * nu ** 3) * (nu / rho + 2 * t * t)
    xii = 1 / (c * 120 * nu ** 5) * (5 + 28 * t * t + 24 * t ** 4)
    xiia = 1 / (c * 5040 * nu ** 7) * (61 + 662 * t * t + 1320 * t ** 4 + 720 * t ** 6)
    de = e - e0
    lat1 = lat - vii * de ** 2 + viii * de ** 4 - ix * de ** 6
    lon1 = lon0 + x * de - xi * de ** 3 + xii * de ** 5 - xiia * de ** 7
    # OSGB36 → WGS84: to cartesian, Helmert, back.
    s1, c1 = math.sin(lat1), math.cos(lat1)
    nu1 = a / math.sqrt(1 - e2 * s1 * s1)
    x1, y1, z1 = nu1 * c1 * math.cos(lon1), nu1 * c1 * math.sin(lon1), (1 - e2) * nu1 * s1
    tx, ty, tz, sc = 446.448, -125.157, 542.060, -20.4894e-6
    rx, ry, rz = (math.radians(v / 3600) for v in (0.1502, 0.2470, 0.8421))
    x2 = tx + (1 + sc) * x1 - rz * y1 + ry * z1
    y2 = ty + rz * x1 + (1 + sc) * y1 - rx * z1
    z2 = tz - ry * x1 + rx * y1 + (1 + sc) * z1
    a2, b2 = 6378137.0, 6356752.3142
    e22 = 1 - (b2 * b2) / (a2 * a2)
    p = math.hypot(x2, y2)
    lat2 = math.atan2(z2, p * (1 - e22))
    for _ in range(10):
        nu2 = a2 / math.sqrt(1 - e22 * math.sin(lat2) ** 2)
        lat2 = math.atan2(z2 + e22 * nu2 * math.sin(lat2), p)
    return math.degrees(lat2), math.degrees(math.atan2(y2, x2))


def postcodes():
    """Postcode (no spaces) → (lat, lon), from Code-Point Open."""
    out = {}
    with zipfile.ZipFile(io.BytesIO(get(CODEPOINT, timeout=600))) as z:
        for name in z.namelist():
            if not re.match(r"Data/CSV/[a-z]+\.csv$", name):
                continue
            for row in csv.reader(io.TextIOWrapper(z.open(name), encoding="utf-8")):
                if len(row) < 4 or not row[2].isdigit():
                    continue
                if int(row[1]) > WORST_QUALITY or row[2] == "0":
                    continue
                out[row[0].replace(" ", "")] = (int(row[2]), int(row[3]))
    if len(out) < 1_000_000:
        raise RuntimeError(f"Code-Point Open: only {len(out)} postcodes")
    return out


def organisations(query):
    rows, offset = [], 0
    while True:
        more = f"&Offset={offset}" if offset else ""  # the API refuses Offset=0 (406)
        page = json.loads(get(f"{ODS}?{query}&Status=Active&Limit={PAGE}{more}", timeout=120))
        got = page.get("Organisations") or []
        rows += got
        offset += len(got)
        if len(got) < PAGE:
            return rows


SMALL = {"and", "of", "the", "at", "in", "on", "for"}


def title(s):
    words = re.sub(r"\s+", " ", s or "").strip().lower().split(" ")
    out = []
    for i, w in enumerate(words):
        if i and w in SMALL:
            out.append(w)
        elif re.fullmatch(r"(nhs|gp|uk|ltd|plc|llp|cic|pcn|hc|mc)", w):
            out.append(w.upper())
        else:
            out.append("-".join(p[:1].upper() + p[1:] for p in w.split("-")))
    return " ".join(out).replace("'S ", "'s ")


def places(points):
    rows, missing = [], 0
    for query, kind, label in QUERIES:
        got = organisations(query)
        if not got:
            raise RuntimeError(f"{query}: no rows")
        for o in got:
            postcode = (o.get("PostCode") or "").upper()
            p = points.get(postcode.replace(" ", ""))
            if not p:
                missing += 1
                continue
            lat, lon = osgb_to_wgs84(*p)
            name = title(o.get("Name"))
            if label and not re.search(r"pharm|chemist|drug|apothecar", name, re.I):
                name = f"{name} {label}"
            rows.append({"source": "gb-ods", "code": o.get("OrgId") or "", "kind": kind, "lat": lat, "lon": lon,
                         "name": name, "holder": "", "phone": "", "address": postcode, "municipality": "",
                         "precision": "postcode"})
    # A walk-in centre that is also a GP practice comes twice; a health centre's several practices share its
    # postcode, and are one point.
    seen, out = set(), []
    for r in rows:
        spot = (r["kind"], r["address"]) if r["kind"] == "clinic" else r["code"]
        if r["code"] not in seen and spot not in seen:
            seen.update((r["code"], spot))
            out.append(r)
    return out, missing


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
        rows, missing = places(postcodes())
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["gb-ods"] = {"rows": len(rows), "status": "fresh", "noPostcodePoint": missing}
        print(f"[gb-ods] {len(rows)} rows ({missing} without a postcode point)", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("gb-ods")
        rows = previous
        report["gb-ods"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[gb-ods] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
