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
   (name words: Latin and Cyrillic words minus generic ones, "farmacia", "pharmacy", "clinique", "health"…, so two
   pharmacies 300 m apart aren't one because both say "pharmacy"; Japanese names, which have no spaces, cut at their
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
| Canada | `ca.py`: Ontario's MOHSERLO (ArcGIS) and HealthLink BC's pharmacies, hospitals, walk-in clinics | OGL-Ontario, OGL-BC | 3,426 pharmacies, 22 m | **2,903 pharmacies, 16 hospitals, 429 clinics** (Ontario and BC only) |
| Australia | `au.py`: National Health Services Directory via Geoscience Australia, snapshot of 2025-03 | CC BY 4.0 (+ G-NAF) | 2,811 pharmacies, 25 m | **2,602 pharmacies, 35 hospitals, 4,095 practices** |
| United Kingdom | `gb.py`: NHS ODS (ORD API) placed on Code-Point Open postcodes | OGL v3 | 7,569 pharmacies, 33 m | **3,567 pharmacies, 1,958 GP practices** (Great Britain) |
| United States | `us.py`: HRSA health center sites, daily, split by pack | public domain | 2,597 centres, 15 m | **7,599 community health centres** (west 2,243, south 2,862, midwest 1,411, northeast 1,083; plus AK, HI, PR…) |
| Latvia | `lv.py`: ZVA pharmacy register; VKCP IĢIS medical institutions (2024) | CC0 | 636 pharmacies, 16 m | **176 pharmacies, 3 hospitals, 184 family doctors' practices** |
| Iceland | `is.py`: Heilsuvera WFS (Directorate of Health) | CC BY 4.0 | 44 centres, 11 m | **31 health centres** (OSM has 57 clinics) |
| Dominican Republic | `do.py`: SNS establecimientos de salud | ODbL | 141 hospitals, 25 m | **50 hospitals, 1,525 health centres and consultorios** (OSM: 540 clinics on the island) |
| Malawi | `mw.py`: Malawi Health Facility Registry on HDX (2023) | CC BY | 53 hospitals, 78 m | **44 hospitals, 1,068 health centres, dispensaries and posts** (OSM has 88 clinics) |
| New Caledonia | `nc.py`: DASS, situation des structures de santé | Licence Ouverte 2.0 | 52 pharmacies, 23 m | **12 pharmacies, 27 dispensaries** |
| Mexico | `mx.py`: CLUES (DGIS), monthly, public institutions only | free use (DGIS) | 1,000 hospitals, 36 m; 349 centres, 11 m | **431 hospitals, 9,375 centros de salud, UMF and rural units** |
| Argentina | `ar.py`: IGN's "Edificio de salud" layer (WFS; mostly the Ministry's SISA register) | IGN terms (attribution, shared freely) | 968 hospitals, 20 m; 1,959 centres, 14 m | **91 hospitals, 4,713 centres, posts and dispensaries** |

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
- **Canada.** Only Ontario and British Columbia publish such lists with points (the other provinces: nothing open
  found yet). Ontario: retail pharmacies, hospitals (a corporation and its sites, one point when within 15 m),
  community health centres, family health teams, nurse practitioner-led and Indigenous primary-care clinics; labs,
  long-term care and support services left out. BC: HealthLink BC's pharmacies, hospitals and walk-in clinics (its
  urgent and primary care centres list is "access only", not open).
- **Australia.** The layers are Geoscience Australia's copy of Healthdirect's directory (a snapshot, March 2025);
  Healthdirect's own terms allow non-commercial reuse, which this free app is, and GA publishes the copy under CC BY
  4.0. Its terms also say not to rely on it to find a service in an emergency: the Credits entry says so. Hospital
  pharmacies, outpatient, maternal-child and cancer services left out; a practice's several services are one point.
