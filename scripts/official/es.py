"""Spain's health points from official registers: pharmacies (and botiquines, a village's dispensary of a
pharmacy), hospitals, health centres and primary-care consultorios. Written as one TSV that
scripts/official/merge.py adds to Spain's emergency points where OpenStreetMap lacks them (OSM misses about a
third of the rural pharmacies: Castilla-La Mancha, 2026-11, 433 of 1,276).
Run monthly by .github/workflows/official-points.yml into the `official-points` release, which the pack build
reads (scripts/routing/build-country.sh, OFFICIAL_CACHE).

Where the points come from:
- Pharmacies: each region authorises and lists its own. Regions that publish theirs with coordinates under an
  open licence: REGIONAL below. The rest (and botiquines a regional list leaves out) come from the Ministry of
  Health's national register, REGCESS, whose monthly listing has every pharmacy and botiquín with its address
  but no coordinates: placed with CartoCiudad (IGN's geocoder) and checked against the register's municipality.
  Regional lists lag behind (new pharmacies, Aragón's botiquines of 2024-25): where REGCESS carries the regional
  code (CODE_FIELD), its pharmacies whose code the regional list lacks are placed and added too.
  Galicia (CC BY-SA) and Cantabria (non-commercial) publish lists with coordinates under licences that don't
  fit a file mixed with OSM's, and Asturias's server (sig.asturias.es) doesn't answer GitHub's runners: REGCESS
  for them too.
- Hospitals (general and specialised), health centres and consultorios: REGCESS, placed the same way (a
  centre's name is often a place in CartoCiudad: tried first); where a region publishes its centres with points
  (CENTRES: twelve communities), those replace the REGCESS centres they match, the rest of REGCESS's stay.
A source that doesn't answer, or answers with far fewer rows than last month, keeps last month's rows
(--previous). Geocoder answers are kept between runs (--geocache), so a month only asks for new addresses.
Sources and licences: SOURCES, and the Credits screen (scripts/licenses/native.json, data).

Usage: python3 -I es.py <out.tsv> [--previous <tsv>] [--geocache <tsv>] [--only <source> ...] [--limit N]
Standard library only (CI runs it on a bare runner).
"""
import concurrent.futures
import csv
import io
import json
import math
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

UA = "NomadPocket-official/1.0 (+https://github.com/franlindebl/nomad-pocket)"
COLUMNS = ["source", "code", "kind", "lat", "lon", "name", "holder", "phone", "address", "municipality", "precision"]
# Kinds: pharmacy, botiquin (merged as pharmacies), hospital, clinic (health centre or consultorio).
# A source is trusted when it gives at least this share of last month's rows.
MIN_SHARE = 0.8
GEOCODER = "https://www.cartociudad.es/geocoder/api/geocoder"
GEOCODER_THREADS = 8

# Autonomous communities by INE code: a generous bbox, for coordinates a register gets wrong (signs flipped,
# lat and lon swapped, 0,0).
COMMUNITIES = {
    "01": ("Andalucía", (-7.6, 35.9, -1.6, 38.8)),
    "02": ("Aragón", (-2.2, 39.8, 0.8, 42.95)),
    "03": ("Asturias", (-7.2, 42.85, -4.5, 43.7)),
    "04": ("Illes Balears", (1.1, 38.6, 4.4, 40.15)),
    "05": ("Canarias", (-18.3, 27.6, -13.3, 29.5)),
    "06": ("Cantabria", (-4.9, 42.7, -3.1, 43.55)),
    "07": ("Castilla y León", (-7.1, 40.05, -1.7, 43.3)),
    "08": ("Castilla-La Mancha", (-5.45, 38.0, -0.9, 41.35)),
    "09": ("Cataluña", (0.15, 40.5, 3.35, 42.9)),
    "10": ("Comunitat Valenciana", (-1.55, 37.8, 0.55, 40.8)),
    "11": ("Extremadura", (-7.6, 37.9, -4.6, 40.5)),
    "12": ("Galicia", (-9.35, 41.8, -6.7, 43.8)),
    "13": ("Madrid", (-4.6, 39.85, -3.0, 41.2)),
    "14": ("Murcia", (-2.4, 37.35, -0.6, 38.8)),
    "15": ("Navarra", (-2.55, 41.9, -0.7, 43.35)),
    "16": ("País Vasco", (-3.5, 42.45, -1.7, 43.5)),
    "17": ("La Rioja", (-3.15, 41.9, -1.65, 42.65)),
    "18": ("Ceuta", (-5.4, 35.85, -5.25, 35.95)),
    "19": ("Melilla", (-3.0, 35.25, -2.9, 35.33)),
}


# --- Fetching ---------------------------------------------------------------------------------

def get(url, data=None, timeout=120, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 (any network failure: retry, then the caller keeps last month's)
            last = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def get_json(url, **kw):
    return json.loads(get(url, **kw).decode("utf-8-sig"))


def arcgis_features(layer_url, where="1=1", page=1000):
    """Every feature of an ArcGIS FeatureServer/MapServer layer, as (properties, lon, lat) in WGS84."""
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"where": where, "outFields": "*", "outSR": 4326, "f": "geojson",
                                    "resultOffset": offset, "resultRecordCount": page})
        d = get_json(f"{layer_url}/query?{q}", timeout=300)
        feats = d.get("features", [])
        for f in feats:
            g = f.get("geometry") or {}
            if g.get("type") == "Point":
                out.append((f.get("properties") or {}, g["coordinates"][0], g["coordinates"][1]))
        if len(feats) < page and not d.get("properties", {}).get("exceededTransferLimit") and not d.get("exceededTransferLimit"):
            break
        offset += len(feats)
        if not feats:
            break
    return out


def wfs_points(url):
    """(properties, lon, lat) of a WFS GeoJSON answer (Point or one-point MultiPoint)."""
    out = []
    for f in get_json(url, timeout=300)["features"]:
        g = f.get("geometry") or {}
        c = g.get("coordinates")
        if g.get("type") == "MultiPoint" and c:
            c = c[0]
        if g.get("type") in ("Point", "MultiPoint") and c:
            out.append((f.get("properties") or {}, c[0], c[1]))
    return out


def csv_rows(raw, delimiter=None, encoding=None):
    text = None
    for enc in ([encoding] if encoding else ["utf-8-sig", "cp1252", "latin-1"]):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if delimiter is None:
        head = text.split("\n", 1)[0]
        delimiter = max([";", ",", "\t", "|"], key=head.count)
    return list(csv.DictReader(io.StringIO(text), delimiter=delimiter))


def xlsx_rows(raw, sheet=1, header_row=None):
    """Rows of an .xlsx sheet as dicts keyed by the header row (the first row with 3+ cells unless given).
    Header line breaks become spaces ('Código\\nPostal' → 'Código Postal')."""
    if raw[:2] != b"PK":
        raise RuntimeError(f"not an xlsx ({raw[:60]!r})")  # juntaex.es answers maintenance pages with 200
    z = zipfile.ZipFile(io.BytesIO(raw))
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
            shared.append("".join(t.text or "" for t in si.iter(f"{{{ns['m']}}}t")))
    table = []
    m = f"{{{ns['m']}}}"
    # Streamed: REGCESS's C2 sheet is ~120k rows (17 MB zipped), too much for one tree on a CI runner.
    with z.open(f"xl/worksheets/sheet{sheet}.xml") as fh:
        for _, r in ET.iterparse(fh):
            if r.tag != f"{m}row":
                continue
            cells = {}
            for c in r.findall(f"{m}c"):
                ref = re.match(r"[A-Z]+", c.get("r")).group(0)
                col = 0
                for ch in ref:
                    col = col * 26 + ord(ch) - 64
                v = c.find(f"{m}v")
                if c.get("t") == "s" and v is not None:
                    val = shared[int(v.text)]
                elif c.get("t") == "inlineStr":
                    val = "".join(t.text or "" for t in c.iter(f"{m}t"))
                else:
                    val = v.text if v is not None else ""
                cells[col - 1] = (val or "").strip()
            r.clear()
            if cells:
                table.append([cells.get(i, "") for i in range(max(cells) + 1)])
    if header_row is None:
        header_row = next(i for i, r in enumerate(table) if sum(1 for x in r if x) >= 3)
    head = [re.sub(r"\s+", " ", h).strip() for h in table[header_row]]
    return [dict(zip(head, r + [""] * (len(head) - len(r)))) for r in table[header_row + 1:] if any(r)]


# --- Coordinates ------------------------------------------------------------------------------

