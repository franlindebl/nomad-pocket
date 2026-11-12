"""Canada's health points from the provinces' and territories' open registers (the federal database fills the gaps):
Ontario's Ministry of Health service provider locations (pharmacies, hospitals, community health centres, family
health teams, nurse practitioner-led and Indigenous primary-care clinics), British Columbia's HealthLink BC
directory (pharmacies, hospitals, walk-in clinics), Quebec's health ministry installations (hospitals, CLSCs),
Manitoba's registered flu and COVID vaccine providers (pharmacies, medical and First Nation clinics), and the
hospitals and health centres of Nova Scotia, Prince Edward Island, Newfoundland and Labrador and Yukon. Written as
one TSV that scripts/official/merge.py adds to Canada's emergency points where OpenStreetMap lacks them. Run monthly
by .github/workflows/official-points.yml into the `official-points` release, which the pack build reads
(scripts/routing/build-country.sh, OFFICIAL_CACHE).

The sources, each with its own point for every place (id, publisher and licence in SOURCES):
- ca-on-mohserlo, Ontario: MOHSERLO, an ArcGIS layer of Land Information Ontario, Open Government Licence -
  Ontario. A hospital is listed as its corporation and its sites, often at one door: points of a kind within 15 m
  are one.
- ca-bc-hlbc, British Columbia: HealthLink BC's pharmacies, hospitals and walk-in clinics on the BC Data Catalogue,
  Open Government Licence - British Columbia.
- ca-qc-msss, Quebec: the ministry's list of installations (Donnees Quebec, CC BY 4.0). A hospital is an
  installation flagged as a general hospital (CHSGS), a clinic one flagged as a CLSC that is not also a hospital.
  Left out: care homes (CHSLD), rehabilitation, youth protection. Private clinics, family medicine groups and
  pharmacies are not in any open Quebec register.
- ca-mb-flu, Manitoba: the province's registered flu and COVID vaccine providers (ArcGIS, OpenMB Information and Data
  Use Licence): pharmacies, medical clinics and First Nation health clinics, not public health offices. A vaccine
  provider list, so a pharmacy or clinic that does not give shots is missing.
- ca-ns-hosp, Nova Scotia (hospitals and community health centres, OGL - Nova Scotia), ca-pe-health, Prince Edward
  Island (hospitals and primary care networks, OGL - PEI), ca-nl-health, Newfoundland and Labrador (hospitals and
  health centres from the KMZ, OGL - NL, last edited 2020), ca-yt-health, Yukon (hospitals and health centres,
  OGL - Yukon).
- ca-<prov>-odhf for ab, sk, mb, nb, nt, nu: Statistics Canada's Open Database of Healthcare Facilities (Open
  Government Licence - Canada), a 2020 snapshot built from the provinces' lists. Only the hospitals with a point
  (and in Saskatchewan its clinics and health centres); no pharmacies in it. Used where nothing newer is open:
  Alberta, Saskatchewan, New Brunswick (its own list is on a host this repository's machine can't verify),
  Northwest Territories, Nunavut, and Manitoba's hospitals.
Left without any source: Alberta's pharmacies and clinics, Saskatchewan's and New Brunswick's pharmacies and clinics,
the territories' pharmacies, Nova Scotia's and Quebec's pharmacies (docs/OFFICIAL_POINTS_WORLD.md).
A source that can't be read, or has far fewer rows than last month, keeps last month's rows (--previous).

Usage: python3 -I ca.py <out.tsv> [--previous <tsv>] [--geocache <tsv> (unused)]
Standard library only (CI runs it on a bare runner).
"""
import csv
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
MIN_SHARE = 0.8
BBOX = (41.6, -141.1, 83.2, -52.5)
ONTARIO = "https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open09/MapServer/26"
BC = "https://catalogue.data.gov.bc.ca/dataset/"
SOURCES = {
    "ca-on-mohserlo": {
        "name": "Ministry of Health Service Provider Locations (MOHSERLO)",
        "publisher": "Ontario Ministry of Health / Land Information Ontario",
        "licence": "Open Government Licence - Ontario",
        "url": "https://data.ontario.ca/dataset/ministry-of-health-service-provider-locations-mohserlo",
    },
    "ca-bc-hlbc": {
        "name": "HealthLink BC: Pharmacies, Hospitals and Walk-in Clinics in BC",
        "publisher": "BC Ministry of Health (HealthLink BC)",
        "licence": "Open Government Licence - British Columbia",
        "url": "https://catalogue.data.gov.bc.ca/dataset/f5b6bfad-d06a-4952-ae47-976fb5092bcc",
    },
    "ca-qc-msss": {
        "name": "Liste des installations du reseau de la sante et des services sociaux (M02)",
        "publisher": "Ministere de la Sante et des Services sociaux du Quebec",
        "licence": "Attribution (CC-BY 4.0)",
        "url": "https://www.donneesquebec.ca/recherche/dataset/fichiers-cartographiques-m02-des-installations-et-etablissements",
    },
    "ca-mb-flu": {
        "name": "Manitoba Registered Flu and COVID Providers",
        "publisher": "Government of Manitoba",
        "licence": "OpenMB Information and Data Use Licence",
        "url": "https://geoportal.gov.mb.ca/datasets/manitoba::manitoba-registered-flu-and-covid-providers",
    },
    "ca-ns-hosp": {
        "name": "Hospitals (Nova Scotia)",
        "publisher": "Province of Nova Scotia",
        "licence": "Open Government Licence - Nova Scotia",
        "url": "https://data.novascotia.ca/datasets/tmfr-3h8a",
    },
    "ca-pe-health": {
        "name": "OD0050 Health PEI Facility Locations",
        "publisher": "Government of Prince Edward Island",
        "licence": "Open Government Licence - Prince Edward Island",
        "url": "https://data.princeedwardisland.ca/datasets/0f90d991469e40ed8fcba35ee0ec62da",
    },
    "ca-nl-health": {
        "name": "Hospitals and Health Centres (Newfoundland and Labrador)",
        "publisher": "Government of Newfoundland and Labrador",
        "licence": "Open Government Licence - Newfoundland and Labrador",
        "url": "https://opendata.gov.nl.ca/public/opendata/page/?page-id=datasetdetails&id=86",
    },
    "ca-yt-health": {
        "name": "Health care facilities - 50k (Yukon)",
        "publisher": "Government of Yukon",
        "licence": "Open Government Licence - Yukon",
        "url": "https://open.yukon.ca/data/eb2cf782-41e7-48a6-b6a9-099fd34953a2",
    },
}
ODHF_URL = "https://ftp.maps.canada.ca/pub/statcan_statcan/Health-care-facilities_Etablissement-de-sante/ODHF_BDOES/odhf_bdoes_v1.csv"
for _p in ("ab", "sk", "mb", "nb", "nt", "nu"):
    SOURCES[f"ca-{_p}-odhf"] = {
        "name": "Open Database of Healthcare Facilities (ODHF), " + _p.upper(),
        "publisher": "Statistics Canada",
        "licence": "Open Government Licence - Canada",
        "url": "https://www.statcan.gc.ca/en/lode/databases/odhf",
    }
