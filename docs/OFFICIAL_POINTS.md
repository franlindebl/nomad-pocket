# Official points: completing OSM with official registers

OpenStreetMap is the source of every emergency point (`src/features/maps/emergency-core.ts`), and it has holes
exactly where they hurt: in villages. A tester near El Real de San Vicente (Toledo) found most of the area's
pharmacies missing (2026-11-10). Measured against the Junta's register, OSM lacked **433 of Castilla-La
Mancha's 1,276 pharmacies** (no OSM pharmacy within 500 m), 234 of them in places under 2,000 people, and 12
of the 15 in the Sierra de San Vicente. So each month the official registers fill in what OSM lacks.

Goal (owner, 2026-11-11): **do the same review for every country**, one by one: find its official open
registers of pharmacies, hospitals and health centres, measure OSM against them, and add the missing ones.
Spain first (done, below); the others are in the backlog of `docs/PROGRESS.md`, and what each country publishes
(sources, licences, OSM gaps, suggested order) is in `docs/OFFICIAL_POINTS_WORLD.md` (research of 2026-11-12).

## How it works

1. **Fetch** (`.github/workflows/official-points.yml`, monthly on the 3rd, one job per country): each
   `scripts/official/<cc>.py` reads its country's registers and writes `<cc>.official.tsv` (source, code, kind, lat,
   lon, name, holder, phone, address, municipality, precision) into the `official-points` release, with
   `<cc>.official.report.json` (rows per source, what failed) and, where it geocodes, `<cc>.geocache.tsv`
   (geocoder answers, so a month only asks for new addresses). A source that doesn't answer, or answers with under
   80% of last month's rows, keeps last month's rows. A new country is a new script: the workflow picks up every
   two-letter `scripts/official/??.py`, and the merge and the app need nothing.
