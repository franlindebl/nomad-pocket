# Official points for the rest of the world: research (2026-11-12)

Desk research for the goal in `docs/OFFICIAL_POINTS.md` (do Spain's review for every country): one research agent per batch of
countries, an independent verifier re-checking every source called usable (dataset page, licence page, a sample of the data), then
this synthesis. Probes ran from a home connection, not from a GitHub runner: re-test every fetcher from a runner before building it.
Built since (2026-11-12, `docs/OFFICIAL_POINTS.md`, "Other countries"): Japan, France, Czechia, Ukraine, Chile, Peru,
Uruguay, Ethiopia, Canada (Ontario, BC), Australia, the United Kingdom (Great Britain), the United States (HRSA). Italy and
Nigeria were tried and left out: their coordinates fail the comparison with OSM. Second batch (2026-11-12): Latvia, Iceland,
Dominican Republic, Malawi, New Caledonia built; Taiwan blocked on a geocoder key, Estonia and Bahrain left out, and a
second look at Ireland, Greece, Norway, Romania, Morocco and Mexico found nothing usable yet. The current status of every
country, and why, is the table "Coverage by country" in `docs/OFFICIAL_POINTS.md`: this file is the research as it was.

Scope: pharmacies, hospitals and health centres completed from official open registers, as done for Spain. Where the verifier did not confirm a source, this report says "unconfirmed" or "rejected". Nothing here goes beyond the research and verifier input.

Counts and OSM figures are from the app's pois.tsv files (release routing-20261105), as reported by the researchers. The Balkans/Cyprus batch was redone separately (its table is in Europe). Many "none-found" results come from exhausted search budgets or portals unreachable from the research machine. They mean "not found", not "absent".

---

## 1. Summary

### Countries by final verdict
The verifier's verdict is used where one exists. Counts are approximate (about 230 territories).

| Final verdict | Count | Countries |
|---|---|---|
| ready | 13 | JP, ET, UA, AU, FR, CZ, LV, CA (Ontario and BC only), MW, BH, NC, MF, BL |
| licence-blocked | 5 | BR (CNES licence conflict), CO (CC BY-SA), BE (AFMPS licence unstated), NZ (Medsafe non-commercial), MU (CC BY-SA) |
| address-only | 12 | AR, GB, IE, GR, NO, LT (unverified), RO, LB, SY, TW, MV, MA |
| partial | about 63 | MK, CY, US and territories, MX, DO, HT, CL, UY, PE, DE, AT, IT, PT, IS, PL, HR, EE, TR, PS, YE, IN, KR, HK, SG, ID, MR, NG, SL, GN, CI, most of East/Central/Southern Africa (secondary WHO/Maina list) and others |
| none-found | about 135 | Most of the Caribbean, Central America, Central Asia/Caucasus, SE Asia, Pacific, West Africa, Nordics (except IS), Russia/Belarus, China, RS, BA, AL, XK, northern Cyprus and others (ME unreachable) |
| not-applicable | about 11 | VA, EH, NF, uninhabited territories and others |

### Headline opportunities
- **Japan:** the MHLW register has 61,398 pharmacies, all with coordinates. OSM has 24,129. About 37k pharmacies and about 55k clinics are missing from OSM.
- **Ethiopia:** the Ministry of Health list on HDX has 40,525 rows, including 9,045 pharmacies. OSM has 300 pharmacies.
- **Nigeria:** GRID3 v4.0 has 58,529 geolocated facilities. OSM has about 1.5k clinics. Pharmacies are not covered.
- **Ukraine:** the NSZU files have 17.6k pharmacies and 14.25k primary-care divisions, all with coordinates.
- **Australia:** the Geoscience Australia layer adds about 2.2k pharmacies and about 3k GPs. The licence chain needs sign-off.
- **Italy:** the Ministry's pharmacy register has 20,777 active pharmacies against OSM's 16,872.
- **Czechia:** the NRPZS register adds thousands of surgeries.
- **Chile, Peru, Uruguay:** each adds about 600 to 2,400 points for hospitals and clinics, under CC0, ODC-By and an attribution-only licence respectively.
- **Brazil (CNES):** technically the best source, but blocked until the licence is clarified with DATASUS.
- **Africa:** one CC0 compilation (Maina 2019) covers 50 countries as a stale fallback.
- **Tapped-out areas:** DACH, the Nordics, Benelux and Iberia have little to add because OSM is near the real totals.

---

## 2. Priority list

Ranking is (estimated missing points × population) / effort. It is approximate because many gap figures are unmatched against OSM. Brazil is listed separately because it is licence-blocked.

| # | Country | Kinds | Source (publisher) | Location | Licence | Verified? | OSM gap estimate | Effort |
|---|---|---|---|---|---|---|---|---|
| 1 | Japan | pharmacy, hospital, clinic, maternity | Iryo Joho-net open data zips (MHLW), https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/kenkou_iryou/iryou/newpage_43373.html | coordinates (100% in the 3 files probed) | PDL1.0 (compatible with CC BY 4.0) | Yes (pharmacy file parsed; hospital/clinic not re-fetched) | Pharmacy 61,398 vs 24,129; clinics 80,155 vs 25,337; hospitals 7,715 vs 10,399 (no gain) | low |
| 2 | Ethiopia | pharmacy, clinic, hospital, health post | Ethiopian Health Facilities (MoH via 3iS on HDX), https://data.humdata.org/dataset/ethiopian-health-facilities | coordinates | CC BY (uploader-declared) | Yes | about 9k pharmacies and 30k+ clinics/posts vs 300/424 | medium |
| 3 | Nigeria | hospital, clinic, other (no pharmacy) | GRID3 NGA Health Facilities v4.0 (GRID3/CIESIN with MoH), https://data.humdata.org/dataset/grid3-nga-health-facilities-v4-0 | coordinates (58,529 of 70,235) | CC BY 4.0 | Yes (gpkg opened) | about 40k+ clinics/health centres missing | medium |
| 4 | Ukraine | pharmacy, clinic | NSZU reimbursement pharmacies + primary-care divisions, data.gov.ua | coordinates (100%) | CC BY | Yes | pharmacies up to a few thousand; primary care several thousand (FAPs) vs 5,546 | low |
| 5 | Australia | pharmacy, GP/clinic, hospital | National HealthDirect Health Facilities (Geoscience Australia), https://services.ga.gov.au/gis/rest/services/National_HealthDirect_Health_Facilities/MapServer | coordinates | CC BY 4.0 (service metadata) | Yes | pharmacy 5,622 vs 3,407; GP 8,082 vs 4,989; hospitals no gain | low |
| 6 | Italy | pharmacy | Farmacie FRM_FARMA_5 (Ministero della Salute), https://www.dati.salute.gov.it/it/dataset/farmacie | coordinates for 18,941 of 20,777 active | IODL 2.0 | Yes | up to about 3.9k; realistically 1.5-2.5k | low |
| 7 | France | pharmacy, hospital, health centre, MSP | FINESS+ JSON (ANS), https://www.data.gouv.fr/datasets/finess-structures-1 | WGS84 on about 65-83% of open records; rest need address geocoding (BAN) | Licence Ouverte 2.0 | Yes (full file parsed) | pharmacy about 900 at most; value is hospitals and 6.5k centres | low |
| 8 | Czechia | pharmacy, hospital, clinic/surgeries | NRPZS places of provision (UZIS/MZCR), https://www.nzip.cz/data/1823-narodni-registr-poskytovatelu-zdravotnich-sluzeb | coordinates (99.7%; lat first) | CC BY 4.0 | Yes | pharmacy/hospital about none; surgeries thousands | low |
| 9 | Chile | hospital, clinic (pharmacy untested) | Establecimientos de Salud vigentes (MINSAL/DEIS), https://datos.gob.cl/dataset/establecimientos-de-salud-vigentes | coordinates | CC0 | Yes | about +600 clinics; Farmanet pharmacies unverified (Cloudflare 403) | low |
| 10 | Peru | hospital, clinic | RENIPRESS (SUSALUD), https://www.datosabiertos.gob.pe/dataset/registro-nacional-de-entidades-prestadoras-de-servicios-de-salud-renipress | coordinates for about a third of active rows missing | ODC-By | Yes | about +2.4k | low |
| 11 | Taiwan | pharmacy, clinic, hospital | NHI contracted facilities (MoHW/NHIA), https://data.gov.tw/dataset/168341 | address-only | OGDL v1.0 (compatible with CC BY 4.0) | Yes | pharmacy about 5.4k (7,656 active vs 2,274); clinics about 18.7k | medium (geocoder untested) |
| 12 | Uruguay | hospital, clinic | Unidades Asistenciales de ASSE, catalogodatos.gub.uy | coordinates | Licencia Datos Abiertos Uruguay (attribution) | Yes | about +700, rural policlinics | low |
| 13 | United Kingdom | pharmacy, hospital, GP | NHS ODS ORD API (England/Wales) + PHS Scotland CSVs | address-only (postcode) | OGL v3 (ODS terms page 403, not read first-hand) | Yes (partly) | pharmacies about 3,000-3,600 | medium (geocode with ONSPD/Code-Point; about 11k detail calls) |
| 14 | United States | clinic, hospital, pharmacy | HRSA (clinics, coordinates), CMS (hospitals, address-only), NPPES (pharmacy, unconfirmed) | mixed | federal works (no licence field) | Partly | pharmacies about 30-40k estimated (not measured); hospitals small net gain | medium |
| 15 | Canada | pharmacy, hospital, clinic | Ontario MOHSERLO (ArcGIS) + BC Pharmacies CSV | coordinates | OGL-Ontario; OGL-BC | Yes | Ontario 5,159 + BC 1,353 pharmacies vs 6,343 OSM nationally | medium |
| 16 | DR Congo | hospital, clinic | GRID3 COD v9.0 (HDX) / Maina 2019 | coordinates | CC BY 4.0 / CC0 | Partly (COD metadata only) | about 15k official vs about 4.2k OSM | medium |
| 17 | Malawi | hospital, clinic | MHFR (MoH via Health Cluster, HDX) | coordinates (1,332 of 1,514; strings need cleaning) | CC BY | Yes | about 540 | low |
| 18 | Dominican Republic | hospital, clinic | SNS Establecimientos de Salud, https://datos.gob.do/dataset/establecimientos-de-salud-sns | coordinates | ODbL | Yes | about 1,000+ public centres; no pharmacies | low |
| - | Brazil | pharmacy, hospital, clinic | CNES (Ministério da Saúde/DATASUS), API https://apidadosabertos.saude.gov.br/cnes/estabelecimentos | coordinates (about 512k of 574k) | **Conflict:** portal footer CC BY-ND 3.0 vs OSM wiki "public domain with attribution" | Yes for access; licence unresolved | pharmacy type 43: 20,838 vs OSM 15,597; clinics largest gap | medium. Email DATASUS first |

Not worth doing by the data: DE, AT, CH, NL, LU, MC, AD, Nordics (except IS), PT, PL, EE, LV pharmacies. OSM already matches the official totals, or the sources are subnational or lack coordinates.

---

## 3. Cross-cutting sources

| Source | Would cover | Caveats |
|---|---|---|
| **WHO GHFD** | Global, all kinds, in principle | Verdict none-found. WHO's page says "not available yet" (12 Nov 2026). No download, licence or counts. Re-check periodically (ghfd@who.int). WHO's usual IGO NC-SA licence would be incompatible. |
| **Maina et al. 2019 (figshare 7725374)** | 50 sub-Saharan countries; 98,745 public/FBO facilities (about 96% with coordinates); Nigeria 20,807, DRC 14,586, Tanzania 6,304, Kenya 6,146, Ethiopia 5,215, South Africa 4,303 | Verifier-confirmed CC0 on figshare (HDX copy says CC BY). Feb 2019 snapshot. Compiled by KEMRI-Wellcome/Oxford/WHO from ministry lists, not a government. Some coordinates come from Google Earth, GeoNames or maps. Mauritania's 645 are all digitised from an online map (provenance risk). Sudan's 272 are hospitals only. No pharmacies. Fallback only. |
| **GRID3** | Nigeria v4.0 (CC BY 4.0, 70,235 rows, Nov 2026); DRC v9.0 (CC BY, Sep 2026, metadata only); Sierra Leone v1.0 (CC BY 4.0, 1,616 rows, MoHS co-owned, Aug 2023) | Publisher is Columbia CIESIN. Nigeria is explicitly "non-exhaustive, non-validated" and no pharmacy class was confirmed. Filter by flags and functional status and dedupe. Other GRID3 country sets unverified. |
| **HDX umbrella** | About 91 facility datasets, mostly CC BY | Licence is set by the uploader, not the ministry. Many items are 2013-2021. Each dataset needs its own check. HOT/Healthsites exports are OSM-derived and rejected. Verified items: Ethiopia, Haiti, Malawi, Chad, Guinea, Côte d'Ivoire, Palestine, Yemen, Indonesia. |
| **Eurostat GISCO healthcare** | Hospitals only, about 32 countries (no DE in "last"); EU 14,084 rows; CSV/GeoJSON/GPKG; pub 26/10/2026; reference dates 2017-2026 | Verifier: licence-blocked as a layer. Per-country licence is "TBD" for nearly all. Stated only for FR (Open Licence), NL (Open), IE (GeoHive terms). The IT "IODL 2.0" claim was not seen in the verifier's PDF check. Use as a pointer to national registers. |
| **DHIS2 / MFL portals** | Per-country master facility lists | Verdict none-found. Software, not a dataset. Instances are mostly behind login. No open multi-country repository. |
| **Healthsites.io** | Global | Rejected. ODbL but OSM-derived, API key needed, not official. |
| **WHO regional MFL browsers** | WHO AFRO iAHO | Rejected. No coordinates, download or licence. |

---

## 4. Per-continent tables

Grouped rows list several countries that share a verdict. "OSM-only" means no official source was found. Licence-blocked and rejected sources are included with reasons.

### North and Central America, Caribbean

| Country | Verdict | Best source (dataset URL) | Licence | Location | Note |
|---|---|---|---|---|---|
| United States | partial | HRSA sites CSV https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv; CMS hospitals https://data.cms.gov/provider-data/dataset/xubh-q36u; NPPES https://download.cms.gov/nppes/NPI_Files.html | federal works (portal licence fields null) | HRSA coordinates (19,215 of 19,594); CMS address-only (Census geocoder); NPPES address-only | NPPES (1.1 GB, pharmacy count and licence unconfirmed) is the only candidate for pharmacies. CDC Vaccines.gov (41,789 locations, coordinates) is stale since July 2024. CMS blocks custom User-Agents. HIFLD rejected (not live). OSM pharmacies 20.5k. |
| PR, VI, GU, AS, MP | partial | Same HRSA file (PR 164, VI 7, GU 3, AS 8, MP 3) | federal works | coordinates | Marginal except PR and AS. |
| Canada | ready (ON, BC) | Ontario MOHSERLO https://data.ontario.ca/dataset/ministry-of-health-service-provider-locations-mohserlo; BC https://catalogue.data.gov.bc.ca/dataset/f5b6bfad-d06a-4952-ae47-976fb5092bcc | OGL-Ontario; OGL-BC | coordinates | ON 11,625 rows (5,159 pharmacies). BC 1,353 pharmacies, an 811 directory (may be incomplete). StatCan ODHF (OGL-Canada) is a 2020 snapshot with no pharmacies. Other provinces unresearched. |
| Mexico | partial | CLUES (DGIS) http://www.dgis.salud.gob.mx/contenidos/intercambio/clues_gobmx.html; DENUE (INEGI) https://www.inegi.org.mx/rnm/index.php/catalog/335 | CLUES: "no restrictions", no named licence; DENUE: INEGI free use with attribution | unverified (hosts unreachable or SPA) | No machine-readable access demonstrated for either. DENUE needs a free token or an undiscovered bulk URL. OSM 7,890 pharmacies. |
| Dominican Republic | partial | https://datos.gob.do/dataset/establecimientos-de-salud-sns | ODbL | coordinates | 1,915 public SNS facilities. Farmacias del Pueblo is address-only and its download returned HTTP 500. |
| Haiti | partial | PAHO/WHO list via OCHA https://data.humdata.org/dataset/2f5e0b21-b85e-4adf-be25-6c17783bad75 | CC BY | coordinates | About 730, from 2023, no pharmacies. Low priority. |
| Saint-Martin (MF), Saint-Barthélemy (BL) | ready | FINESS (see France) | Licence Ouverte 2.0 | coordinates (EPSG:5490; some commune centroids) | Gain tiny (about 2 pharmacies in BL). |
| none-found | none-found | - | - | - | GT, BZ, HN, SV, NI, CR, PA (Tonosi-only CC0 CSV, rejected), CU, JM (2016 CSV gone, 404), TT (HTML directory, no coordinates), BS, BB, AG, DM, GD, KN, LC, VC, AW, CW, SX, AI, KY, VG, TC, MS, GL, PM, BM (gazetted PDF register, no licence). Many portals were unreachable from the research machine (GT, HN, SV, CR). |

### South America

| Country | Verdict | Best source (dataset URL) | Licence | Location | Note |
|---|---|---|---|---|---|
| Chile | partial | https://datos.gob.cl/dataset/establecimientos-de-salud-vigentes | CC0 | coordinates | 5,327 open facilities. Resolve the file name via CKAN package_show. Pharmacy source Farmanet (CC BY, https://datos.gob.cl/dataset/farmacias-en-chile) is untested (403). |
| Peru | partial | RENIPRESS monthly CSV (datosabiertos.gob.pe) | ODC-By | coordinates (about 20k active) | Scrape the page for the dated file name. No pharmacy source (DIGEMID has a query tool only). |
| Uruguay | partial | https://catalogodatos.gub.uy/dataset/unidades-asistenciales-de-asse | Licencia Datos Abiertos Uruguay | coordinates | 947 public ASSE units. No pharmacies or private providers. |
| Brazil | licence-blocked | CNES API https://apidadosabertos.saude.gov.br/cnes/estabelecimentos; zip (stale, June 2025) | unresolved: CC BY-ND 3.0 footer vs OSM-wiki claim | coordinates | Keyless API works (cap 20 per request, so practical for pharmacy and hospital types only). Filter deactivated rows. Email DATASUS or read the dataset metadata. |
| Argentina | address-only | REFES/REFAR on datos.gob.ar | not specified | address-only | 38,767 facilities and 15,067 pharmacies, Dec 2024. Georef API is keyless but its licence and limits are untested. PAMI (CC BY 4.0, 2022) was WAF-blocked. SISA needs credentials. |
| Colombia | licence-blocked | REPS https://www.datos.gov.co/d/c36g-9fc2 | CC BY-SA 4.0 | address-only | Share-alike clashes with ODbL (the same reason Galicia was excluded). No geocoder. Could ask MinSalud whether another licence applies. |
| none-found | none-found | - | - | - | PY, BO, EC, VE, GY, SR, FK. Only light checks. Several portals refused connections or returned 403 (retest from a runner). |

### Europe

| Country | Verdict | Best source (dataset URL) | Licence | Location | Note |
|---|---|---|---|---|---|
| France | ready | FINESS+ https://www.data.gouv.fr/datasets/finess-structures-1 | Licence Ouverte 2.0 | WGS84 on a subset | Legacy CSV frozen May 2026. Open pharmacies 19,882. Needs BAN geocoding for the rest. Establishment category is `categorieentiteGeographiqueExercice` inside `pmej[].ege[]`. |
| Czechia | ready | https://www.nzip.cz/data/1823-narodni-registr-poskytovatelu-zdravotnich-sluzeb (file on datanzis.uzis.gov.cz) | CC BY 4.0 | coordinates (POINT lat lon) | Dedupe by place+provider ID. Pharmacy code 510. |
| Latvia | ready | ZVA register CSV https://dati.zva.gov.lv/fdu-registrs/export/fdu_register.csv; IC institutions on data.gov.lv | CC0 | coordinates | Use active status 4 only. Institutions file is a 2024 subset. Gain small. |
| Ukraine | ready | NSZU CSVs on data.gov.ua | CC BY | coordinates | Hospitals not labelled. Pharmacies only those contracted with NSZU. Occupied-territory points may appear. |
| Italy | partial | https://www.dati.salute.gov.it/it/dataset/farmacie | IODL 2.0 | coordinates (about 91% of active rows) | URL carries the date, so scrape the page. Some coordinates are OSM-derived. No hospital source with coordinates. |
| Poland | partial | Rejestr Aptek XML https://rejestry.ezdrowie.gov.pl/api/ra/pharmacies/getxml | unstated, unverifiable | coordinates on only about a third | Needs geocoding; OSM already has more (12.9k). RPWDL has no bulk export. dane.gov.pl unreachable. |
| Germany | partial | Berlin WFS (dl-de/zero, 702); Brandenburg WFS (dl-de/by-2-0, 531) | as stated | coordinates | Gain about zero. Rejected: Bundes-Klinik-Atlas, ABDA, G-BA. |
| Austria | partial | Vienna WFS (CC BY 4.0, 358 pharmacies, 28 hospitals); KA-Verzeichnis xlsx (address-only, no licence, blocks non-browser User-Agent) | as stated | mixed | Salzburg JSON is in EPSG:31258. Gain small. |
| Portugal | partial | SNS emergency units API (94 units, 2023) | CC BY (dados.gov.pt copy) | coordinates | Cross-check only. Only municipal pharmacy sets. |
| Greece | address-only | data.gov.gr contact lists (CC BY, 2016, Greek free-text addresses) | CC BY | address-only | OSM pharmacies 5,701 vs about 11-12k real, but no source. |
| Croatia | partial | Zagreb pharmacies (245), Otvorena dozvola | "Otvorena dozvola" licence not read, not OKD/OSI-flagged | coordinates | City only. HZZO national data unreachable and without licence. |
| Estonia | partial | https://apteegid.ravimiamet.ee/data/apteegid.json | public domain per agency email only | coordinates | Gain about 11. Ask Ravimiamet for a written statement. |
| Iceland | partial | Heilsuvera WFS https://gis.is/geoserver/embaetti_landlaeknis/ows | CC BY 4.0 | coordinates | 74 health centres plus 7 emergency departments, live. Skip care homes. |
| United Kingdom | address-only | NHS ODS ORD API https://directory.spineservices.nhs.uk/ORD/2-0-0/; PHS CSVs https://www.opendata.nhs.scot | OGL v3 | address-only | NI has no open source. RO198 is not a clean hospital list. Monthly Scottish file names change. |
| Ireland | address-only | PSI pharmacy xlsx https://www.psi.ie/information-and-resources/monthly-statistics | CC BY 4.0 covers only the summary dataset; extract has re-use terms with an advertising clause | address-only | No open official geocoder. HSE lists returned 404. Effectively unusable. |
| Norway | address-only | DMP apotekoversikt xlsx | unstated (NLOD only on municipal mirrors) | postcode only | Negligible gap. |
| Lithuania | address-only (unverified) | VLK list https://data.gov.lt/datasets/1386/ | CC BY 4.0 per search snippet, not verified | unknown | API failed during research and verification. Retry. |
| Romania | address-only | CNAS (no addresses); pharmacy 2019 XLS (OGL, free-text) | CC BY 4.0 / OGL | none / address-only | Effectively unusable. |
| Belgium | licence-blocked | AFMPS pharmacy xlsx (4,863 rows, Lambert 2008) | unstated; only a copyright footer | coordinates | Needs written permission or a licensed data.gov.be record. GitHub mirror is CC BY-NC-SA, must not be used. |
| Netherlands | none-found | RIVM hospitals WFS (CC0, Sept 2013) | CC0 | coordinates | Stale. CBS data is closed. |
| North Macedonia | partial (address-only, stale) | MoH register of institutions https://data.gov.mk/dataset/12b1928c-00e2-4291-870a-b4a0d143a13d (ustanovi.csv); Medicines Agency pharmacy register (2021) | CC0 | address-only | 4,693 active rows, 1,346 pharmacies vs OSM 306 (up to ~1,000 missing), but the file is a 2019 snapshot despite "quarterly" metadata. No open geocoder (Nominatim over OSM only). |
| Cyprus | partial (little gain) | Private pharmacies 2026-2027 https://www.data.gov.cy/en/dataset/817 (704); state hospitals (8, coordinates) /dataset/964; health centres (35, names only) /dataset/965 | CC BY 4.0 | address-only (pharmacies) | OSM has 648 pharmacies, 110 hospitals: ~56 pharmacies at most. Ignore the pharmacist name columns. |
| Serbia | none-found | RFZO contracted private pharmacies (xlsx on rfzo.rs, refused automated fetches); Zrenjanin city GeoJSON | "sodl" (Serbian open data licence, text not read) | address-only | No national register of facilities. |
| Montenegro | unverified | MoH "Spisak svih zdravstvenih institucija u CG" (xlsx, CC BY per search snippet, 2025); Montefarm pharmacies | CC BY (unconfirmed) | address-only | data.gov.me unreachable from the research machine: retry from a runner. |
| Bosnia and Herzegovina, Albania, Kosovo, northern Cyprus | none-found | - | - | - | BA's portals don't resolve and data is split by entity; AL's portal is an SPA with PDFs only; Kosovo's agency has never published its pharmacy list; nothing for northern Cyprus. GISCO hospital layers for AL, CY, ME, RS have licence "TBD" and add nothing over OSM. |
| none-found | none-found | - | - | - | LU, MC, AD, CH (only cantonal: BL 48 pharmacies, Bern hospitals unlicensed), LI, SE, DK (DAWA retired; SOR unverified), FI, FO, AX, SK, HU (portals refused), SI, BG (data.egov.bg 403), MD, BY, RU (NC-SA, sanctions caveat), MT (GISCO only), SM, JE, GG, IM. VA not applicable. |

### Asia and Middle East

| Country | Verdict | Best source (dataset URL) | Licence | Location | Note |
|---|---|---|---|---|---|
| Japan | ready | MHLW (see priority list) | PDL1.0 | coordinates | File names carry the date, so scrape the page. Attribution must mention processing. Data is self-reported. |
| South Korea | partial | data.go.kr National Pharmacy Standard Data https://www.data.go.kr/data/15096290/standard.do; HIRA API 15001698 | "no restrictions" | unverified | Download is JS-driven and probably needs an account/key. Coordinates and counts unverified. OSM pharmacies only 3,075. |
| Taiwan | address-only | https://data.gov.tw/dataset/168341 | OGDL v1.0 | address-only | Filter rows with a termination date. NLSC/TGOS geocoder untested. |
| Hong Kong | partial | HA JSON https://www.ha.org.hk/opendata/facility-hosp.json; DH pharmacies XML https://www.drugoffice.gov.hk/eps/psi/LicPharmacyList.xml | data.gov.hk terms (indemnity, silent on derivatives) | HA coordinates; DH address-only (ALS geocoder works) | Gap about 370 pharmacies. |
| Singapore | partial | HSA pharmacies GeoJSON (249); CHAS clinics (1,193, 140 dental, June 2024) on data.gov.sg | Singapore Open Data Licence v1.0 | coordinates | API needs 5-8 s between calls. Do not ingest the pharmacist-in-charge column. |
| Indonesia | partial | HDX hospitals https://data.humdata.org/dataset/indonesia-health-facilities | CC BY | coordinates | 1,616 hospitals, 2018, never updated. No OSM baseline. |
| India | partial | data.gov.in National Hospital Directory (2017) | GODL (per OSM wiki only) | coordinates | Portal unreachable, no file fetched, mostly already in OSM. ABDM HFR: none-found (403, no licence). |
| Turkey | partial | İzmir pharmacies https://acikveri.bizizmir.com/en/dataset/nobetci-eczaneler-ve-eczane-listesi | CC BY 4.0 (municipal licence) | coordinates (X/Y swapped) | 2,055 rows, province only. |
| Pakistan | none-found (verifier) | ALHASAN SHP on HDX | CC0 | coordinates | Private compiler, archived, 2017. Fails "official". |
| Bahrain | ready | data.gov.bh `geographical-locations-of-clinics`, `-hospitals`, `-health-medical-centers` | Bahrain Government Open Data License v1.1 (attribution; read only partly) | coordinates | 40 hospitals, 101 centres, 287 clinics. Pharmacies are counts only. |
| Palestine | partial | HDX https://data.humdata.org/dataset/state-of-palestine-health-0 | CC BY | coordinates | 505 facilities plus 80 hospitals. OSM already exceeds. |
| Yemen | partial | HDX HeRAMS 2020 https://data.humdata.org/dataset/yemen-herams-dataset-2020-list-of-health-facilities | CC BY-IGO | coordinates | 5,322 points. WHO is not a national government. Owner's judgement call. |
| Lebanon | address-only | Open Data Lebanon MoPH pharmacies (about 2.1k rows) | unstated | cadastral text | Civil-society host, not geocodable. |
| Syria | address-only | HDX MoH hospitals | CC BY | none | No coordinates. |
| Maldives | address-only | HEMS directory https://hems.health.gov.mv/establishments | unstated | address-only | HTML only, 585 facilities. Needs Ministry permission. |
| none-found | none-found | - | - | - | GE, AM, AZ, KZ, UZ, TM, TJ, KG (2014 list), MN, AF, IL, JO (unreachable), IQ, IR, SA, AE (unreachable), QA, KW, OM, BD, LK, NP, BT, TH (MOPH asks for a written request), VN, LA, KH, MM, MY, PH (NHFR 403), BN, TL, MO, CN (also GCJ-02 shift), KP. Many portals refused connections. Retest GE, AZ, AM, UZ, TH, PH, JO, AE, SA from a runner. |

### Africa

| Country | Verdict | Best source (dataset URL) | Licence | Location | Note |
|---|---|---|---|---|---|
| Ethiopia | ready | https://data.humdata.org/dataset/ethiopian-health-facilities | CC BY | coordinates | Filter Status=Approved. Uploader is an NGO (3iS). MoH registry mfrv2.moh.gov.et needs login. |
| Malawi | ready | https://data.humdata.org/dataset/malawi-health-facility-registry | CC BY | coordinates (strings with stray spaces) | Published via the Health Cluster. Flags unreliable. |
| Nigeria | partial | GRID3 v4.0 (see priority list) | CC BY 4.0 | coordinates | NCDC NHFR portal unreachable. |
| Sierra Leone | partial | GRID3 SLE ArcGIS https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/sle_htlfac_grid3_v01/FeatureServer/0 | CC BY 4.0 | coordinates (1,561 of 1,616) | Aug 2023 snapshot. |
| Guinea | partial | HDX https://data.humdata.org/dataset/structures_de_sante_guinee_vf | CC0 (uploader tag) | coordinates (1,773 of 2,430) | About 2018. Type only as a name prefix. |
| Côte d'Ivoire | partial | HDX https://data.humdata.org/dataset/health-facilities-2012 | public domain tag | coordinates | 2012 data, 1,933 rows, marginal. |
| Chad | partial | HDX MoH list (2020, 1,985 rows) | CC BY | coordinates | Originates from the ministry. |
| Morocco | address-only | data.gov.ma hospitals 2025 (184), ESSP 2025 (about 3,245) | ODbL | commune only | No pharmacies, centroid stacking, unusable for nearest-X. |
| DRC and secondary-list countries | partial | Maina/HDX list (KE, TZ, UG, RW, BI, CM, CF, GQ, GA, CG, CD, ST, SS, ER, DJ, SO; ZA, NA, BW, ZW, ZM, MZ, AO, LS, MG, SC, KM) | CC0 (figshare) / CC BY (HDX) | coordinates | Stale, non-government compilation, no pharmacies. Largest gaps: CD, KE, TZ, MG, AO. Tanzania HFR (14,483 facilities) download is not obtainable without a session. Kenya KMHFL timed out. Mozambique MISAU list (CC0, 2017) has broken decimals. Botswana/Zambia MFL sites have TLS problems. Zimbabwe MoHCW shapefile is licence "Other". |
| Mauritius | licence-blocked | data.govmu.org pharmacies (294) and hospitals/clinics (169) | CC BY-SA 4.0 | coordinates | Could ask opendata@govmu.org for a waiver. |
| Mauritania | partial (weak) | Maina list (645) | CC BY | coordinates | All digitised from an online map, so provenance risk. |
| Ghana, Mali | none-found (verifier) | - | - | - | Ghana (2012-13, unreachable, wiki evidence about another dataset); Mali (HeRAMS, no names or types). |
| Sudan, Libya | none-found (verifier) | - | - | - | Sudan: hospitals only, stale. Libya: UN cluster, no coordinates. |
| none-found | none-found | - | - | - | DZ, TN, EG, SN (PDF only), LR, GM, GW, TG, BJ, NE, BF, CV, SZ, SH, Somaliland. EH and BIOT/TF/GS not applicable. |

### Oceania

| Country | Verdict | Best source (dataset URL) | Licence | Location | Note |
|---|---|---|---|---|---|
| Australia | ready | Geoscience Australia MapServer (layers 0/1/2) | CC BY 4.0 | coordinates | March 2025 snapshot. Upstream Healthdirect NHSD terms are non-commercial, so GA's relicensing needs legal sign-off. The licence text warns against emergency use. Hospital layer includes odd entries (rooms). |
| New Caledonia | ready | https://data.gouv.nc/explore/dataset/situation_etablissements_sante/ | Licence Ouverte 2.0 | coordinates | 64 pharmacies, 3 hospitals, about 50 dispensaries. Filter OUVERT. Privacy filter on 195 liberal cabinets. |
| New Zealand | licence-blocked (pharmacies) | Medsafe register (xlsx, about 1,097 premises) | Crown, non-commercial | address-only | Ask Medsafe for CC BY. LINZ facilities licence not confirmed (151 hospital-use polygons, many aged care). |
| none-found | none-found | - | - | - | PF, FJ, PG, SB, VU, WS, TO, KI, TV, NR, FM, MH, PW, CK, NU, WF (14 of these not researched at all). NF is covered by Australia. HM, PN not applicable. |

---

## 5. Implementation notes

### Repeating patterns
- **ArcGIS REST/FeatureServer:** CA-ON, AU, SL, MX-none, HR (Zagreb). Paginate with `resultOffset`. Request `outSR=4326`. Mind `maxRecordCount`.
- **WFS:** DE (Berlin, Brandenburg, EPSG:25833), AT (Vienna), IS, NL (EPSG:28992). Request `srsName`.
- **CKAN / OpenDataSoft APIs:** CL, UY, DO, LV, UA, MU, NC, BH, TW. Resolve dated file names through `package_show`.
- **Scrape-the-page for dated file URLs:** IT (daily), JP (twice a year), PE, CL, UY, GB-Scotland.
- **Static xlsx/csv at a stable URL:** ET, MW, Maina, ES-style bulk files.
- **Coordinate order and reprojection:** CZ (lat first), TR İzmir (X/Y swapped), FR (Lambert/UTM plus WGS84 subset), BE (Lambert 2008), AT-Salzburg (EPSG:31258), NL (RD), MX/DENUE (token).
- **Geocoders needed (address-only):**
  - TW: NLSC/TGOS untested.
  - AR: Georef, keyless, limits untested.
  - GB: ONSPD/Code-Point/OS Open UPRN, OGL, not fetched.
  - US: Census batch geocoder, terms not fully verified.
  - HK: ALS.
  - FR: BAN for records without coordinates.
  - SG: OneMap.
  - NZ: LINZ addresses.
  - IE, GR, CO, LB, MA: none usable.
- **Attribution lines to ship:** CC BY/OGL family (CA, GB, AU, SG, IS, UA, CL?), PDL1.0 (must say the data was processed), ODC-By (PE), ODbL (DO, MA), Uruguay's licence (provider, licence, dataset, note of changes), Bahrain (source and extraction date), Licence Ouverte (FR, NC), IODL (IT).
- **Licence conflicts to resolve:** BR (ND vs PD), BE, NZ, CO and MU (CC BY-SA), IE (advertising clause), HR (OD licence unread), HK (indemnity, silent on derivatives), AU (upstream NHSD terms).

### Risks
- **Blocked runner IPs / User-Agents:** CMS (custom UA gets 403), at.gov KA-Verzeichnis (browser UA only), Cloudflare on Chile's Farmanet, India's data.gov.in/ABDM, Thai portals, Mexico's CLUES host (timeout), Botswana/Zambia TLS. Test every fetcher from a GitHub Actions runner before building.
- **Stale data:** Maina 2019, CNES zip (June 2025, use the API), SG CHAS (June 2024), CDC Vaccines.gov (2024), AU snapshot (Mar 2025), most HDX items (2013-2023).
- **Coordinate quality:** FINESS commune centroids, CNES precision, Maina digitised points, Ethiopia/NG duplicates and flags. Sanity-filter to country bounding boxes (PE, MW strings).
- **Inflated or unrealistic gaps:** the "no OSM within 300 m" figures in Africa/Southern Africa are overstated (coarse coordinates).
- **Health gate:** the Android build has no health features (`HEALTH_FEATURES`), so any health-related official layer needs the same gating (see `docs/ANDROID_PLAY.md`). Pharmacies may or may not fall under it; confirm.
- **Emergency disclaimer:** Australia's licence says not to use the data to locate services in an emergency, which matters for this app.

### Suggested order of the first 10 countries
1. **Japan.** Largest gain, clean licence, one script.
2. **Ethiopia.** Huge pharmacy gap, static CSV.
3. **Ukraine.** Two CSVs, CC BY, coordinates.
4. **Italy.** Reuses the pharmacy pipeline; the scraped dated URL is the only wrinkle.
5. **France.** Also covers DROM, MF and BL. Needs the BAN geocoding fallback.
6. **Czechia.** Single monthly CSV with coordinates.
7. **Chile.** CC0. Add the pharmacy layer if Farmanet works from a runner.
8. **Peru.** ODC-By, monthly.
9. **Australia.** After sign-off on the upstream NHSD terms.
10. **Nigeria.** GRID3, with flag filtering and dedupe.

Next candidates: Uruguay, Canada (ON/BC), UK (with ONSPD), US (HRSA first), Malawi, Dominican Republic, Bahrain, Latvia, New Caledonia, Taiwan (once a geocoder is validated), and Brazil after DATASUS confirms the licence.