def utm_to_wgs84(x, y, zone=30):
    """ETRS89/WGS84 UTM (northern hemisphere) to lat, lon. ETRS89 and WGS84 differ by < 1 m."""
    a, f = 6378137.0, 1 / 298.257222101
    k0, e2 = 0.9996, f * (2 - f)
    ep2 = e2 / (1 - e2)
    x -= 500000.0
    m = y / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
         + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    n1 = a / math.sqrt(1 - e2 * math.sin(p) ** 2)
    t1 = math.tan(p) ** 2
    c1 = ep2 * math.cos(p) ** 2
    r1 = a * (1 - e2) / (1 - e2 * math.sin(p) ** 2) ** 1.5
    d = x / (n1 * k0)
    lat = p - (n1 * math.tan(p) / r1) * (d ** 2 / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24
                                         + (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720)
    lon = (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120) / math.cos(p)
    return math.degrees(lat), (zone - 1) * 6 - 180 + 3 + math.degrees(lon)


def num(v):
    """'426874,6489' or '426874.6489' or 426874.6 → float; None when empty or not a number."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(" ", "")
    if s.count(",") == 1 and s.count(".") == 0:
        s = s.replace(",", ".")
    elif s.count(",") >= 1 and s.count(".") == 1 and s.index(",") < s.index("."):
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def inside(lat, lon, bbox):
    w, s, e, n = bbox
    return s <= lat <= n and w <= lon <= e


def place(lat, lon, community):
    """The point if it falls in its community; fixed when only a sign or the order is wrong; else None."""
    if lat is None or lon is None:
        return None
    bbox = COMMUNITIES[community][1]
    for la, lo in ((lat, lon), (lat, -lon), (lon, lat), (lon, -lat)):
        if inside(la, lo, bbox):
            return la, lo
    return None


# --- Text -------------------------------------------------------------------------------------

LOWER = {"de", "del", "la", "las", "los", "y", "e", "el", "da", "do", "dos", "das", "i", "d"}


def title(s):
    """'MONICA GUERRERO ALONSO' → 'Monica Guerrero Alonso'; mixed case is kept as written."""
    s = re.sub(r"\s+", " ", (s or "").strip().lstrip(">").strip())
    if not s or (s != s.upper() and s != s.lower()):
        return s
    words = s.lower().split(" ")
    return " ".join(w if (i and w in LOWER) else (w[:1].upper() + w[1:]) for i, w in enumerate(words))


def holder_name(holder):
    """'GUERRERO ALONSO, MONICA' → 'Monica Guerrero Alonso'; the licence number Andalucía appends goes."""
    h = title(re.split(r"\.-|\s-\s", holder or "")[0])
    if h.count(",") == 1 and " y " not in h.lower():
        last, first = (p.strip() for p in h.split(","))
        if first and last:
            h = f"{first} {last}"
    return h.strip(" ,.")


def pharmacy_name(holder, kind="pharmacy"):
    if kind == "botiquin":
        h = title(holder)
        return h if h.lower().startswith("botiqu") else (f"Botiquín {h}" if h else "Botiquín")
    h = holder_name(holder)
    return f"Farmacia {h}" if h else "Farmacia"


def phone(v):
    digits = re.sub(r"\D", "", str(v or "").split("/")[0])
    if digits.startswith("34") and len(digits) == 11:
        digits = digits[2:]
    return digits if len(digits) == 9 else ""


def municipality_name(m):
    """REGCESS writes 'Pinar, El': 'El Pinar'."""
    m = (m or "").strip()
    if m.count(",") == 1:
        a, b = (x.strip() for x in m.split(","))
        if b and len(b) <= 4:
            return f"{b} {a}" if not b.endswith("'") else f"{b}{a}"
    return m


def rec(source, code, lat, lon, holder="", phone_="", address="", municipality="", kind="pharmacy", name=None, precision="source"):
    return {"source": source, "code": str(code).strip(), "kind": kind, "lat": lat, "lon": lon,
            "name": name if name is not None else pharmacy_name(holder, kind), "holder": title(holder), "phone": phone(phone_),
            "address": title(address), "municipality": title(municipality), "precision": precision}


# --- Geocoding (CartoCiudad) ------------------------------------------------------------------

ABBREVIATIONS = [(r"^(AVDA|AVD|AV|AVENIDA)\.?\s", "AVENIDA "), (r"^(PZA|PZ|PL|PLZ|PLAZA)\.?\s", "PLAZA "),
                 (r"^(CTRA|CRTA|CR|CARRETERA)\.?\s", "CARRETERA "), (r"^(C/|CL|CALLE|C)\.?\s", "CALLE "),
                 (r"^(TRVA|TRAV|TR|TRAVESIA)\.?\s", "TRAVESIA "), (r"^(URB|URBANIZACION)\.?\s", "URBANIZACION "),
                 (r"^(PSO|PS|PASEO)\.?\s", "PASEO "), (r"^(RDA|RONDA)\.?\s", "RONDA "), (r"^(BDA|BARRIADA)\.?\s", "BARRIADA ")]
ADDRESS_TYPES = {"portal", "callejero", "carretera"}
TOWN_TYPES = {"poblacion", "Municipio"}
PLACE_TYPES = {"toponimo", "ngbe"}


def street_text(kind, street, number):
    s = re.sub(r"\(.*?\)", " ", f"{kind or ''} {street or ''}").upper()
    s = re.sub(r"\s+", " ", s).strip()
    for pat, rep in ABBREVIATIONS:
        s = re.sub(pat, rep, s)
    number = (number or "").strip()
    if number and not re.match(r"^(S/?N|SN|0+)$", number, re.I):
        s = f"{s} {number}"
    return s


TITLES = {"GENERAL", "CAPITAN", "CORONEL", "COMANDANTE", "DOCTOR", "PADRE", "ALCALDE", "MAESTRO", "PINTOR", "POETA"}


def tidy_street(kind, street, number):
    """What a register adds around the street ('CALLE-CALZADAS', 'C/ PLAZA DE ESPAÑA', 'JAIME I. EDF.ROCA BLANCA',
    '58 A BAJO', 'PINTOS GENERAL') taken off, for a second try."""
    st = (street or "").upper().strip()
    st = re.sub(r"^(CALLE|PLAZA|AVENIDA|AVDA|PASEO|CTRA|CARRETERA|TRAVESIA|RONDA)\s*-\s*", "", st)
    st = re.sub(r"^(C/|CL\.?|CALLE|PLAZA|PZA\.?|AVDA\.?)\s+", "", st) if (kind or "").upper() in ("CALLE", "PLAZA", "AVDA", "AVENIDA") else st
    st = re.split(r"\s(EDF|EDIF|EDIFICIO|LOCAL|LOC|BAJO|BJ|ESQ|ESQUINA|KM|BLOQUE|BLQ|PORTAL|URB|N[º°]|ACC)\b\.?", st)[0]
    st = re.sub(r"[.,]+$", "", st).strip()
    words = st.split()
    if len(words) >= 2 and words[-1] in TITLES:
        st = " ".join([words[-1]] + words[:-1])
    m = re.match(r"\d+", (number or "").strip())
    return re.sub(r"^(\w+) \1\b", r"\1", street_text(kind, st, m.group(0) if m else ""))  # 'PLAZA PLAZA DE ESPAÑA'


def folded(s):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()).strip()


GENERIC = {"centro", "salud", "consultorio", "local", "hospital", "clinica", "general", "auxiliar", "periferico", "medico",
            "atencion", "primaria", "rural", "de", "del", "la", "las", "los", "el", "y", "san", "santa", "nuestra", "senora"}


# A health place's name: REGCESS writes some centres as just their town ("TRUJILLO").
HEALTH_WORDS = re.compile(r"centr|salud|salut|consult|hospit|clinic|ambulat|sanitar|\bc\.?s\.?\b|\bpac\b|\bu\.?b\.?\b|\bcap\b|"
                          r"osasun|policl|medic|sanatori|\bcs\b|\bcl\b", re.I)


def same_place(name, candidate):
    """The candidate is a health place and has every distinctive word of the register's name ('C.S. Talavera
    Centro' vs 'CENTRO DE SALUD TALAVERA CENTRO (Talavera de la Reina)'); not the town's bullring."""
    want = {w for w in re.findall(r"[a-z0-9]+", folded(name)) if len(w) > 2 and w not in GENERIC}
    have = set(re.findall(r"[a-z0-9]+", folded(candidate)))
    return bool(want) and want <= have and bool(HEALTH_WORDS.search(candidate))


def centre_name(name, rtype):
    """'TRUJILLO' (a C231) → 'Centro de salud Trujillo'; names that say what they are stay."""
    n = title(name)
    if HEALTH_WORDS.search(n):
        return n
    return f"{ {'C231': 'Centro de salud', 'C232': 'Consultorio'}.get(rtype, 'Hospital') } {n}"


class Geocoder:
    """CartoCiudad candidates, keeping the first in the expected municipality (INE code): a bare street name
    otherwise lands in another town. Answers are cached by query (only found ones)."""

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
        # Only the answers this run used (addresses gone from the registers drop out); all when it asked none.
        with open(path, "w", encoding="utf-8") as f:
            for k, (lat, lon, prec) in sorted((self.used or self.cache).items()):
                f.write(f"{k}\t{lat:.6f}\t{lon:.6f}\t{prec}\n")

    def _ask(self, endpoint, **params):
        with self.lock:
            self.asked += 1
        return get_json(f"{GEOCODER}/{endpoint}?{urllib.parse.urlencode(params)}", timeout=60, tries=4)

    def one(self, text, ine, types, precision):
        key = f"{ine}|{folded(text)}|{precision}"
        with self.lock:
            if key in self.cache:
                self.used[key] = self.cache[key]
                return self.cache[key]
        hit = None
        for c in self._ask("candidates", q=text, limit=15):
            if c.get("muniCode") != ine or c.get("type") not in types:
                continue
            # A place by name must be that place, not another one in the town ("Centro de Salud Mallén").
            if precision == "place" and not same_place(text.split(",")[0], c.get("address", "")):
                continue
            lat, lon = c.get("lat"), c.get("lng")
            if not lat or not lon:  # towns and bare streets come without a point: ask for that one
                try:
                    d = self._ask("find", id=c["id"], type=c["type"])
                    lat, lon = d.get("lat"), d.get("lng")
                except Exception:  # noqa: BLE001
                    continue
            if lat and lon:
                hit = (float(lat), float(lon), precision if c["type"] != "callejero" or precision != "portal" else "street")
                break
        if hit:
            with self.lock:
                self.cache[key] = hit
                self.used[key] = hit
        return hit

    def locate(self, attempts):
        """attempts: [(text, ine, types, precision)], tried in order."""
        for text, ine, types, precision in attempts:
            if not text.strip(" ,"):
                continue
            try:
                hit = self.one(text, ine, types, precision)
            except Exception as e:  # noqa: BLE001
                print(f"[geocoder] {text}: {e}", file=sys.stderr)
                hit = None
            if hit:
                return hit
        return None


# --- Regional pharmacy registers --------------------------------------------------------------
# One function per register, returning rec()s; codes must be stable month to month (the register's own code),
# unique within the source. Each has its community and whether it lists botiquines (else REGCESS adds them).


def castilla_la_mancha():
    layer = "https://services-eu1.arcgis.com/LVA9E9zjh6QfM7Mo/arcgis/rest/services/Farmacias_de_CastillaLa_Mancha/FeatureServer/0"
    return [rec("es-cm", p.get("Clave_far") or f"fid{p.get('FID')}", lat, lon, p.get("Titular"), p.get("Telefono"),
                p.get("Domicilio"), p.get("Municipio"))
            for p, lon, lat in arcgis_features(layer)]


def catalunya():
    # Every authorised health establishment; F = farmàcia, R = farmaciola (a botiquín).
    url = ("https://analisi.transparenciacatalunya.cat/resource/nrmq-ytje.json?"
           + urllib.parse.urlencode({"$where": "tipus_establiment_codi in('F','R')", "$limit": 50000}))
    out = []
    for p in get_json(url, timeout=300):
        kind = "botiquin" if p.get("tipus_establiment_codi") == "R" else "pharmacy"
        address = " ".join(x for x in (p.get("tipus_via_nom"), p.get("via_nom"), p.get("numero_via")) if x)
        holder = p.get("titular_nom") or p.get("establiment_nom")
        if kind == "botiquin":
            holder = p.get("municipi_nom") or holder
        out.append(rec("es-ct", p.get("establiment_codi"), num(p.get("latitud")), num(p.get("longitud")), holder,
                       p.get("telefon"), address, p.get("municipi_nom"), kind))
    return out


def aragon():
    # The regional register (REGCESS codes) on IDEAragon. Botiquines are named after their village.
    url = ("https://idearagon.aragon.es/Visor2D/GeoserverWFS?service=WFS&version=2.0.0&request=GetFeature"
           "&typeNames=VISOR2D:t206_farmacias_y_botiquines&outputFormat=application/json&srsName=EPSG:4326")
    out = []
    for p, lon, lat in wfs_points(url):
        kind = "botiquin" if str(p.get("clase", "")).startswith("E2") else "pharmacy"
        out.append(rec("es-ar", p.get("ccn") or p.get("cod_autonomico"), lat, lon, p.get("nombre_centro"), "",
                       str(p.get("direccion", "")).split(",")[0], p.get("dmuniine"), kind))
    return out


def illes_balears():
    layer = "https://ideib.caib.es/geoserveis/rest/services/public/GOIB_SUPE_IB/MapServer/1"
    out = []
    for p, lon, lat in arcgis_features(layer):
        if p.get("VALID_FINSA"):  # closed
            continue
        kind = "botiquin" if "farmaciola" in str(p.get("FUNCIO", "")).lower() else "pharmacy"
        holder = p.get("NOM_MUNICIPI") if kind == "botiquin" else (p.get("PROPIETARI") or p.get("NOM"))
        out.append(rec("es-ib", p.get("ID_REGISTRE") or p.get("OBJECTID"), lat, lon, holder, "", p.get("ADRECA"),
                       p.get("NOM_MUNICIPI"), kind))
    return out


def pick(row, *names):
    """A column by any of its spellings, ignoring accents and case ('Código Centro' or 'Codigo Centro')."""
    by = {folded(k): v for k, v in row.items()}
    for n in names:
        if folded(n) in by:
            return by[folded(n)]
    return ""


def navarra():
    # The daily list of open pharmacies has no coordinates; IDENA's layer has them but dates from 2021. Joined on
    # the register's code: one opened since then is left to REGCESS (see regcess_points), one closed since is gone.
    current = csv_rows(get("https://datosabiertos.navarra.es/datastore/dump/d9eaca22-ac1e-457f-9157-e48169b2eac0?format=csv"))
    where = {p.get("IDFARMACIA"): (lon, lat) for p, lon, lat in wfs_points(
        "https://idena.navarra.es/ogc/wfs?service=WFS&version=2.0.0&request=GetFeature"
        "&typeNames=IDENA:DOTACI_Sym_Farmacias&outputFormat=application/json&srsName=EPSG:4326")}
    phones = {}
    try:
        for r in csv_rows(get("https://datosabiertos.navarra.es/dataset/d3445b49-8a64-41bb-ab69-996ce68329d9/resource/"
                              "e309e89e-d62e-4222-b6fa-e81d0924a086/download/guardias.csv")):
            if pick(r, "cod_Farmacia") and pick(r, "telefono"):
                phones[pick(r, "cod_Farmacia").strip()] = pick(r, "telefono")
    except Exception as e:  # noqa: BLE001 (phones are a bonus)
        print(f"[es-nc] no on-duty roster: {e}", file=sys.stderr)
    out = []
    for r in current:
        code = pick(r, "Código Centro").strip()
        if not code or code not in where or "autorizado" not in pick(r, "Estado del Centro").lower():
            continue
        lon, lat = where[code]
        out.append(rec("es-nc", code, lat, lon, pick(r, "Nombre Centro"), phones.get(code, ""), pick(r, "Domicilio"),
                       pick(r, "Localidad")))
    return out


def andalucia():
    # DERA (IECA) from the Consejería de Salud's register, every location checked by IECA; no botiquines.
    url = ("https://www.ideandalucia.es/services/DERA_g12_servicios/wfs?service=WFS&version=2.0.0&request=GetFeature"
           "&typeNames=DERA_g12_servicios:g12_04_Farmacia&outputFormat=application/json&srsName=EPSG:4326")
    return [rec("es-an", p.get("nica") or p.get("id_dera"), lat, lon, p.get("nombre"), "", p.get("direccion"), p.get("municipio"))
            for p, lon, lat in wfs_points(url)]


def madrid():
    # UTM 30 ETRS89 (unstated; two addresses checked within 60 m). The region has no botiquines.
    d = get_json("https://datos.comunidad.madrid/dataset/2d682b1d-e2e8-4c6f-b902-7a3f108e2fb9/resource/"
                 "6f1a2274-740c-47b5-a06d-2ab6ffb30685/download/oficinas_farmacia.json")
    out = []
    for p in d["data"] if isinstance(d, dict) else d:
        x, y = num(p.get("LOCALIZACION_COORDENADA_X")), num(p.get("LOCALIZACION_COORDENADA_Y"))
        lat, lon = utm_to_wgs84(x, y, 30) if x and y else (None, None)
        address = " ".join(str(p.get(k) or "") for k in ("DIRECCION_VIAL_TIPO", "DIRECCION_VIAL_NOMBRE", "DIRECCION_VIAL_NRO"))
        # Holders as "NAME SURNAMES , NAME2 SURNAMES2": the first names the pharmacy.
        first = str(p.get("TITULARES_NOMBRE") or "").split(" , ")[0]
        out.append(rec("es-md", p.get("CODIGO_NACIONAL_CCN") or p.get("FARMACIA_NRO_SOE"), lat, lon, p.get("TITULARES_NOMBRE"),
                       "", address, p.get("MUNICIPIO_NOMBRE"), name=f"Farmacia {title(first)}".strip()))
    return out


def euskadi():
    base = "https://opendata.euskadi.eus/contenidos/ds_localizaciones/farmacias_y_botiquines_euskadi/opendata"
    out = [rec("es-pv", p.get("idif"), lat, lon, p.get("titular1"), p.get("telefono"), p.get("direccion"), p.get("municipio"))
           for p, lon, lat in wfs_points(f"{base}/farmacias.geojson")]
    # botiquines.geojson has broken points ([32.4, 3.9]); the spreadsheet's UTM 30 ones are right.
    for p in xlsx_rows(get(f"{base}/botiquines.xlsx")):
        x, y = num(pick(p, "XETRS89")), num(pick(p, "YETRS89"))
        if not x or not y:
            continue
        lat, lon = utm_to_wgs84(x, y, 30)
        out.append(rec("es-pv", pick(p, "IDBOTIQ"), lat, lon, pick(p, "ENTIDAD"), pick(p, "TFNO BOTIQ"), pick(p, "DIRECCION"),
                       pick(p, "MUNICIPIO"), "botiquin"))
    return out


def la_rioja():
    # The regional register of centres, one row per service: E1 = pharmacy. LATITUD_X / LONGITUD_Y are lat / lon.
    d = get_json("https://ias1.larioja.org/opendata/download?r=Y2Q9OTA1fGNmPTA0")
    out, seen = [], set()
    for p in d["data"] if isinstance(d, dict) else d:
        if p.get("COD_TIPO_CENTRO") != "E1" or p.get("COD_ESTABLECIMIENTO_INTERNO") in seen:
            continue
        seen.add(p.get("COD_ESTABLECIMIENTO_INTERNO"))
        address = " ".join(str(p.get(k) or "") for k in ("COD_TIPO_VIA", "VIA", "NUMERO_VIA"))
        out.append(rec("es-ri", p.get("COD_ESTABLECIMIENTO_CCN") or p.get("COD_ESTABLECIMIENTO_REGISTRO"), num(p.get("LATITUD_X")),
                       num(p.get("LONGITUD_Y")), p.get("DENOMINACION"), p.get("TELEFONO"), address, p.get("DESC_POBLACION")))
    return out


# community INE code, lists botiquines (else REGCESS's are added)
REGIONAL = {
    "es-an": ("01", False), "es-ar": ("02", True), "es-ib": ("04", True), "es-cm": ("08", False),
    "es-ct": ("09", True), "es-md": ("13", True), "es-nc": ("15", False), "es-pv": ("16", True), "es-ri": ("17", False),
}
# Regional lists lag behind the register (Navarra's points date from 2021; Aragón lacks the botiquines authorised
# since 2024; Cataluña, Baleares, La Rioja a few new pharmacies). Where REGCESS carries the regional list's code,
# by community: which REGCESS column holds it. REGCESS pharmacies (and botiquines, where the regional list has
# them) whose code the regional list lacks are placed and added, unless a listed pharmacy is within 200 m or one
# sharing the holder's name within 1.5 km (a code that changed). Euskadi's idif is REGCESS's "48 E.1. 0969" as
# 480969 (code_key).
CODE_FIELD = {"01": "Código Autonómico del Centro", "02": "Código de Centro Normalizado REGCESS (CCN)",
              "04": "Código Autonómico del Centro", "09": "Código Autonómico del Centro",
              "13": "Código de Centro Normalizado REGCESS (CCN)", "15": "Código Autonómico del Centro",
              "16": "Código Autonómico del Centro", "17": "Código de Centro Normalizado REGCESS (CCN)"}
# Castilla-La Mancha's codes (TO-162-F) aren't in REGCESS and a third of its holders differ from REGCESS's (transfers
# not yet in one or the other): where REGCESS counts more pharmacies in a municipality than the list, its pharmacies
# there are placed, and as many as the difference are added, those farthest from a listed one (none within 200 m).
BY_COUNT = {"08"}


def code_key(c):
    basque = re.fullmatch(r"\s*(\d\d)\s*E\.?\s*1\.?\s*(\d+)\s*", str(c or ""))
    if basque:
        return (basque.group(1) + basque.group(2).zfill(4)).lstrip("0")
    return re.sub(r"[^0-9A-Z]", "", str(c or "").split("#")[0].upper()).lstrip("0")


def town_key(s):
    """REGCESS writes "Herrera, La", the regions "La Herrera"."""
    s = folded(s)
    article = re.fullmatch(r"(.+?),\s*(el|la|los|las)", s)
    return f"{article.group(2)} {article.group(1)}" if article else s


# --- REGCESS (Ministerio de Sanidad) ----------------------------------------------------------

REGCESS = "https://regcesslm.sanidad.gob.es/recesAdminWeb/lm/GetExcelListadoMensual?tipoListado="
# Centre types kept, by REGCESS type code: what the app shows them as.
CENTRE_KINDS = {"C11": "hospital", "C12": "hospital", "C231": "clinic", "C232": "clinic"}


def unmangled(v):
    """A few REGCESS names are UTF-8 read as Latin-1 ("SÃ\x81NCHEZ"): put them back."""
    if isinstance(v, str) and "Ã" in v:
        for codec in ("latin-1", "cp1252"):
            try:
                return v.encode(codec).decode("utf-8")
            except (UnicodeEncodeError, UnicodeDecodeError):
                pass
    return v


def regcess(listing):
    rows = [{k: unmangled(v) for k, v in r.items()} for r in xlsx_rows(get(REGCESS + listing, timeout=600))]
    for r in rows:
        r["_type"] = r.get("Tipo centro", "").split(" ")[0]
    return rows


def regcess_attempts(r, kind, unique_in_town):
    ine = (pick(r, "Código Municipio") or "")[:5]
    muni = municipality_name(pick(r, "Municipio"))
    name = pick(r, "Nombre Centro")
    street = street_text(pick(r, "Código Tipo Vía"), pick(r, "Nombre de la vía"), pick(r, "Número Vía"))
    bare = street_text("", pick(r, "Nombre de la vía"), pick(r, "Número Vía"))
    attempts = []
    if kind in ("hospital", "clinic"):
        attempts.append((f"{centre_name(name, r['_type'])}, {muni}", ine, PLACE_TYPES, "place"))
    attempts += [(f"{street}, {muni}", ine, ADDRESS_TYPES, "portal"), (f"{bare}, {muni}", ine, ADDRESS_TYPES, "portal")]
    tidy = tidy_street(pick(r, "Código Tipo Vía"), pick(r, "Nombre de la vía"), pick(r, "Número Vía"))
    if tidy != street:
        attempts.append((f"{tidy}, {muni}", ine, ADDRESS_TYPES, "portal"))
    if kind == "botiquin":
        village = re.sub(r"^BOTIQU[IÍ]N(\s+(FARMAC[EÉ]UTICO|RURAL))?(\s+(DE|DEL))?\s+", "", name.upper()).split("(")[0].strip()
        attempts.append((f"{village}, {muni}", ine, TOWN_TYPES, "town"))
    elif kind == "pharmacy" and unique_in_town:
        # The only pharmacy of a village: its centre is near enough, and what matters is that the village has one.
        attempts.append((muni, ine, TOWN_TYPES, "town"))
    return attempts


NAME_STOP = {"farmacia", "oficina", "botiquin", "lda", "ldo", "del", "de", "la", "las", "los", "y", "san", "santa", "cb", "maria", "jose"}


def name_words(s):
    return {w for w in re.findall(r"[a-z]+", folded(s)) if len(w) > 3 and w not in NAME_STOP}


def missing_from(regional, found, near=200, named=1500):
    """REGCESS pharmacies of a partial region that its own list doesn't have."""
    out = []
    for r in found:
        words = name_words(r["holder"])
        known = False
        for q in regional:
            d = 6371000 * math.hypot(math.radians(q["lon"] - r["lon"]) * math.cos(math.radians(r["lat"])), math.radians(q["lat"] - r["lat"]))
            if d <= near or (d <= named and words & name_words(q["holder"] or q["name"])):
                known = True
                break
        if not known:
            out.append(r)
    return out


def by_count(regional, found, listed, near=200, named=3000):
    """BY_COUNT: per municipality, the REGCESS pharmacies farthest from a listed one, as many as REGCESS has more.
    One sharing two words of a listed holder's name within 3 km is that pharmacy, placed elsewhere."""
    def dist(q, r):
        return 6371000 * math.hypot(math.radians(q["lon"] - r["lon"]) * math.cos(math.radians(r["lat"])), math.radians(q["lat"] - r["lat"]))

    def nearest(r):
        return min((dist(q, r) for q in regional), default=math.inf)

    def listed_by_name(r):
        words = name_words(r["holder"])
        return any(len(words & name_words(q["holder"])) >= 2 and dist(q, r) <= named for q in regional)
    by_town = {}
    for r in found:
        if r["kind"] == "pharmacy":
            by_town.setdefault(r["_town"], []).append(r)
    out = []
    for town, rs in by_town.items():
        far = sorted(((nearest(r), r) for r in rs if not listed_by_name(r)), key=lambda x: -x[0])
        out += [r for d, r in far[:max(0, len(rs) - listed.get(town, 0))] if d > near]
    return out


def regcess_points(geocoder, covered, with_botiquines, known=None, counts=None, limit=None):
    """Pharmacies and botiquines of the communities no regional register covers, plus the botiquines a regional
    register leaves out and those whose code it lacks (known: community → its codes, CODE_FIELD), or all the
    pharmacies of a municipality where it lists fewer (counts: community → town_key → pharmacies, BY_COUNT);
    hospitals, health centres and consultorios of every community. Rows a regional list lacks carry `_gap`."""
    known, counts = known or {}, counts or {}
    jobs = []
    est = regcess("E")
    towns, theirs = {}, {}
    for r in est:
        if r["_type"] == "E1":
            towns[pick(r, "Código Municipio")] = towns.get(pick(r, "Código Municipio"), 0) + 1
            k = (pick(r, "Código Comunidad Autónoma"), town_key(pick(r, "Municipio")))
            theirs[k] = theirs.get(k, 0) + 1
    for r in est:
        cc = pick(r, "Código Comunidad Autónoma")
        gap = cc in known and code_key(pick(r, CODE_FIELD[cc])) not in known[cc]
        if cc in counts and r["_type"] == "E1":
            town = town_key(pick(r, "Municipio"))
            gap = theirs[(cc, town)] > counts[cc].get(town, 0)
        if gap and "DEPOSITO" in folded(pick(r, "Nombre Centro")).upper():
            gap = False  # a military or hospital depot, not open to the public
        if r["_type"] == "E1" and (cc not in covered or gap):
            r["_gap"] = cc in covered
            jobs.append(("es-regcess", "pharmacy", r))
        elif r["_type"] == "E2" and (cc not in with_botiquines or gap):
            r["_gap"] = cc in with_botiquines
            jobs.append(("es-regcess", "botiquin", r))
    centres = [r for listing in ("C1", "C2") for r in regcess(listing) if r["_type"] in CENTRE_KINDS]
    jobs += [("es-regcess", CENTRE_KINDS[r["_type"]], r) for r in centres]
    if limit:
        jobs = jobs[:limit]

    def one(job):
        source, kind, r = job
        hit = geocoder.locate(regcess_attempts(r, kind, towns.get(pick(r, "Código Municipio")) == 1))
        if not hit:
            return None
        lat, lon, precision = hit
        cc = pick(r, "Código Comunidad Autónoma")
        if cc in COMMUNITIES and not inside(lat, lon, COMMUNITIES[cc][1]):
            return None
        address = street_text(pick(r, "Código Tipo Vía"), pick(r, "Nombre de la vía"), pick(r, "Número Vía"))
        holder = pick(r, "Nombre Centro")
        name = pharmacy_name(holder, kind) if kind in ("pharmacy", "botiquin") else centre_name(holder, r["_type"])
        code = pick(r, "Código de Centro Normalizado REGCESS (CCN)", "Código de Centro Normalizado") or pick(r, "Código Autonómico del Centro")
        out = rec(source, code, lat, lon, holder, pick(r, "Teléfono"), address, municipality_name(pick(r, "Municipio")), kind,
                  name=name, precision=precision)
        out["_community"] = cc
        out["_gap"] = bool(r.get("_gap"))
        auto = pick(r, "Código Autonómico del Centro") or ""
        out["_keys"] = {code_key(c) for c in (code, auto, auto.split("/")[0]) if c}
        out["_ine"] = (pick(r, "Código Municipio") or "")[:5]
        out["_town"] = town_key(pick(r, "Municipio"))
        return out

    out, missed = [], {}
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(GEOCODER_THREADS) as ex:
        for i, (job, res) in enumerate(zip(jobs, ex.map(one, jobs))):
            if res:
                out.append(res)
            else:
                missed[job[1]] = missed.get(job[1], 0) + 1
            if (i + 1) % 1000 == 0:
                print(f"[es-regcess] {i + 1}/{len(jobs)} ({time.time() - started:.0f} s, {geocoder.asked} asked)", file=sys.stderr)
    print(f"[es-regcess] placed {len(out)} of {len(jobs)}; not placed by kind: {missed}", file=sys.stderr)
    return out, missed, len(jobs)


SOURCES = {
    "es-cm": {"fetch": castilla_la_mancha, "name": "Relación Geográfica Oficial de Farmacias de Castilla-La Mancha",
              "publisher": "Junta de Comunidades de Castilla-La Mancha", "licence": "CC BY 4.0",
              "url": "https://datos.gob.es/es/catalogo/a08002880-farmacias-de-castilla-la-mancha"},
    "es-ct": {"fetch": catalunya, "name": "Establiments sanitaris autoritzats a Catalunya",
              "publisher": "Generalitat de Catalunya. Departament de Salut", "licence": "Llicència oberta d'ús d'informació - Catalunya",
              "url": "https://analisi.transparenciacatalunya.cat/d/nrmq-ytje"},
    "es-ar": {"fetch": aragon, "name": "Farmacias y botiquines (IDEAragon)", "publisher": "Gobierno de Aragón",
              "licence": "CC BY 4.0", "url": "https://idearagon.aragon.es/"},
    "es-ib": {"fetch": illes_balears, "name": "Farmàcia (IDEIB)", "publisher": "Govern de les Illes Balears. Conselleria de Salut",
              "licence": "CC BY", "url": "https://catalegdades.caib.cat/"},
    "es-nc": {"fetch": navarra, "name": "Farmacias abiertas al público; Farmacias de Navarra (IDENA)", "publisher": "Gobierno de Navarra",
              "licence": "CC BY 4.0", "url": "https://datosabiertos.navarra.es/"},
    "es-an": {"fetch": andalucia, "name": "DERA 12_04 Farmacia", "publisher": "Junta de Andalucía. IECA (Consejería de Salud y Consumo)",
              "licence": "CC BY 4.0", "url": "https://www.juntadeandalucia.es/institutodeestadisticaycartografia/dega/"},
    "es-md": {"fetch": madrid, "name": "Oficinas de farmacia", "publisher": "Comunidad de Madrid. Consejería de Sanidad",
              "licence": "CC BY 4.0", "url": "https://datos.comunidad.madrid/dataset/oficinas_farmacia"},
    "es-pv": {"fetch": euskadi, "name": "Farmacias y botiquines de Euskadi", "publisher": "Gobierno Vasco. Departamento de Salud",
              "licence": "CC BY 4.0", "url": "https://opendata.euskadi.eus/catalogo/-/farmacias-y-botiquines-de-euskadi/"},
    "es-ri": {"fetch": la_rioja, "name": "Registro de centros, servicios y establecimientos sanitarios", "publisher": "Gobierno de La Rioja",
              "licence": "CC BY", "url": "https://web.larioja.org/dato-abierto/datoabierto?n=opd-905"},
    "es-regcess": {"fetch": None, "name": "REGCESS, Registro General de Centros, Servicios y Establecimientos Sanitarios",
                   "publisher": "Ministerio de Sanidad", "licence": "Reuse with attribution (Ley 37/2007; aviso legal de sanidad.gob.es)",
                   "url": "https://regcess.mscbs.es/regcessWeb/"},
    "es-geocoder": {"fetch": None, "name": "CartoCiudad geocoder (placing REGCESS addresses)", "publisher": "Instituto Geográfico Nacional",
                    "licence": "CC BY 4.0 (scne.es)", "url": "https://www.cartociudad.es/"},
    # Regional health centres (CENTRES)
    "es-an-centres": {"fetch": None, "name": "DERA G12 Servicios: centros de salud, hospitales", "publisher": "Junta de Andalucía. IECA",
                      "licence": "CC BY 4.0", "url": "https://www.juntadeandalucia.es/institutodeestadisticaycartografia/dega/"},
    "es-ar-centres": {"fetch": None, "name": "Sanidad: instalaciones sanitarias (centros de salud, hospitales)", "publisher": "Gobierno de Aragón",
                      "licence": "CC BY 4.0", "url": "https://opendata.aragon.es/"},
    "es-ib-centres": {"fetch": None, "name": "Equipament sanitari i hospitalari (IDEIB)", "publisher": "Govern de les Illes Balears",
                      "licence": "CC BY", "url": "https://ideib.caib.es/"},
    "es-cl-centres": {"fetch": None, "name": "Registro de centros sanitarios de Castilla y León", "publisher": "Junta de Castilla y León",
                      "licence": "CC BY 4.0", "url": "https://datosabiertos.jcyl.es/"},
    "es-cm-centres": {"fetch": None, "name": "Centros de salud, consultorios locales y hospitales de Castilla-La Mancha",
                      "publisher": "Junta de Comunidades de Castilla-La Mancha (SESCAM)", "licence": "CC BY 4.0",
                      "url": "https://services-eu1.arcgis.com/LVA9E9zjh6QfM7Mo/arcgis/rest/services"},
    "es-ct-centres": {"fetch": None, "name": "Equipaments de Catalunya: centres sanitaris", "publisher": "Generalitat de Catalunya",
                      "licence": "Llicència oberta d'ús d'informació - Catalunya", "url": "https://analisi.transparenciacatalunya.cat/d/8gmd-gz7i"},
    "es-vc-centres": {"fetch": None, "name": "Centros de salud, consultorios auxiliares y hospitales de la Comunitat Valenciana",
                      "publisher": "Generalitat Valenciana. Conselleria de Sanitat", "licence": "CC BY", "url": "https://dadesobertes.gva.es/"},
    "es-md-centres": {"fetch": None, "name": "Centros, servicios y establecimientos sanitarios (points only)", "publisher": "Comunidad de Madrid",
                      "licence": "CC BY", "url": "https://datos.comunidad.madrid/dataset/centros_servicios_establecimientos_sanitarios"},
    "es-mc-centres": {"fetch": None, "name": "Centros de Salud y consultorios de la Región de Murcia", "publisher": "Región de Murcia (CARM)",
                      "licence": "Reuse with attribution (aviso legal de datosabiertos.regiondemurcia.es)", "url": "https://datosabiertos.carm.es/"},
    "es-nc-centres": {"fetch": None, "name": "Servicio Navarro de Salud: centros de atención primaria y especializada (IDENA)",
                      "publisher": "Gobierno de Navarra", "licence": "CC BY 4.0", "url": "https://idena.navarra.es/"},
    "es-pv-centres": {"fetch": None, "name": "Centros de salud, ambulatorios y hospitales públicos de Euskadi", "publisher": "Gobierno Vasco. Osakidetza",
                      "licence": "CC BY 4.0", "url": "https://opendata.euskadi.eus/"},
    "es-ri-centres": {"fetch": None, "name": "Registro de centros, servicios y establecimientos sanitarios (centres)", "publisher": "Gobierno de La Rioja",
                      "licence": "CC BY", "url": "https://web.larioja.org/dato-abierto/datoabierto?n=opd-905"},
}


# --- Regional health centres -----------------------------------------------------------------
# REGCESS's centres are placed by geocoding their address, and some land far off: a management address (Madrid's
# rural consultorios placed in the city), a village of the same name, a pedanía's street guessed (Murcia). Where a
# region publishes its centres with points under an open licence, those are used: a REGCESS centre the regional
# list has (same code, within 300 m, or named alike in the same town or within 3 km) gives way to it; the ones it
# doesn't list (Aragón's consultorios, say) stay. Madrid's register has no names: its points only move the REGCESS
# centres they match by code.

def regional_centre(source, code, rtype, lat, lon, name, phone_="", address="", municipality="", ine="", keys=()):
    kind = "hospital" if rtype in ("C11", "C12") else "clinic"
    n = re.sub(r"^(C\.?\s?S\.?|CS)\s+", "Centro de salud ", title(name), flags=re.I)
    n = re.sub(r"^(C\.?\s?[VA]\.?|CA|CON\.?)\s+", "Consultorio ", n, flags=re.I)
    n = re.sub(r"\b(cap|pac|cuap|suap|cae|ub|c\.a\.p\.)(?=\s|$)", lambda m: m.group(1).upper(), n, flags=re.I)
    r = rec(source, code or "", lat, lon, "", phone_, address, municipality, kind,
            name=centre_name(n, rtype) if n else "", precision="source")
    r["_ine"] = str(ine or "")[:5]
    r["_keys"] = {code_key(k) for k in keys if k}
    return r


def andalucia_centres():
    base = ("https://www.ideandalucia.es/services/DERA_g12_servicios/wfs?service=WFS&version=2.0.0&request=GetFeature"
            "&outputFormat=application/json&srsName=EPSG:4326&typeNames=DERA_g12_servicios:")
    out = []
    for p, lon, lat in wfs_points(base + "g12_01_CentroSalud"):  # centros de salud and consultorios together
        rtype = "C232" if "consult" in folded(p.get("nombre")) else "C231"
        out.append(regional_centre("es-an-centres", p.get("id_dera"), rtype, lat, lon, p.get("nombre"), p.get("telefono"),
                                   p.get("direccion"), p.get("municipio"), p.get("cod_mun")))
    for p, lon, lat in wfs_points(base + "g12_02_Hospital_CAE"):
        if folded(p.get("tipo")) == "hospital":  # not the outpatient centres (CAE)
            out.append(regional_centre("es-an-centres", p.get("id_dera"), "C11", lat, lon, p.get("nombre"), p.get("telefono"),
                                       p.get("direccion"), p.get("municipio"), p.get("cod_mun")))
    return out


def aragon_centres():
    # GeoJSON whose coordinates are UTM 30 (EPSG:25830) metres; `regcess` is the CCN. No consultorios published.
    out = []
    for rid, rtype in (("286", "C231"), ("287", "C11")):
        d = get_json(f"https://opendata.aragon.es/GA_OD_Core/download?resource_id={rid}&formato=json", timeout=300)
        for f in d.get("features", []):
            p, c = f.get("properties") or {}, (f.get("geometry") or {}).get("coordinates") or []
            if len(c) < 2 or not c[0]:
                continue
            lat, lon = utm_to_wgs84(float(c[0]), float(c[1]), 30)
            out.append(regional_centre("es-ar-centres", p.get("regcess"), rtype, lat, lon, p.get("nombre"), p.get("telefono"),
                                       p.get("direccion"), p.get("municipio") or p.get("localidad"), keys=(p.get("regcess"),)))
    return out


def illes_balears_centres():
    base = "https://ideib.caib.es/geoserveis/rest/services/public/GOIB_SUPE_IB/MapServer/"
    out = []
    for layer in ("5", "6"):
        for p, lon, lat in arcgis_features(base + layer):
            f = folded(p.get("FUNCIO"))
            rtype = {"unitat basica": "C232", "centre sanitari": "C231", "hospital": "C11"}.get(f)
            if rtype:  # "centre sanitari previst" (planned) and untyped rows left out
                out.append(regional_centre("es-ib-centres", p.get("INSPIREID") or p.get("NOM"), rtype, lat, lon, p.get("NOM"),
                                           "", p.get("ADRECA"), p.get("MUNICIPI")))
    return out


def castilla_la_mancha_centres():
    base = "https://services-eu1.arcgis.com/LVA9E9zjh6QfM7Mo/arcgis/rest/services/"
    out = []
    for layer, rtype in (("Centros_de_Salud_de_CastillaLa_Mancha", "C231"), ("Consultorios_Locales_de_CastillaLa_Mancha", "C232"),
                         ("Hospitales_de_CastillaLa_Mancha", "C11")):
        for p, lon, lat in arcgis_features(f"{base}{layer}/FeatureServer/0", page=2000):
            code = p.get("COD_CEN") or p.get("CODIGO_CEN")
            out.append(regional_centre("es-cm-centres", code, rtype, lat, lon, p.get("NOM_CEN") or p.get("NOMBRE"),
                                       p.get("TEL_CEN") or p.get("TFNOS"), p.get("DIR_CEN") or p.get("DIRECCION") or "",
                                       p.get("MUNICIPIO") or p.get("DES_LOC") or p.get("LOCALIDAD"),
                                       p.get("CODMUN") or p.get("COD_MUN"), keys=(code,)))
    return out


def catalunya_centres():
    where = " or ".join(f"categoria like '%Centres sanitaris|{n}.%'" for n in (1, 2, 3))
    url = "https://analisi.transparenciacatalunya.cat/resource/8gmd-gz7i.json?" + urllib.parse.urlencode({"$where": where, "$limit": 5000})
    out = []
    for p in get_json(url, timeout=300):
        cat = p.get("categoria") or ""
        name = p.get("nom") or ""
        rtype = "C11" if "sanitaris|3." in cat else ("C232" if "consultori" in folded(name) else "C231")
        out.append(regional_centre("es-ct-centres", p.get("idequipament"), rtype, num(p.get("latitud")), num(p.get("longitud")),
                                   name, p.get("telefon1"), " ".join(x for x in (p.get("tipus_via"), p.get("via"), p.get("num")) if x),
                                   p.get("poblacio"), str(p.get("codi_municipi") or "")[:5]))
    return out


def valencia_centres():
    # Three layers on dadesobertes.gva.es, whose file names carry their date (found through CKAN); UTM 30 metres.
    out = []
    for package in ("sanidad-sip-centros-salud", "sanidad-sip-consultorios-aux", "sanidad-sip-hospitales"):
        meta = get_json(f"https://dadesobertes.gva.es/api/3/action/package_show?id={package}", timeout=120)["result"]
        url = next(r["url"] for r in meta["resources"] if r.get("url", "").lower().endswith(".geojson"))
        for f in get_json(url, timeout=300).get("features", []):
            p = f.get("properties") or {}
            rtype = {1: "C231", 2: "C232", 38: "C232", 14: "C11"}.get(int(num(p.get("TCE_CODI")) or 0))
            x, y = num(p.get("X_COORD")), num(p.get("Y_COORD"))
            if not rtype or not x or not y:
                continue
            lat, lon = utm_to_wgs84(x, y, 30)
            ine = f"{int(num(p.get('CEN_PROV')) or 0):02d}{int(num(p.get('CEN_LOCA')) or 0):03d}"
            out.append(regional_centre("es-vc-centres", p.get("CEN_COD"), rtype, lat, lon, p.get("CEN_DESCLA"), "",
                                       " ".join(str(p.get(k) or "") for k in ("CEN_NOMBCA", "CEN_NUMCAL")).strip(), "", ine))
    return out


def madrid_centres():
    # One row per service of every authorised centre; no names. UTM 30 metres. `centro_nro_registro` is REGCESS's
    # autonomic code: these rows only move the REGCESS centres they match.
    url = "https://datos.comunidad.madrid/dataset/d8a0a444-adf5-4c04-8999-0eac3de52cb7/resource/94090084-2276-4a07-87b4-cd028ea6b46d/download"
    d = get_json(url, timeout=600)
    rows = d.get("data", d) if isinstance(d, dict) else d
    kinds = {"centro de salud": "C231", "consultorio de atencion primaria": "C232", "hospital general": "C11",
             "hospital especializado": "C12"}
    out, seen = [], set()
    for p in rows:
        code = p.get("centro_nro_registro")
        rtype = kinds.get(folded(p.get("centro_tipo")))
        x, y = num(p.get("localizacion_coordenada_x")), num(p.get("localizacion_coordenada_y"))
        if not code or code in seen or not rtype or not x or not y:
            continue
        seen.add(code)
        lat, lon = utm_to_wgs84(x, y, 30)
        r = regional_centre("es-md-centres", code, rtype, lat, lon, "", "", "", p.get("municipio_nombre"), keys=(code,))
        r["_override"] = True
        out.append(r)
    return out


def murcia_centres():
    # CP850 text, ';' separated, decimal commas; x is the longitude. The description is "street, municipality".
    out = []
    for p in csv_rows(get("https://datosabiertos.carm.es/odata/Sanidad/SANI_Centros_de_Salud.csv"), ";", "cp850"):
        name = p.get("Name") or ""
        rtype = "C232" if "consult" in folded(name) else "C231"
        desc = p.get("description") or ""
        muni = desc.rsplit(",", 1)[-1].strip() if "," in desc else ""
        out.append(regional_centre("es-mc-centres", p.get("gid"), rtype, num(p.get("y")), num(p.get("x")), name, "",
                                   desc.rsplit(",", 1)[0] if "," in desc else desc, muni))
    return out


def navarra_centres():
    base = ("https://idena.navarra.es/ogc/wfs?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json"
            "&srsName=EPSG:4326&typeNames=IDENA:")
    out = []
    for p, lon, lat in wfs_points(base + "DOTACI_Sym_SNSPrimaria"):
        name = p.get("CENSAN") or ""
        if "hospital" in folded(name):
            continue  # a hospital's paediatric unit listed with primary care
        rtype = "C231" if "centro de salud" in folded(name) else "C232"
        out.append(regional_centre("es-nc-centres", p.get("IDCENSAN"), rtype, lat, lon, name, p.get("TELEFONO"),
                                   p.get("DIRECCION"), p.get("POBLACION")))
    for p, lon, lat in wfs_points(base + "DOTACI_Sym_SNSEspecial"):
        name = p.get("CENSAN") or ""
        if re.search(r"hospital|clinica", folded(name)):  # not the emergency units listed apart at the same hospitals
            out.append(regional_centre("es-nc-centres", p.get("IDCENSAN"), "C11", lat, lon, name, p.get("TELEFONO"),
                                       p.get("DIRECCION"), p.get("POBLACION")))
    return out


def euskadi_centres():
    d = get_json("https://opendata.euskadi.eus/contenidos/ds_localizaciones/centros_salud_en_euskadi/opendata/centros-salud.geojson", timeout=300)
    kinds = {"consultorio": "C232", "centro de salud": "C231", "ambulatorio": "C231", "pac": "C231", "hospital": "C11"}
    out = []
    for f in d.get("features", []):
        p, c = f.get("properties") or {}, (f.get("geometry") or {}).get("coordinates") or []
        rtype = kinds.get(folded(p.get("tipodecentro")))
        if rtype and len(c) >= 2:  # mental health, day hospitals, "otros" left out
            out.append(regional_centre("es-pv-centres", p.get("codigodelcentro"), rtype, c[1], c[0], p.get("nombre"), "",
                                       p.get("direccion"), p.get("municipio")))
    return out


def castilla_y_leon_centres():
    url = ("https://analisis.datosabiertos.jcyl.es/api/explore/v2.1/catalog/datasets/"
           "registro-de-centros-sanitarios-de-castilla-y-leon/exports/json")
    kinds = {"consultorios de atencion primaria": "C232", "centros de atencion primaria: centros de salud": "C231",
             "hospitales generales": "C11", "hospitales especializados": "C12"}
    out = []
    for p in get_json(url, timeout=600):
        rtype = kinds.get(folded(p.get("tipo_de_centro")))
        pos = p.get("posicion") or {}
        if rtype and pos.get("lat"):
            code = p.get("no_de_registro")
            out.append(regional_centre("es-cl-centres", code, rtype, pos["lat"], pos["lon"], p.get("nombre_del_centro"),
                                       p.get("telefono"), p.get("direccion"), p.get("localidad"), keys=(code,)))
    return out


def la_rioja_centres():
    d = get_json("https://ias1.larioja.org/opendata/download?r=Y2Q9OTA1fGNmPTA0")
    out, seen = [], set()
    for p in d["data"] if isinstance(d, dict) else d:
        rtype, ccn = p.get("COD_TIPO_CENTRO"), p.get("COD_ESTABLECIMIENTO_CCN")
        if rtype not in CENTRE_KINDS or not ccn or ccn in seen or not num(p.get("LATITUD_X")):
            continue
        seen.add(ccn)
        address = " ".join(str(p.get(k) or "") for k in ("COD_TIPO_VIA", "VIA", "NUMERO_VIA")).strip()
        out.append(regional_centre("es-ri-centres", ccn, rtype, num(p.get("LATITUD_X")), num(p.get("LONGITUD_Y")),
                                   p.get("DENOMINACION"), p.get("TELEFONO"), address, p.get("DESC_POBLACION"), keys=(ccn,)))
    return out


# source → (community, fetch)
CENTRES = {
    "es-an-centres": ("01", andalucia_centres), "es-ar-centres": ("02", aragon_centres),
    "es-ib-centres": ("04", illes_balears_centres), "es-cl-centres": ("07", castilla_y_leon_centres),
    "es-cm-centres": ("08", castilla_la_mancha_centres), "es-ct-centres": ("09", catalunya_centres),
    "es-vc-centres": ("10", valencia_centres), "es-md-centres": ("13", madrid_centres),
    "es-mc-centres": ("14", murcia_centres), "es-nc-centres": ("15", navarra_centres),
    "es-pv-centres": ("16", euskadi_centres), "es-ri-centres": ("17", la_rioja_centres),
}
CENTRE_WORDS_STOP = GENERIC | {"centre", "sanitari", "consultori", "salut", "unitat", "basica", "ambulatorio", "osasun",
                               "zentroa", "pac", "cap", "hospitalario", "universitario", "comarcal", "infanta", "infante"}


def centre_words(s):
    return {w for w in re.findall(r"[a-z0-9]+", folded(s)) if len(w) > 2 and w not in CENTRE_WORDS_STOP}


def one_spot_per_kind(rows, metres=15):
    out, grid, cell = [], {}, 0.0005
    for r in rows:
        key = (r["kind"], int(r["lat"] // cell), int(r["lon"] // cell))
        near = [o for di in (-1, 0, 1) for dj in (-1, 0, 1) for o in grid.get((key[0], key[1] + di, key[2] + dj), ())]
        if any(6371000 * math.hypot(math.radians(o["lon"] - r["lon"]) * math.cos(math.radians(r["lat"])),
                                    math.radians(o["lat"] - r["lat"])) <= metres for o in near):
            continue
        grid.setdefault(key, []).append(r)
        out.append(r)
    return out


def replace_centres(regcess_rows, regional, community):
    """Which REGCESS centres of a community its regional list replaces; the regional rows to add (Madrid's take the
    matched REGCESS centre's name). Returns (REGCESS rows kept, regional rows added)."""
    def dist(a, b):
        return 6371000 * math.hypot(math.radians(a["lon"] - b["lon"]) * math.cos(math.radians(a["lat"])), math.radians(a["lat"] - b["lat"]))

    cell = 0.03  # ~3 km
    by_key, grid, towns = {}, {}, {}
    for r in regional:
        r["_words"] = centre_words(r["name"])
        for k in r.get("_keys") or ():
            by_key.setdefault((r["kind"], k), r)
        grid.setdefault((r["kind"], int(r["lat"] // cell), int(r["lon"] // cell)), []).append(r)
        for t in (r.get("_ine"), folded(r["municipality"])):
            if t:
                towns.setdefault((r["kind"], t), []).append(r)
    kept, matched = [], {}
    for g in regcess_rows:
        if g["source"] != "es-regcess" or g.get("_community") != community or g["kind"] not in ("hospital", "clinic"):
            kept.append(g)
            continue
        hit = next((by_key[(g["kind"], k)] for k in g.get("_keys") or () if (g["kind"], k) in by_key), None)
        around = [r for di in (-1, 0, 1) for dj in (-1, 0, 1)
                  for r in grid.get((g["kind"], int(g["lat"] // cell) + di, int(g["lon"] // cell) + dj), ())]
        if not hit:
            close = [(dist(g, r), r) for r in around]
            close = [x for x in close if x[0] <= 300]
            if close:
                hit = min(close, key=lambda x: x[0])[1]
        if not hit:
            # A shared word that isn't the town's name: "Hospital Quironsalud Torrevieja" is not "Hospital de Torrevieja".
            gw = centre_words(g["name"]) - centre_words(g["municipality"])
            if gw:
                town = [r for t in (g.get("_ine"), folded(g["municipality"])) if t for r in towns.get((g["kind"], t), ())]
                hit = next((r for r in town + [r for r in around if dist(g, r) <= 3000]
                            if gw & (r["_words"] - centre_words(r["municipality"]))), None)
        if hit and not (hit.get("_override") and id(hit) in matched):
            matched.setdefault(id(hit), g)
        else:
            kept.append(g)
    added = []
    for r in regional:
        g = matched.get(id(r))
        if r.get("_override"):
            if not g:
                continue  # Madrid's rows have no names: only those matched by code move a centre
            r = {**r, "name": g["name"], "phone": g["phone"], "address": g["address"], "municipality": g["municipality"]}
        elif g:
            r = {**r, "phone": r["phone"] or g["phone"], "name": r["name"] or g["name"]}
        if r["name"]:
            added.append(r)
    return kept, added


def as_last_matched(rows, last_regcess, community):
    """A centres list from the last run against a fresh REGCESS: the REGCESS centres its matching took then (absent
    from the last run's file) stay taken, and its rows are kept as they were. Matching the rows again doesn't work:
    the file lacks what the match used (Valencia's rows have no town name, only the INE code the fetch had), and
    Madrid's rows hold the name of the centre they took. A centre new in REGCESS waits for the list to answer."""
    return [g for g in rows if g["source"] != "es-regcess" or g.get("_community") != community
            or g["kind"] not in ("hospital", "clinic") or g["code"] in last_regcess]


def with_last_names(got, old_rows):
    """Fresh regional centres when REGCESS is the last run's: what the matching would have filled in comes from the
    same centre's row in the last run (by code); Madrid's codes the last run didn't place stay out."""
    old = {}
    for o in old_rows:
        old.setdefault(re.sub(r"#\d+$", "", o["code"]), o)
    out = []
    for r in got:
        o = old.get(r["code"])
        if r.get("_override"):
            if not o:
                continue
            r = {**r, "name": o["name"], "phone": o["phone"], "address": o["address"], "municipality": o["municipality"]}
        elif o:
            r = {**r, "phone": r["phone"] or o["phone"], "name": r["name"] or o["name"]}
        if r["name"]:
            out.append(r)
    return out


# --- Main -------------------------------------------------------------------------------------

def read_tsv(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE):
            r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
            rows.append(r)
    return rows


def clean(v):
    return str(v or "").replace("\t", " ").replace("\n", " ").replace("\r", " ").strip()


def unique_codes(rows):
    seen, out = {}, []
    for r in rows:
        n = seen.get(r["code"], 0)
        seen[r["code"]] = n + 1
        if n:
            r = {**r, "code": f"{r['code']}#{n}"}
        out.append(r)
    return out


def main(argv):
    out_path = argv[0]
    opt = lambda name: argv[argv.index(name) + 1] if name in argv else None  # noqa: E731
    previous = read_tsv(opt("--previous")) if opt("--previous") else []
    only = argv[argv.index("--only") + 1:] if "--only" in argv else list(SOURCES)
    limit = int(opt("--limit")) if opt("--limit") else None
    geocoder = Geocoder(opt("--geocache"))
    before = {}
    for r in previous:
        before.setdefault(r["source"], []).append(r)
    rows, report, failed = [], {}, []

    def take(sid, got, extra=None):
        old = before.get(sid, [])
        if old and len(got) < MIN_SHARE * len(old):
            raise RuntimeError(f"{len(got)} rows, last month {len(old)}")
        if not got:
            raise RuntimeError("no rows")
        rows.extend(got)
        report[sid] = {"rows": len(got), "status": "fresh", **(extra or {})}

    def keep(sid, e):
        failed.append(sid)
        rows.extend(before.get(sid, []))
        report[sid] = {"rows": len(before.get(sid, [])), "status": f"kept last month's: {e}"[:300]}
        print(f"[{sid}] FAILED ({e}); keeping {len(before.get(sid, []))} rows from last month", file=sys.stderr)

    covered, with_botiquines = set(), set()
    for sid, (community, botiquines) in REGIONAL.items():
        if sid not in only:
            got = before.get(sid, [])
            rows.extend(got)
        else:
            try:
                fetched = SOURCES[sid]["fetch"]()
                got = []
                for r in fetched:
                    p = place(num(r["lat"]), num(r["lon"]), community)
                    if p and r["code"]:
                        r["lat"], r["lon"] = p
                        got.append(r)
                got = unique_codes(got)
                take(sid, got, {"dropped": len(fetched) - len(got)})
                print(f"[{sid}] {len(got)} rows ({len(fetched) - len(got)} without usable coordinates)", file=sys.stderr)
            except Exception as e:  # noqa: BLE001
                keep(sid, e)
                got = before.get(sid, [])
        if got:
            covered.add(community)
            if botiquines:
                with_botiquines.add(community)
    if "es-regcess" in only:
        try:
            known, counts = {}, {}
            for sid, (cc, _) in REGIONAL.items():
                if cc in CODE_FIELD and cc in covered:
                    known.setdefault(cc, set()).update(code_key(r["code"]) for r in rows if r["source"] == sid)
                if cc in BY_COUNT and cc in covered:
                    for r in rows:
                        if r["source"] == sid and r["kind"] == "pharmacy":
                            counts.setdefault(cc, {})[town_key(r["municipality"])] = counts.get(cc, {}).get(town_key(r["municipality"]), 0) + 1
            got, missed, asked = regcess_points(geocoder, covered, with_botiquines, known, counts, limit)
            gaps = {}
            for cc in [*known, *counts]:
                regional = [r for r in rows if r["source"] in REGIONAL and REGIONAL[r["source"]][0] == cc]
                theirs = [r for r in got if r["_community"] == cc and r["_gap"]]
                if cc in counts:
                    extra = by_count(regional, theirs, counts[cc])
                else:
                    extra = missing_from(regional, theirs)
                got = [r for r in got if not (r["_community"] == cc and r["_gap"])] + extra
                gaps[COMMUNITIES[cc][0]] = len(extra)
            print(f"[es-regcess] pharmacies and botiquines the regional lists lack, added: {gaps}", file=sys.stderr)
            take("es-regcess", unique_codes(got), {"notPlaced": missed, "jobs": asked, "regionalGaps": gaps})
        except Exception as e:  # noqa: BLE001
            keep("es-regcess", e)
    else:
        rows.extend(before.get("es-regcess", []))
    replaced = {}
    # REGCESS rows from the last run (not asked, or it didn't answer) are what its matching left: matching them again
    # against the same centres lost distinct centres (2026-11-13: Ruber Juan Bravo to San Camilo next door, Madrid's
    # SAMUR bases to a centre named "Ayuntamiento", a Teruel consultorio to a Valencian one 3 km off). Then a centres
    # list from the last run is kept as it was, and a fresh one replaces its last rows by code without matching; with
    # a fresh REGCESS, a list from the last run keeps what it took then (as_last_matched).
    regcess_fresh = report.get("es-regcess", {}).get("status") == "fresh"
    last_regcess = {r["code"] for r in before.get("es-regcess", [])}
    for r in rows:  # a REGCESS code starts with its community's INE code (1328…: Madrid)
        if r["source"] == "es-regcess" and "_community" not in r:
            r["_community"] = r["code"][:2]
    for sid, (community, fetch) in CENTRES.items():
        try:
            if sid not in only:
                raise RuntimeError("not asked")
            fetched = fetch()
            got = []
            for r in fetched:
                p = place(num(r["lat"]), num(r["lon"]), community)
                if p:
                    r["lat"], r["lon"] = p
                    if not r["code"]:
                        r["code"] = re.sub(r"\W+", "-", folded(f"{r['name']} {r['municipality']}")).strip("-")
                    got.append(r)
            got = one_spot_per_kind(sorted(got, key=lambda r: r["kind"] != "hospital"))
            old = before.get(sid, [])
            if old and len(got) < MIN_SHARE * len(old):
                raise RuntimeError(f"{len(got)} rows, last month {len(old)}")
            if not got:
                raise RuntimeError("no rows")
            fresh = True
        except Exception as e:  # noqa: BLE001
            got, fresh = [dict(r) for r in before.get(sid, [])], False
            if str(e) != "not asked":
                failed.append(sid)
                print(f"[{sid}] FAILED ({e}); keeping {len(got)} rows from last month", file=sys.stderr)
        if not got:
            continue
        n_before = len(rows)
        if regcess_fresh and fresh:
            rows[:], added = replace_centres(rows, got, community)
        elif regcess_fresh and last_regcess:
            rows[:], added = as_last_matched(rows, last_regcess, community), got
        elif regcess_fresh:  # no REGCESS in the last run's file to tell what was taken: match as best it can
            rows[:], added = replace_centres(rows, got, community)
        else:
            added = with_last_names(got, before.get(sid, [])) if fresh else got
        rows.extend(unique_codes(added))
        replaced[sid] = n_before - (len(rows) - len(added))
        report[sid] = {"rows": len(added), "status": "fresh" if fresh else "kept last month's", "replacedRegcess": replaced[sid]}
        print(f"[{sid}] {len(added)} centres, {replaced[sid]} REGCESS centres replaced", file=sys.stderr)
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
        json.dump({"rows": len(rows), "kinds": kinds, "geocoderRequests": geocoder.asked, "sources": report,
                   "meta": {k: {x: v[x] for x in ("name", "publisher", "licence", "url")} for k, v in SOURCES.items()}},
                  f, indent=1, ensure_ascii=False)
    print(f"{len(rows)} rows {kinds}; geocoder requests {geocoder.asked}; failed: {' '.join(failed) or 'none'}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