# Ontario: (SERVICE_TYPE, SERVICE_TYPE_DETAIL or None for any) → kind. Left out: hospital outpatient dispensaries
# (inside the hospital), labs, long-term care and retirement homes, mental health and support services.
ONTARIO_KINDS = {
    ("Pharmacy", "Retail Pharmacy"): "pharmacy",
    ("Hospital", None): "hospital",
    ("Community Health Centre", None): "clinic",
    ("Family Health Team", None): "clinic",
    ("Nurse Practitioner-Led Clinic", None): "clinic",
    ("Indigenous Primary Health Care Organization", None): "clinic",
}
# BC: dataset id, resource id, file → kind
BC_FILES = [
    ("f5b6bfad-d06a-4952-ae47-976fb5092bcc", "681b4fa5-13a5-4273-a189-fc101f0f8356", "hlbc_pharmacies.csv", "pharmacy"),
    ("383eaf98-afd7-436a-9556-67ecf14f64a7", "5ff82cf4-0448-4063-804a-7321f0f2b4c6", "hlbc_hospitals.csv", "hospital"),
    ("5e2707c3-0aa4-4d2d-aedc-4dd0914b686a", "3ca6b086-c92b-4654-ae82-ff5723d00611", "hlbc_walkinclinics.csv", "clinic"),
]
SAME_SPOT = 15  # metres
TYPE_WORD = {"pharmacy": (r"pharm|drug|apothecar|rexall|london drugs|guardian|ida\b", "Pharmacy"),
             "clinic": (r"clinic|medical|health|centre|center|doctor", "Walk-in Clinic")}


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