2. **Merge** (country packs, monthly on the 5th): `scripts/routing/build-country.sh` step 6a downloads
   `<country>.official.tsv` (`OFFICIAL_CACHE`) and `scripts/official/merge.py` appends to `<pack>.pois.tsv` the
   official points with no OSM point of their group nearby (rows of type `official`, id `<source>:<code>`).
   Each OSM point absorbs one official point at most (hospitals excepted), a shared name first, then the nearest
   (name words: Latin and Cyrillic words minus generic ones; Japanese names, which have no spaces, cut at their
   generic words, so つがやす薬局東２条店 and OSM's つがやす薬局 東2条店 share つがやす and 東2条):

   | Group | Official kinds | Same point when within | or, sharing a name word, within |
   |---|---|---|---|
   | pharmacy | pharmacy, botiquin | 200 m (regions require 250 m between pharmacies) | 400 m |
   | hospital | hospital | 300 m (a campus: OSM's centre vs the register's door); one OSM hospital takes all the register's hospitals of its campus | 1,500 m |
   | clinic | clinic (health centre, consultorio) | 150 m (a village's, often unnamed in OSM) | 500 m |

3. **App**: `parseOverpassTsv` reads `official` rows as `o<source>:<code>` ids; they are ordinary points
   (map layer, Emergencias, search, the assistant's map answers). App versions before this skip the type,
   so an old app just doesn't show them. Nothing new is contacted by the app: the points come in the pack.

## Spain in numbers (2026-11-11, on the published `es.pois.tsv` of 2026-11-03)

| | Official | Already in OSM | Added |
|---|---|---|---|
| Pharmacies and botiquines | 22,700 | 15,945 | **6,755** |
| Hospitals | 615 | 482 | **133** |
| Health centres and consultorios | 12,398 | 4,642 | **7,756** |

Pharmacies added by region: Aragón 56%, La Rioja 58%, Castilla-La Mancha 49%, Navarra 44%, the REGCESS regions
41%, Baleares 28%, Asturias 24% (its own list then; REGCESS since), Andalucía 23%, Madrid 18%, Cataluña 11%, País Vasco 5%. REGCESS placed 21,210 of
22,483 addresses (613 pharmacies, 35 botiquines, 6 hospitals and 619 centres not placed).

## Spain's sources (2026-11)

Pharmacies come from the region's own register where it publishes one with coordinates under an open licence;
the rest (and the botiquines a regional list leaves out) from the Ministry of Health's **REGCESS** monthly
listing, which has every pharmacy (22,389) and botiquín (915) of Spain with its address but no coordinates.
REGCESS also gives hospitals (C11 general, C12 specialised), health centres (C231) and primary-care
consultorios (C232) for every region. REGCESS addresses are placed with **CartoCiudad** (IGN's geocoder),
keeping only a candidate in the register's municipality (INE code): a centre's name as a place first, then the
street and number, then the bare street; a village's only pharmacy, or a botiquín, falls back to the village.
Measured on 300 Castilla-La Mancha pharmacies against the Junta's coordinates: 94% placed, at the door for
88% (median 14 m, 90% within 211 m).

| Region | Source | Licence | Notes |
|---|---|---|---|
| Andalucía | DERA 12_04 Farmacia (IECA, from the Consejería's register), WFS | CC BY 4.0 | 3,874; layer of 2023-07 but its codes match REGCESS 3,872/3,874; botiquines from REGCESS |
| Aragón | IDEAragon `t206_farmacias_y_botiquines`, WFS | CC BY 4.0 (aragon.es) | 716 + 310 botiquines; no phones; update date not stated |
| Illes Balears | IDEIB `GOIB_SUPE_IB/MapServer/1` | CC BY (CAIB catalogue) | 464 + 3; rows with `VALID_FINSA` (closed) dropped |
| Castilla-La Mancha | Junta's `Farmacias_de_CastillaLa_Mancha` FeatureServer | CC BY 4.0 (portal) | 1,276; the dataset itself states no licence; botiquines from REGCESS |
| Cataluña | Establiments sanitaris autoritzats (Socrata `nrmq-ytje`) | Llicència oberta d'ús d'informació – Catalunya | 3,289 + 108 farmacioles; weekly |
| Madrid | Oficinas de farmacia (datos.comunidad.madrid) | CC BY 4.0 | 2,953; UTM 30 ETRS89 (unstated, checked); no botiquines exist |
| Navarra | Farmacias abiertas al público (daily) joined with IDENA's 2021 layer by code | CC BY 4.0 | 556; the ~30 opened since 2021 come from REGCESS (`PARTIAL`: added when no listed pharmacy is within 200 m, nor one sharing the holder's name within 1.5 km) |
| País Vasco | Farmacias y botiquines de Euskadi (Open Data Euskadi) | CC BY 4.0 | 843 + 25; botiquines from the XLSX (the GeoJSON's points are broken) |
| La Rioja | Registro de centros, servicios y establecimientos sanitarios | CC BY | 151 (E1 rows); 7 with bad coordinates (fixed or dropped) |
| Asturias, Canarias, Cantabria, Castilla y León, C. Valenciana, Extremadura, Galicia, Murcia, Ceuta, Melilla | REGCESS + CartoCiudad | Ley 37/2007 reuse with attribution (sanidad.gob.es) | Valencia, Murcia, Canarias, Ceuta, Melilla publish no open list; CyL and Extremadura publish addresses only; Asturias's layer (SITPA-IDEAS, 2023) doesn't answer GitHub's runners (connection timeout, 2026-11-11) |

Left out on purpose: **Galicia**'s Sergas list (coordinates, daily) is CC BY-SA 4.0 and **Cantabria**'s
(coordinates) is non-commercial: neither fits a file mixed with OSM's ODbL data, so both come from REGCESS.
Murcia's tourism listing (316 of ~570, mixed coordinate systems, 2021), Tenerife's and La Palma's island
lists and the colegios de farmacéuticos' finders (not open data) are not used.

Attribution: Settings › Credits (`official-health-points-es` in `scripts/licenses/native.json`) and the
routing release notes.

## Other countries (2026-11-12)

Chosen from `docs/OFFICIAL_POINTS_WORLD.md`. Before a country goes in, its register is measured against the app's
OSM points (the published `<cc>.pois.tsv`): where both have a pharmacy, the two points should be a few metres apart
(Castilla-La Mancha: 85% within 50 m). A register whose points don't pass that adds misplaced duplicates and stays
out. Each has its Credits entry (`official-health-points-<cc>` in `scripts/licenses/native.json`). Numbers on the
packs of 2026-11-05:

| Country | Script, source | Licence | Already in OSM, median distance | Added |
|---|---|---|---|---|
| Japan | `jp.py`: MHLW 医療情報ネット open data (pharmacies, hospitals, clinics; twice a year) | PDL 1.0 (≈ CC BY 4.0; say it was processed) | 18,425 pharmacies, 9 m | **41,988 pharmacies, 1,187 hospitals, 36,679 clinics** |
| France | `fr.py`: FINESS - Structures, monthly (ANS) | Licence Ouverte 2.0 | 16,530 pharmacies | **1,996 pharmacies, 331 hospitals, 3,871 centres** |
| Czechia | `cz.py`: NRPZS places of provision, monthly (ÚZIS) | CC BY 4.0 | 2,231 pharmacies, 9 m | **242 pharmacies, 15 hospitals, 3,876 GP practices** |
| Ukraine | `ua.py`: NSZU reimbursement pharmacies and primary-care divisions, weekly | CC BY 4.0 | 8,676 pharmacies, 21 m | **8,183 pharmacies, 10,778 primary-care points** (1,600 ФАП) |
| Chile | `cl.py`: MINSAL/DEIS establecimientos de salud, weekly | CC0 | 1,957 centres, 11 m | **61 hospitals, 593 centres** (CESFAM, postas rurales, SAPU/SAR/SUR) |
| Peru | `pe.py`: SUSALUD RENIPRESS, monthly | ODC-By | 7,254 centres, 7 m | **263 hospitals, 3,535 centres** (puestos de salud, centros, policlínicos) |
| Uruguay | `uy.py`: ASSE care units, monthly | Licencia de Datos Abiertos de Uruguay | 111 centres, 22 m | **7 hospitals, 752 polyclinics** |
| Ethiopia | `et.py`: Ministry of Health's MFR on HDX (3iS), snapshot of 2025-02 | CC BY | 283 pharmacies; hospitals sharing a name 85 m | **8,658 pharmacies, 312 hospitals, 28,218 centres, posts and clinics** |

- **Japan.** Clinics are the register's 診療所 offering internal medicine, paediatrics, surgery, general practice or
  emergency care (51k of 80k: no eye, skin or cosmetic practices). 12% of the pharmacies and 6% of the clinics
  report no coordinates: placed with GSI's address search (国土地理院), keeping an answer down to the block or house
  number whose numbers begin the address's (measured on 200 pharmacies with coordinates: 79% placed, median 24 m,
  90% within 190 m); 86% placed. Hospitals: OSM tags many clinics as hospitals (10,399 against the register's
  7,672), so few are added. Facility ids are stable between publications (58,973 of 60,354 kept).
- **France.** Pharmacies (620), hospitals (101 CHR/CHU, 355 CH, 106 ex-hôpital local, 365 private multi-specialty),
  centres de santé (124), maisons de santé (603) and walk-in care (617). ~20% of the establishments have no BAN
  point: placed with the Géoplateforme geocoder in their commune (house number, else street); 1,404 not placed.
  Metropolitan France only.
- **Czechia.** Pharmacies (510), hospitals (101-103), GPs for adults and children (320, 321), polyclinics (301, 302)
  and health centres (310); a building's several doctors (points of a kind within 15 m) are one point. Points are the
  address register's (RÚIAN). The register also lists ambulance stations (481), not a kind the merge adds yet.
- **Ukraine.** Only pharmacies contracted for reimbursed medicines (most, not all); hospitals aren't listed.
  Points are entered by the providers: those with under four decimals, or stacked three or more on one spot (a
  town's centre standing in for several), are left out. Cities have a pharmacy every few doors, so an added one is
  often within 300 m of an OSM one (half of them).
- **Chile, Peru, Uruguay.** Public primary care and hospitals; private doctors' offices, labs, dental and specialist
  centres left out. A post named after its village alone gets its kind in front ("Puesto de Salud La Novia").
  Pharmacies: Chile's Farmanet service answers automated clients with 403, Peru's DIGEMID has no bulk download,
  Uruguay's list has none. Peru's portal answers 418 to a User-Agent carrying a URL; a quarter of its active
  establishments have no coordinates (left out).
- **Ethiopia.** OSM has almost nothing (300 pharmacies, 424 clinics). The registry needs a login; the HDX copy
  (MoH as source, uploaded by 3iS) is a snapshot of 2025-02, so the monthly run reads the same file until a new one
  is published. Points stacked three or more on a spot (a woreda's centre) are left out.
- **Italy (not added).** The Ministry's daily pharmacy register (IODL 2.0, 20,777 open) has coordinates for 91%, but
  they fail the test: only 17% are within 50 m of an OSM pharmacy (median 377 m), and 6,680 share their exact point
  with another pharmacy (Turin's Piazza Vittorio Veneto 10 sits 9 km out of town). It needs the addresses placed
  first, e.g. with ANNCSU, the Agenzia delle Entrate's open register of house numbers.

## Improvements not built yet

- Cross-check every regional list against REGCESS the way Navarra's is (`PARTIAL` in `es.py`): ~15k more
  addresses to place once, then cached.
- Regional coordinates for health centres where a region publishes them (Castilla-La Mancha's "Centros de
  salud", La Rioja's register has them for every centre) instead of geocoding REGCESS.
- Opening hours: only Cantabria (sparse), Euskadi's botiquines and La Palma publish them.
- A "source: official register" line on the place card (the id prefix already tells).