- **United Kingdom.** ODS gives postcodes, not points: each is placed on its postcode's Code-Point Open point
  (a postcode is about fifteen addresses; median 33 m from OSM's pharmacy), postcodes placed only on their sector
  left out. GP practices sharing a postcode (a health centre's) are one point. Northern Ireland is left out
  (Code-Point has no BT postcodes); hospitals too (ODS's trust sites mix wards, offices and clinics). The ORD API
  refuses `Offset=0` (406).
- **United States.** HRSA's health centres treat anyone whatever they can pay. Permanent sites only: school-based,
  seasonal, mobile, administrative, prison and nursing-home sites, and those whose name says dentistry, behavioural
  health, WIC, pharmacy or eyes only, are left out (10.6k of 19.6k). `us.py` writes `us.official.tsv` and one
  `<pack>.official.tsv` per US pack (Geofabrik's regions by state, Alaska, Hawaii, the territories), which the
  workflow uploads too. No federal list of pharmacies or hospitals with points: CMS's hospitals are addresses only
  and refuse custom User-Agents; NPPES (pharmacies) is 1 GB of addresses.
- **Latvia.** Pharmacies: general pharmacies and branches with an active, unsuspended licence. Hospitals and GP
  practices come from a 2024 address list that isn't updated (some practices will have moved); GPs are listed by
  their doctor's practice ("Ģimenes ārsts: … ĢĀP"), so their names rarely match OSM's polyclinics.
- **Iceland.** Health centres, Læknavaktin and the emergency departments; care homes left out. No pharmacies in the
  layer. The WFS ids change every refresh: the code is a slug of name and postcode.
- **Dominican Republic.** The pack is Haiti and the Dominican Republic together; only Dominican points. The CSV has no
  ids: the code is a slug of name and point. Diagnostic centres and points stacked three or more on a spot left out.
  Clinics can hardly be checked against OSM (it has few); the hospitals place the points well.
- **Malawi.** Coordinates typed by hand (stray spaces removed, fewer than three decimals dropped): the weakest of the
  accepted (hospitals 78 m from OSM's at the median), taken because OSM has almost nothing there. Its status flag says
  "Non-functional" for 3 in 4 facilities, plainly stale, so only "Closed" rows go.
- **New Caledonia.** The 195 liberal cabinets (each named after a doctor, often at home) left out for privacy, as
  are specialists, dentists, labs and propharmacies. Declarative data: professionals update it themselves.
- **Argentina.** Not the source the research named: REFES and REFAR (the Ministry's registers on datos.gob.ar, 39k
  facilities, 15k pharmacies, Dec 2024) have addresses only and declare "No se especificó la licencia", and the
  government's Georef geocoder (CC BY 4.0, bulk 1,000 per call) placed only ~30% at the door, a sixth of those over
  500 m from their OSM twin; `datos.salud.gob.ar` also serves its certificate without the intermediate. The IGN's layer
  has points on the building, no address, phone or date. IGN's terms: credit "FUENTE: Instituto Geográfico Nacional
  de la República Argentina", reuse may copy, modify and combine, the data must be shared freely, commercial use
  only in derived works. So Argentina has hospitals and centres but no pharmacies (would need REFAR licensed).
- **Mexico.** CLUES's file host doesn't answer the office network, so `mx.py` was written from the catalogue's known
  layout, run first in CI (its report lists the file's 68 columns) and measured from the release: public hospitals
  43% within 50 m of OSM's, private ones 12% (median 755 m), so the 3,562 private "hospitals" (many day-surgery
  clinics under a company's name) are left out, with labs, dental and support units and points typed to two decimals.
  OSM has few clinics there (6.5k), so the 9.4k centres can hardly be checked; those that match are 11 m away.
- **Taiwan (not yet).** The NHI's contracted facilities (OGDL, 7.6k pharmacies against OSM's 2.3k) have addresses
  only; it waits for a Taiwanese geocoder (NLSC/TGOS) checked the way CartoCiudad was.
- **Nigeria (not added).** GRID3 NGA v4.0 (CIESIN with the federal registry and NPHCDA, CC BY 4.0) has 48k usable
  hospitals and primary-care points where OSM has 1.5k clinics, but calls itself "non-validated", and it shows:
  of 264 general and specialist hospitals that share a name with an OSM hospital, a quarter are over 2 km away
  (median 123 m). Worth another look with only its field-surveyed points, or a later release.
- **Italy (not added).** The Ministry's daily pharmacy register (IODL 2.0, 20,777 open) has coordinates for 91%, but
  they fail the test: only 17% are within 50 m of an OSM pharmacy (median 377 m), and 6,680 share their exact point
  with another pharmacy (Turin's Piazza Vittorio Veneto 10 sits 9 km out of town). It needs the addresses placed
  first, e.g. with ANNCSU, the Agenzia delle Entrate's open register of house numbers.

## Coverage by country (keep this up to date)

The one place to see which countries have official points, where each one's come from, and why the others don't.
Numbers, filters and quality per country are in "Other countries" above; what every country publishes is in
`docs/OFFICIAL_POINTS_WORLD.md`. Every covered country has its script `scripts/official/<cc>.py`, its Credits entry
(`official-health-points-<cc>` in `scripts/licenses/native.json`) and a line in the routing release notes
(`.github/workflows/country-packages.yml`). "In packs since" is the first pack build with them.

### Covered

| Country (pack) | Adds | Source: publisher, dataset | Licence | Refresh | In packs since |
|---|---|---|---|---|---|
| Spain (`es`) | pharmacies, botiquines, hospitals, health centres, consultorios | the regions' pharmacy registers and the Ministry of Health's REGCESS, addresses placed with CartoCiudad (IGN) | per region (table above); REGCESS: Ley 37/2007 reuse with attribution | monthly | 2026-11-11 |
| Japan (`jp`) | pharmacies, hospitals, primary-care clinics | 厚生労働省 (MHLW) 医療情報ネット open data; addresses without a point placed with GSI's address search | PDL 1.0 | twice a year | 2026-11-12 |
| France (`fr`) | pharmacies, hospitals, centres and maisons de santé, walk-in care | Ministère de la Santé / ANS, FINESS - Structures; the rest placed with the Géoplateforme (BAN) | Licence Ouverte 2.0 | monthly | 2026-11-12 |
| Czechia (`cz`) | pharmacies, hospitals, GPs, polyclinics | ÚZIS, NRPZS places of provision (NR-01-06) | CC BY 4.0 | monthly | 2026-11-12 |
| Ukraine (`ua`) | reimbursement pharmacies, primary-care divisions (ФАП) | NSZU (НСЗУ) on data.gov.ua | CC BY 4.0 | weekly | 2026-11-12 |
| Chile (`cl`) | hospitals, public primary care | MINSAL / DEIS, establecimientos de salud vigentes | CC0 | weekly | 2026-11-12 |
| Peru (`pe`) | hospitals, health centres and posts | SUSALUD, RENIPRESS | ODC-By | monthly | 2026-11-12 |
| Uruguay (`uy`) | hospitals, polyclinics | ASSE, unidades asistenciales | Licencia de Datos Abiertos de Uruguay | monthly | 2026-11-12 |
| Ethiopia (`et`) | pharmacies, hospitals, health centres and posts, clinics | Ministry of Health's Master Facility Registry, via 3iS on HDX | CC BY | snapshot 2025-02 | 2026-11-12 |
| Canada (`ca`), Ontario and BC only | pharmacies, hospitals, primary care | Ontario Ministry of Health, MOHSERLO (Land Information Ontario); BC Ministry of Health, HealthLink BC directory | OGL-Ontario, OGL-BC | monthly | 2026-11-12 (run 43235609769) |
| Australia (`au`) | pharmacies, hospitals, general practices | Healthdirect's National Health Services Directory, via Geoscience Australia | CC BY 4.0 (+ G-NAF) | snapshot 2025-03 | 2026-11-12 (run 43235609769) |
| United Kingdom (`gb`), Great Britain | pharmacies, GP practices | NHS England, Organisation Data Service (ORD API), placed on Ordnance Survey's Code-Point Open | OGL v3 | monthly | 2026-11-12 (run 43235609769) |
| United States (`us-west`, `us-midwest`, `us-northeast`, `us-south`, `us-alaska`, `us-hawaii`), Puerto Rico (`pr`), US Virgin Islands (`vi`), Guam (`gu`), American Samoa (`as`), Northern Mariana Islands (`mp`) | community health centres | HRSA (HHS), Health Center Service Delivery and Look-Alike Sites | public domain | monthly | 2026-11-12 (run 43235609769) |

### Built, waiting for their first CI run and packs

| Country (pack) | Adds | Source: publisher, dataset | Licence | Refresh |
|---|---|---|---|---|
| Latvia (`lv`) | pharmacies; hospitals and family doctors' practices | ZVA (State Agency of Medicines), FDU register; IeM Informācijas centrs, VKCP IĢIS medical institutions' addresses (2024 snapshot) | CC0 | monthly; snapshot |
| Iceland (`is`) | health centres, the walk-in clinic, emergency departments | Embætti landlæknis (Directorate of Health), Heilsuvera WFS | CC BY 4.0 | daily |
| Dominican Republic (`do`, with Haiti) | public hospitals, health centres, consultorios | Servicio Nacional de Salud, Establecimientos de Salud del SNS (datos.gob.do) | ODbL | when the SNS updates it |
| Malawi (`mw`) | hospitals, health centres, dispensaries, posts | Ministry of Health and Population, Malawi Health Facility Registry, via the Health Cluster on HDX | CC BY | snapshot 2023 |
| New Caledonia (`nc`) | pharmacies, hospitals, dispensaries | Gouvernement de la Nouvelle-Calédonie, DASS, Situation des structures de santé (data.gouv.nc) | Licence Ouverte 2.0 | when DASS updates it |
| Argentina (`ar`) | hospitals, public health centres, posts (no pharmacies) | Instituto Geográfico Nacional, "Edificio de salud" WFS layer (from the Ministry of Health's SISA) | IGN terms: attribution, shared freely | unstated ("periodically") |
| Mexico (`mx`) | public hospitals, public primary care | Secretaría de Salud, DGIS, CLUES | free use ("no existen restricciones") | monthly |

### Not covered, and why

| Country | Why not | What would unblock it |
|---|---|---|
| Taiwan | The NHI's register of contracted facilities (data.gov.tw 168341, OGDL v1.0, 7,656 pharmacies, ~450 hospitals, ~11k clinics) has no coordinates, and the government geocoders need registration: TGOS asks for an APPID and key, NLSC's house-number service is for government bodies only (2026-11-12) | The owner registers a TGOS app key (a GitHub secret), checking its terms allow batch use and keeping results |
| Brazil | CNES (DATASUS) has coordinates for ~512k establishments, but the portal says CC BY-ND, which can't be mixed with OSM | DATASUS confirms an open licence (an email) |
| Colombia, Mauritius | Registers under CC BY-SA, which can't share a file with ODbL data | A CC BY / ODbL licence from the publisher |
| Belgium | AFMPS's pharmacy list states no licence | AFMPS states one |
| New Zealand | Medsafe's pharmacy list is non-commercial with no redistribution | Medsafe licenses it CC BY |
| Estonia | Ravimiamet's pharmacy map (apteegid.json) states no licence (only the register it comes from is CC0 on andmed.eesti.ee) and adds 28 pharmacies; the health-centre lists are CC BY-NC-SA and CC BY-SA. Script parked, not in the repo | An explicit licence for the map file; health centres under an open licence |
| Bahrain | data.gov.bh's clinics and hospitals: points sit 50–100 m from OSM's with no close peak, few to add, and the Bahrain Open Government Data License v1.1 binds sub-licensees to its terms (3.3d) and lets the government demand removal (3.3e). Script parked | A plain open licence, and better points |
| Italy | The Ministry's pharmacy register (IODL 2.0) has points, but they fail against OSM (median 377 m, thousands stacked) | Its addresses placed with ANNCSU |
| Nigeria | GRID3 NGA v4.0 (CC BY 4.0) is "non-validated": a quarter of same-named hospitals over 2 km from OSM's | Only field-surveyed points, or a later release |
| Ireland | No open list with coordinates: HSE's GP sites and health centres datasets were removed from data.gov.ie; the PSI pharmacy register is addresses only and Eircode has no open geocoder | HSE republishes its lists with coordinates |
| Greece | Only some regions' and municipalities' layers (Crete, Athens, Thessaloniki…) with no licence; national lists are free-text addresses | A national layer with a licence |
| Romania | CNAS and ANMCS lists have names and counties only; no open geocoder | Lists with addresses or points |
| Morocco | data.gov.ma's hospitals (2025) and primary-care centres (2024), ODbL, are located by commune only; no pharmacy list | Lists with addresses or points |
| Norway | No official list with points; the business register (NLOD) geocoded with Geonorge works, but OSM already has more pharmacies than DMP counts and no health-centre or legevakt list exists | Helsedirektoratet publishes legevakt / fastlege locations |
| Argentina, pharmacies | REFAR (15k pharmacies) has addresses only and no licence; Georef placed too few well (see above) | A licence for REFAR and a better geocoding match, or a pharmacy list with points |
| DR Congo, Haiti | Only GRID3 (as Nigeria's) and a PAHO/WHO list via OCHA, of doubtful quality | Validated releases |
| Germany, Austria, Switzerland, Netherlands, Luxembourg, Monaco, Andorra, Denmark, Sweden, Finland, Portugal, Poland | Not worth it: OSM is near the official totals, or only cities publish | — |
| ~135 others | No official open source found: most of the Caribbean, Central America, Central Asia and the Caucasus, South-East Asia, the Pacific, West Africa, Russia and Belarus, China, the western Balkans (`docs/OFFICIAL_POINTS_WORLD.md`) | A source turning up; a fallback could be the CC0 Maina 2019 compilation for sub-Saharan Africa (stale) |

## Improvements not built yet

- Cross-check every regional list against REGCESS the way Navarra's is (`PARTIAL` in `es.py`): ~15k more
  addresses to place once, then cached.
- Regional coordinates for health centres where a region publishes them (Castilla-La Mancha's "Centros de
  salud", La Rioja's register has them for every centre) instead of geocoding REGCESS.
- Opening hours: only Cantabria (sparse), Euskadi's botiquines and La Palma publish them.
- A "source: official register" line on the place card (the id prefix already tells).