def meters(a, b):
    x = math.radians(b[1] - a[1]) * math.cos(math.radians((a[0] + b[0]) / 2))
    return 6371000 * math.hypot(x, math.radians(b[0] - a[0]))


def one_per_spot(rows):
    """A kind's points within SAME_SPOT metres are one place (a hospital's corporation and its main site)."""
    out, grid, cell = [], {}, 0.0005
    for r in rows:
        key = (r["kind"], int(r["lat"] // cell), int(r["lon"] // cell))
        near = [o for di in (-1, 0, 1) for dj in (-1, 0, 1) for o in grid.get((key[0], key[1] + di, key[2] + dj), ())]
        if any(meters((o["lat"], o["lon"]), (r["lat"], r["lon"])) <= SAME_SPOT for o in near):
            continue
        grid.setdefault(key, []).append(r)
        out.append(r)
    return out


def inside(lat, lon):
    return lat is not None and lon is not None and BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]


def clean_space(v):
    return re.sub(r"\s+", " ", v or "").strip()


def ontario():
    feats, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": 4326,
                                    "resultOffset": offset, "resultRecordCount": 2000, "orderByFields": "OBJECTID", "f": "json"})
        page = json.loads(get(f"{ONTARIO}/query?{q}", timeout=120))
        if "error" in page:
            raise RuntimeError(str(page["error"])[:200])
        got = page.get("features") or []
        feats += got
        offset += len(got)
        if not got or not page.get("exceededTransferLimit"):
            break
    rows = []
    for f in feats:
        a, g = f.get("attributes") or {}, f.get("geometry") or {}
        kind = ONTARIO_KINDS.get((a.get("SERVICE_TYPE"), a.get("SERVICE_TYPE_DETAIL"))) or ONTARIO_KINDS.get((a.get("SERVICE_TYPE"), None))
        lat, lon = g.get("y"), g.get("x")
        if not kind or not inside(lat, lon):
            continue
        town = clean_space(a.get("COMMUNITY")).title()
        rows.append({
            "source": "ca-on-mohserlo", "code": str(a.get("MOH_SERVICE_PROVIDER_IDENT") or a.get("OGF_ID") or a.get("OBJECTID")),
            "kind": kind, "lat": lat, "lon": lon, "name": clean_space(a.get("ENGLISH_NAME")), "holder": "", "phone": "",
            "address": ", ".join(x for x in (clean_space(a.get("ADDRESS_LINE_1")), town, clean_space(a.get("POSTAL_CODE"))) if x),
            "municipality": town, "precision": "source",
        })
    return rows


def named(kind, org, service):
    """BC writes a pharmacy's or clinic's company as its name ("Loblaws") and the service apart ("Pharmacy Services")."""
    if kind == "hospital":
        return service or org
    pattern, label = TYPE_WORD[kind]
    return org if re.search(pattern, org, re.I) else f"{org} {label}".strip()


def british_columbia():
    rows = []
    for dataset, resource, file, kind in BC_FILES:
        raw = get(f"{BC}{dataset}/resource/{resource}/download/{file}")
        got = 0
        for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
            try:
                lat, lon = float(r.get("LATITUDE") or ""), float(r.get("LONGITUDE") or "")
            except ValueError:
                continue
            if not inside(lat, lon):
                continue
            street = clean_space(" ".join(r.get(c) or "" for c in ("STREET_NUMBER", "STREET_NAME", "STREET_TYPE", "STREET_DIRECTION")))
            town = clean_space(r.get("CITY"))
            got += 1
            rows.append({
                "source": "ca-bc-hlbc", "code": clean_space(r.get("SL_REFERENCE") or r.get("LC_REFERENCE")), "kind": kind,
                "lat": lat, "lon": lon, "name": named(kind, clean_space(r.get("RG_NAME")), clean_space(r.get("SV_NAME"))),
                "holder": clean_space(r.get("RG_NAME")) if kind == "hospital" else "", "phone": clean_space(r.get("PHONE_NUMBER")),
                "address": ", ".join(x for x in (street, town, clean_space(r.get("POSTAL_CODE"))) if x),
                "municipality": town, "precision": "source",
            })
        if not got:
            raise RuntimeError(f"{file}: no rows")
    return rows


