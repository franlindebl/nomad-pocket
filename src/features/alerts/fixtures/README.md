# Alerts fixtures

Real samples of the official feeds, downloaded on 2026-11-04 around 23:57 CET for the unit tests of the alerts
cores (`docs/ALERTS_PLAN.md`). Kept as published, except where noted. Re-download them only on purpose (a format
change): the tests assert things that were true in these files.

| File | Source | Notes |
|---|---|---|
| `aemet-rss-afae.xml` | AEMET, `…/avisos/rss/CAP_AFAE_RSS.xml` (Península, Baleares, Ceuta, Melilla) | 43 items; the first is the `.tar.gz` of the full state |
| `aemet-rss-afac65.xml` | AEMET, `…/avisos/rss/CAP_AFAC65_RSS.xml` (Canarias) | 17 items |
| `aemet-afae.tar.gz` | AEMET, `Z_CAP_C_LEMM_20261104225001_AFAE.tar.gz` (the first item above) | 115 KB, 219 CAP 1.2 files (3.5 MB unpacked), es-ES + en-GB, with polygons |
| `meteoalarm-atom-spain.xml` | MeteoAlarm, `feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain` | **Trimmed**: feed head + the first 8 of 125 entries |
| `meteoalarm-cap-spain.xml` | MeteoAlarm, the CAP linked from the first entry above | No polygon; EMMA_ID geocode |
| `nws-active-point.json` | NWS, `api.weather.gov/alerts/active?point=30.38,-93.14` | One Flood Warning (Louisiana) |
| `usgs-4.5_day.geojson` | USGS, `summary/4.5_day.geojson` | |
| `emsc-query.json` | EMSC, `/fdsnws/event/1/query?format=json&minmag=4.5&start=<24 h ago>&limit=50` | 4 events |
| `tsunami-pheb-atom.xml` | NOAA PTWC, `tsunami.gov/events/xml/PHEBAtom.xml` | No active event at download time |
| `gdacs-rss-24h.xml` | GDACS, `gdacs.org/xml/rss_24h.xml` | **Trimmed**: channel head + the first 6 of 114 items |

Attribution: © AEMET (Agencia Estatal de Meteorología); MeteoAlarm / EUMETNET members (CC BY 4.0); NOAA/NWS and
USGS (US public domain); EMSC-CSEM; GDACS (European Commission JRC / UN OCHA).
