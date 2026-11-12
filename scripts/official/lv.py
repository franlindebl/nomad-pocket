"""Latvia's health points: pharmacies from the State Agency of Medicines' register of pharmaceutical companies (ZVA)
and hospitals and family doctors' practices from the "VKCP IĢIS - ārstniecības iestāžu adreses" list on data.gov.lv.
Written as one TSV that scripts/official/merge.py adds to Latvia's emergency points where OpenStreetMap lacks them.
Run monthly by .github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

Sources (both CC0-1.0 on data.gov.lv):
- lv-zva: dati.zva.gov.lv/fdu-registrs/export/fdu_register.csv, refreshed by ZVA. Only general pharmacies and their
  branches (object types 5 and 6) with an active licence (status 4) that is not suspended; wholesalers, factories and
  closed-type pharmacies (they serve one institution) are left out. 3 of ~815 have no coordinates (dropped).
- lv-med: the medical institutions' address list with coordinates (hospitals and family doctors' practices). It is a
  2024 snapshot (the dataset is not updated), so it is fetched like any other and a failure keeps last month's rows.
  Psychiatric and rehabilitation hospitals are kept out of the hospital kind (not emergency points).
A file that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I lv.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
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
ZVA_URL = "https://dati.zva.gov.lv/fdu-registrs/export/fdu_register.csv"
MED_URL = "https://data.gov.lv/dati/dataset/05068340-d155-49cc-9a37-ab7d63ccd769/resource/5ea6e4aa-ee21-462a-8590-283483d2b0a4/download/medicinasiestades.csv"
MIN_SHARE = 0.8
BBOX = (55.6, 20.9, 58.1, 28.3)
SAME_SPOT = 15  # metres
SOURCES = {
    "lv-zva": {
        "name": "Farmaceitiskās darbības uzņēmumu reģistrs (FDU register), pharmacies",
        "publisher": "Zāļu valsts aģentūra (State Agency of Medicines of Latvia)",
        "licence": "CC0-1.0",
        "url": "https://data.gov.lv/dati/lv/dataset/farmaceitiskas-darbibas-uznemumu-registrs",
    },
    "lv-med": {
        "name": "VKCP IĢIS - ārstniecības iestāžu adreses (hospitals, family doctors' practices; 2024 snapshot)",
        "publisher": "Iekšlietu ministrijas Informācijas centrs / VKCP IĢIS",
        "licence": "CC0-1.0",
        "url": "https://data.gov.lv/dati/lv/dataset/vkcp-igis-arstniecibas-iestazu-adreses",
    },
}


def get(url, timeout=120, tries=3):
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


def coords(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    return (lat, lon) if BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3] else None


def squash(v):
    return re.sub(r"\s+", " ", v or "").strip()


def zva(raw):
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig").lstrip("﻿"))):
        # The export's header starts with a doubled BOM; DictReader would then miss object_id.
        if r.get("object_type") not in ("5", "6") or r.get("lic_status") != "4" or r.get("suspended") not in ("0", "", None):
            continue
        p = coords(r.get("object_coord_y"), r.get("object_coord_x"))  # x is longitude
        if not p:
            continue
        rows.append({
            "source": "lv-zva", "code": r["object_id"].strip(), "kind": "pharmacy", "lat": p[0], "lon": p[1],
            "name": squash(r.get("object_name")), "holder": squash(r.get("pharm_owner_name")),
            "phone": squash(r.get("object_phone")).split(",")[0], "address": squash(r.get("object_addr_nice")),
            "municipality": "", "precision": "source",
        })
    return rows


# Psychiatric, rehabilitation and the like are not where you go in an emergency.
NOT_EMERGENCY = re.compile(r"psihiatr|psihoneiro|rehabilit|narkolog|ilgstoš|zobārstn|dzemdīb|plastisk|patoloģ|tiesu|cietuma", re.I)


def med(raw):
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        p = coords(r.get("lat"), r.get("long"))
        name = squash(r.get("Nosaukums"))
        typ = r.get("IestadesTips") or ""
        if not p or not name:
            continue
        if typ == "Ģimenes ārstu prakse":
            kind, label = "clinic", f"Ģimenes ārsts: {name}"
        elif (typ == "Hospitalizācijas iestāde" or (typ in ("Ārstniecības iestāde", "") and "slimnīca" in name.lower())) \
                and not NOT_EMERGENCY.search(name):
            kind, label = "hospital", name
        else:
            continue
        rows.append({
            "source": "lv-med", "code": r["ID"].strip(), "kind": kind, "lat": p[0], "lon": p[1], "name": label,
            "holder": squash(r.get("IestadesNosaukums")), "phone": "", "address": squash(r.get("Adrese")),
            "municipality": squash(r.get("PilsetasNosaukums") or r.get("NovadaNosaukums")), "precision": "source",
        })
    order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
    return one_per_spot(sorted(rows, key=lambda r: order[r["kind"]]))


FETCH = {"lv-zva": (ZVA_URL, zva), "lv-med": (MED_URL, med)}


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
    rows, report, failed = [], {}, []
    for sid, (url, parse) in FETCH.items():
        before = [r for r in previous if r["source"] == sid]
        try:
            got = parse(get(url))
            if before and len(got) < MIN_SHARE * len(before):
                raise RuntimeError(f"{len(got)} rows, last month {len(before)}")
            if not got:
                raise RuntimeError("no rows")
            report[sid] = {"rows": len(got), "status": "fresh"}
            print(f"[{sid}] {len(got)} rows", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            failed.append(sid)
            got = before
            report[sid] = {"rows": len(got), "status": f"kept last month's: {e}"[:300]}
            print(f"[{sid}] FAILED ({e}); keeping {len(got)} rows from last month", file=sys.stderr)
        rows += got
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