def arcgis_all(url, extra=None, timeout=120):
    """Every feature of an ArcGIS layer (attributes plus WGS84 geometry), paged."""
    feats, offset = [], 0
    while True:
        q = {"where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": 4326, "resultOffset": offset,
             "resultRecordCount": 1000, "orderByFields": "OBJECTID", "f": "json"}
        q.update(extra or {})
        page = json.loads(get(f"{url}/query?{urllib.parse.urlencode(q)}", timeout=timeout))
        if "error" in page:
            raise RuntimeError(str(page["error"])[:200])
        got = page.get("features") or []
        feats += got
        offset += len(got)
        if not got or not page.get("exceededTransferLimit"):
            return feats


SMALL_WORDS = {"de", "du", "des", "la", "le", "les", "et", "au", "aux", "sur", "of", "and", "the", "in", "for"}
ACRONYMS = {"clsc", "chsld", "cisss", "ciusss", "chu", "chuq", "gmf", "iwk", "nwt", "nb"}


def title(v):
    """Registers that write names in capitals or lower case: capitalise each word (not after an apostrophe), keep
    the small ones and French d'/l' low, acronyms up."""
    out = []
    for i, w in enumerate(re.sub(r"\s+", " ", v or "").strip().lower().split(" ")):
        if i and w in SMALL_WORDS:
            out.append(w)
            continue
        pre = ""
        m = re.match(r"([dl])['\u2019](.+)", w)
        if i and m:
            pre, w = w[:2], m.group(2)
        w = w.upper() if w in ACRONYMS else re.sub(r"(^|[-/(])([^\W\d_])", lambda m: m.group(1) + m.group(2).upper(), w)
        out.append(pre + w)
    return " ".join(out)


def row(sid, code, kind, lat, lon, name, address="", town="", phone="", holder=""):
    return {"source": sid, "code": str(code), "kind": kind, "lat": lat, "lon": lon, "name": clean_space(name), "holder": holder,
            "phone": phone, "address": address, "municipality": town, "precision": "source"}


def quebec():
    """Installations list: hospital = general hospital flag, clinic = CLSC flag without the hospital one."""
    raw = get("https://www.donneesquebec.ca/recherche/dataset/51998b55-7d4c-4381-8c20-0ac1cd9c1b87/resource/"
              "2aa06e66-c1d0-4e2f-bf3c-c2e413c3f84d/download/installationscsv.csv")
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        kind = "hospital" if r["CHSGS"] == "Oui" else "clinic" if r["CLSC"] == "Oui" else None
        try:
            lat, lon = float(r["LATITUDE"]), float(r["LONGITUDE"])
        except ValueError:
            continue
        if not kind or not inside(lat, lon):
            continue
        town = clean_space(r["MUN_NOM"])
        rows.append(row("ca-qc-msss", r["INSTAL_COD"], kind, lat, lon, title(r["INSTAL_NOM"]),
                        ", ".join(x for x in (clean_space(r["ADRESSE"]), town, clean_space(r["CODE_POSTA"])) if x), town,
                        holder=clean_space(r["ETAB_NOM"]) if kind == "hospital" else ""))
    return rows


MANITOBA = "https://services.arcgis.com/mMUesHYPkXjaFGfS/arcgis/rest/services/Flu_and_Covid_Vaccine_Provider/FeatureServer/0"
MANITOBA_KINDS = {"Pharmacy": "pharmacy", "Medical Clinic": "clinic", "First Nation Health Clinic": "clinic"}


def manitoba():
    rows = []
    for f in arcgis_all(MANITOBA):
        a = f.get("attributes") or {}
        kind = MANITOBA_KINDS.get(clean_space(a.get("Type_of_Organization")).split(" / ")[0])
        lat, lon = a.get("Latitude"), a.get("Longitude")
        if not kind or not inside(lat, lon):
            continue
        town = clean_space(a.get("City_or_Town"))
        org = clean_space(a.get("Organization_Name")).split(" / ")[0]
        rows.append(row("ca-mb-flu", a.get("Holding_Point_Number") or a["ObjectId"], kind, lat, lon, named(kind, org, ""),
                        ", ".join(x for x in (clean_space(a.get("Street_Address_and_Number")), town, clean_space(a.get("Postal_Code"))) if x),
                        town, phone=clean_space(a.get("Phone_Number"))))
    return rows


