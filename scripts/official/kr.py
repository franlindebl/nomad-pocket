"""South Korea's health points from HIRA's (Health Insurance Review & Assessment Service) "National hospitals and
pharmacies" file on data.go.kr: pharmacies, hospitals and primary care (health centres and posts, plus clinics of
internal medicine, family medicine or paediatrics). Written as one TSV that scripts/official/merge.py adds to
South Korea's emergency points where OpenStreetMap lacks them. Run monthly by .github/workflows/official-points.yml
into the `official-points` release, which the pack build reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

The source: data.go.kr dataset 15051059 "건강보험심사평가원_전국 병의원 및 약국 현황", a zip of CSVs (CP949) extracted
quarterly from HIRA's open APIs: every institution billing national health insurance, so every operating one, with
WGS84 coordinates at building level. Licence "공공저작물 : 출처표시 (제 1유형)" (KOGL type 1, attribution only).
The portal has no stable file URL: the script reads the dataset page for the file's id, asks the portal's own
download endpoint for the attachment id (anonymous, no key or login) and downloads the zip. The file is a
quarter old at most (the page's name carries the extraction date).
A building with many clinics is many rows on one point: points of a kind within 15 m are one (the first kept).
Clinics: 의원 with internal medicine, family medicine or paediatrics listed with at least one specialist, or
with such a word in the name (the department list alone includes eye and skin clinics with 0 specialists).
Left out: dental, oriental (한의원, 한방병원), long-term care (요양병원) and psychiatric hospitals, midwives, specialist
clinics. A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I kr.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
import http.cookiejar
import io
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
BASE = "https://www.data.go.kr"
PAGE = BASE + "/data/15051059/fileData.do"
MIN_SHARE = 0.8
BBOX = (32.8, 124.5, 38.8, 132.0)
SOURCES = {
    "kr-hira": {
        "name": "전국 병의원 및 약국 현황 (National hospitals and pharmacies)",
        "publisher": "건강보험심사평가원 (Health Insurance Review & Assessment Service), via data.go.kr",
        "licence": "공공저작물 : 출처표시 (제 1유형) (KOGL type 1, attribution)",
        "url": "https://www.data.go.kr/data/15051059/fileData.do",
    },
}
HOSPITAL_TYPES = {"상급종합", "종합병원", "병원"}
CENTRE_TYPES = {"보건소", "보건의료원", "보건지소", "보건진료소"}
GP_DEPTS = {"내과", "가정의학과", "소아청소년과"}
GP_NAME = re.compile("내과|가정의학|소아")
SAME_SPOT = 15  # metres
# Numbers in the file often lack the area code (the province is known).
AREA = {"서울": "02", "부산": "051", "대구": "053", "인천": "032", "광주": "062", "대전": "042", "울산": "052", "세종": "044",
        "경기": "031", "강원": "033", "충북": "043", "충남": "041", "전북": "063", "전남": "061", "경북": "054", "경남": "055",
        "제주": "064"}


def download():
    """Zip bytes of the newest file: page -> ids -> the portal's download check -> file."""
    jar = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    jar.addheaders = [("User-Agent", UA), ("Referer", PAGE)]
    page = jar.open(PAGE, timeout=120).read().decode("utf-8", "replace")
    m = re.search(r"fn_fileDataDown\('(\d+)',\s*'(uddi:[^']+)'", page)
    if not m:
        raise RuntimeError("download button not found on the dataset page")
    body = urllib.parse.urlencode({"publicDataPk": m.group(1), "publicDataDetailPk": m.group(2), "atchFileId": "",
                                   "fileDetailSn": "1", "publicDataTyCode": "PR0051"}).encode()
    res = json.loads(jar.open(urllib.request.Request(BASE + "/tcs/dss/selectFileDataDownload.do", data=body), timeout=120).read())
    if not res.get("status"):
        raise RuntimeError(f"portal refused the download: {res.get('error')}")
    url = f"{BASE}/cmm/cmm/fileDownload.do?atchFileId={res['atchFileId']}&fileDetailSn={res['fileDetailSn']}&insertDataPrcus=N"
    last = None
    for attempt in range(4):  # the portal sometimes cuts the 20 MB body short
        try:
            data = jar.open(url, timeout=600).read()
            zipfile.ZipFile(io.BytesIO(data)).testzip()
            return data
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"file download: {last}")


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


def table(z, prefix):
    name = next(n for n in z.namelist() if n.startswith(prefix))
    return csv.DictReader(io.StringIO(z.read(name).decode("cp949")))


def phone(v, province):
    v = re.sub(r"[^\d-]", "", v or "").strip("-")
    if v and not v.startswith("0") and province in AREA and len(v.replace("-", "")) in (7, 8):
        v = f"{AREA[province]}-{v}"
    return v


def places(raw):
    z = zipfile.ZipFile(io.BytesIO(raw))
    gp = {}
    for r in table(z, "5."):
        if r["진료과목코드명"] in GP_DEPTS and int(r["과목별 전문의수"] or 0) > 0:
            gp[r["암호화요양기호"]] = True
    rows = []

    def add(r, kind):
        try:
            lon, lat = float(r["좌표(X)"]), float(r["좌표(Y)"])
        except ValueError:
            return
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
            return
        rows.append({
            "source": "kr-hira", "code": r["암호화요양기호"], "kind": kind, "lat": lat, "lon": lon,
            "name": re.sub(r"\s+", " ", r["요양기관명"]).strip(), "holder": "",
            "phone": phone(r.get("전화번호"), r["시도코드명"]), "address": re.sub(r"\s+", " ", r["주소"]).strip(),
            "municipality": r["시군구코드명"].strip(), "precision": "source",
        })

    for r in table(z, "1."):
        t = r["종별코드명"]
        if t in HOSPITAL_TYPES:
            add(r, "hospital")
        elif t in CENTRE_TYPES:
            add(r, "clinic")
        elif t == "의원" and (gp.get(r["암호화요양기호"]) or GP_NAME.search(r["요양기관명"])):
            add(r, "clinic")
    for r in table(z, "2."):
        add(r, "pharmacy")
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
    report, failed = {}, []
    try:
        rows = places(download())
        if previous and len(rows) < MIN_SHARE * len(previous):
            raise RuntimeError(f"{len(rows)} rows, last month {len(previous)}")
        if not rows:
            raise RuntimeError("no rows")
        report["kr-hira"] = {"rows": len(rows), "status": "fresh"}
        print(f"[kr-hira] {len(rows)} rows", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        failed.append("kr-hira")
        rows = previous
        report["kr-hira"] = {"rows": len(rows), "status": f"kept last month's: {e}"[:300]}
        print(f"[kr-hira] FAILED ({e}); keeping {len(rows)} rows from last month", file=sys.stderr)
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