def point_wkt(v):
    m = re.match(r"POINT \(([-\d.]+) ([-\d.]+)\)", v or "")
    return (float(m.group(2)), float(m.group(1))) if m else (None, None)


# Nova Scotia's TYPE: the hospitals proper, and the community health centres (a small hospital or an emergency
# centre in a village). Left out: rehabilitation, an environmental health unit, an outpatient/nursing home.
NS_TYPES = {"Regional", "Tertiary", "Community", "Community Health Centre"}


def nova_scotia():
    raw = get("https://data.novascotia.ca/api/views/tmfr-3h8a/rows.csv?accessType=DOWNLOAD")
    rows = []
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        lat, lon = point_wkt(r.get("the_geom"))
        if r.get("TYPE") not in NS_TYPES or not inside(lat, lon):
            continue
        town = clean_space(r.get("TOWN"))
        rows.append(row("ca-ns-hosp", r["FACILITY"], "hospital", lat, lon, r["FACILITY"],
                        ", ".join(x for x in (clean_space(r.get("Address")), town) if x), town))
    return rows


PEI = "https://services9.arcgis.com/zow9Ot3ujGSyJI3C/arcgis/rest/services/OD0050_Health_PEI_Facility_Locations/FeatureServer/0"
PEI_KINDS = {"Acute Care Hospital": "hospital", "Community Hospital": "hospital"}


def prince_edward_island():
    """The layer has no geometry: the point is a "(lat, lon)" text column. The four networks list their primary care
    clinics (Health PEI's); nursing homes, cancer and palliative centres are left out."""
    rows = []
    for f in arcgis_all(PEI, {"returnGeometry": "false"}):
        a = f.get("attributes") or {}
        t = clean_space(a.get("Facility_Type"))
        kind = PEI_KINDS.get(t) or ("clinic" if "Network" in t else None)
        m = re.match(r"\(([-\d.]+),\s*([-\d.]+)\)", a.get("Location_1") or "")
        if not kind or not m or not inside(float(m.group(1)), float(m.group(2))):
            continue
        town = clean_space(a.get("Community"))
        rows.append(row("ca-pe-health", a["ObjectId"], kind, float(m.group(1)), float(m.group(2)), a.get("Facility_Name"),
                        ", ".join(x for x in (clean_space(a.get("Street_Address")), town, clean_space(a.get("Postal_Code"))) if x), town))
    return rows


NL_FILES = [(17150, "hospital"), (17149, "clinic")]


def newfoundland():
    """Two KMZ files (zipped KML); the attributes are an HTML table in each placemark's description."""
    rows = []
    for fid, kind in NL_FILES:
        raw = get(f"https://opendata.gov.nl.ca/public/opendata/filedownload/?file-id={fid}")
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            kml = z.read("doc.kml").decode("utf-8")
        got = 0
        for pm in kml.split("<Placemark")[1:]:
            attrs = {k: v for k, v in re.findall(r"<td>([^<]*)</td>\s*<td>(.*?)</td>", pm, re.S)}
            c = re.search(r"<coordinates>\s*([-\d.]+),([-\d.]+)", pm)
            if not c or not inside(float(c.group(2)), float(c.group(1))):
                continue
            got += 1
            town = clean_space(attrs.get("municipali"))
            rows.append(row("ca-nl-health", attrs.get("facilityid") or attrs.get("name"), kind, float(c.group(2)), float(c.group(1)),
                            attrs.get("name", ""), town, town, phone=clean_space(attrs.get("phone")), holder=clean_space(attrs.get("agency"))))
        if not got:
            raise RuntimeError(f"file {fid}: no rows")
    return rows


YUKON = "https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_PeopleStructures/MapServer/0"


def yukon():
    rows = []
    for f in arcgis_all(YUKON):
        a, g = f.get("attributes") or {}, f.get("geometry") or {}
        kind = {"Hospital": "hospital", "Health Centre": "clinic"}.get(clean_space(a.get("TYPE")))
        lat, lon = g.get("y"), g.get("x")
        if not kind or not inside(lat, lon):
            continue
        town = clean_space(a.get("COMMUNITY"))
        rows.append(row("ca-yt-health", a["OBJECTID"], kind, lat, lon, a.get("NAME"),
                        ", ".join(x for x in (clean_space(a.get("ADDRESS")), town, clean_space(a.get("POSTAL_CODE"))) if x), town,
                        phone=clean_space(a.get("PHONE"))))
    return rows


# ODHF's source_facility_type is free text from each province's list. Hospitals: the general kinds; clinics: health
# centres everywhere, and Saskatchewan's clinics. Left out: psychiatric, extended care and convalescence "hospitals",
# nursing homes, labs, public health and home care offices.
ODHF_HOSPITAL = {"", "general", "hospital", "hospital (emergency)", "hospital and nursing home", "hosptial", "pediatric", "cardiology",
                 "cancer", "tertiary", "centre hospitalier", "h\u00f4pitaux", "primary care, emergency"}
ODHF_HEALTH_CENTRE = {"community health centre", "community health centre/hospital", "health centre"}
ODHF_CLINIC = {"clinic", "clinic, primary care", "medical centre", "medical clinic", "primary care", "primary care clinic",
               "primary care, clinic", "walk-in clinic"}
ODHF_CACHE = []


def odhf_rows():
    if not ODHF_CACHE:
        ODHF_CACHE.extend(csv.DictReader(io.StringIO(get(ODHF_URL).decode("cp1252"))))
    return ODHF_CACHE


def odhf(prov):
    """One province's rows. The database lists a hospital twice when two provincial lists name it (150 m apart or
    more): a hospital within 250 m of another of the same town is one."""
    sid, rows, kept = f"ca-{prov}-odhf", [], []
    for r in odhf_rows():
        if r["province"].lower() != prov:
            continue
        t, st = r["odhf_facility_type"], r["source_facility_type"].strip().lower()
        kind = None
        if t == "Hospitals":
            kind = "hospital" if st in ODHF_HOSPITAL else "clinic" if st in ODHF_HEALTH_CENTRE and prov == "sk" else None
        elif t == "Ambulatory health care services" and prov == "sk" and st in ODHF_CLINIC:
            kind = "clinic"
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
        except ValueError:
            continue
        if not kind or not inside(lat, lon):
            continue
        town = title(r["city"])
        if kind == "hospital" and any(o["municipality"] == town and meters((o["lat"], o["lon"]), (lat, lon)) <= 250 for o in kept):
            continue
        street = clean_space(f"{r['street_no']} {r['street_name']}").title()
        rows.append(row(sid, r["index"], kind, lat, lon, title(r["facility_name"]), ", ".join(x for x in (street, town, clean_space(r["postal_code"]).upper()) if x), town))
        if kind == "hospital":
            kept.append(rows[-1])
    return rows


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
    before = {}
    for r in read_tsv(opt("--previous")) if opt("--previous") else []:
        before.setdefault(r["source"], []).append(r)
    rows, report, failed = [], {}, []
    fetchers = [("ca-on-mohserlo", ontario), ("ca-bc-hlbc", british_columbia), ("ca-qc-msss", quebec), ("ca-mb-flu", manitoba),
                ("ca-ns-hosp", nova_scotia), ("ca-pe-health", prince_edward_island), ("ca-nl-health", newfoundland), ("ca-yt-health", yukon)]
    fetchers += [(f"ca-{p}-odhf", lambda p=p: odhf(p)) for p in ("ab", "sk", "mb", "nb", "nt", "nu")]
    for sid, fetch in fetchers:
        old = before.get(sid, [])
        try:
            order = {"hospital": 0, "pharmacy": 1, "clinic": 2}
            got = one_per_spot(sorted(fetch(), key=lambda r: order[r["kind"]]))
            if old and len(got) < MIN_SHARE * len(old):
                raise RuntimeError(f"{len(got)} rows, last month {len(old)}")
            if not got:
                raise RuntimeError("no rows")
            rows.extend(got)
            report[sid] = {"rows": len(got), "status": "fresh"}
            print(f"[{sid}] {len(got)} rows", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            failed.append(sid)
            rows.extend(old)
            report[sid] = {"rows": len(old), "status": f"kept last month's: {e}"[:300]}
            print(f"[{sid}] FAILED ({e}); keeping {len(old)} rows from last month", file=sys.stderr)
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
