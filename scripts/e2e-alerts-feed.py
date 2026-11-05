"""Stand-in official alert feeds for the alerts flows (docs/E2E.md, "Official alerts").

    python3 -I scripts/e2e-alerts-feed.py <serve dir> <base url>

E2E builds read every alert source from EXPO_PUBLIC_ALERTS_URL (<base url>/alerts) instead of AEMET, USGS, EMSC,
NWS and GDACS (src/features/alerts/sources.ts). This writes, under <serve dir>/alerts, the real samples in
src/features/alerts/fixtures/ with every time moved so the samples' moment (2026-11-04 23:00 UTC) is now, plus:

- an orange rain warning drawn over Madrid (where the suite puts the simulator: 40.4168, -3.7038), a copy of
  AEMET's Cartagena warning with a box around the city, so the list, the detail, the Home card and a notification
  have something to show;
- an M 4.8 earthquake 25 km from Madrid ten minutes ago in the USGS feed (the quake rule: M >= 4.5 within 100 km).

python's http.server ignores query strings, so `emsc/query?…` and `nws/alerts/active?point=…` are plain files.
"""
import datetime as dt
import gzip
import io
import json
import os
import re
import sys
import tarfile

serve, base = sys.argv[1], sys.argv[2].rstrip('/')
here = os.path.dirname(os.path.abspath(__file__))
fixtures = os.path.join(here, '..', 'src', 'features', 'alerts', 'fixtures')
out = os.path.join(serve, 'alerts')
SAMPLE = dt.datetime(2026, 11, 4, 23, 0, tzinfo=dt.timezone.utc)
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
delta = now - SAMPLE

ISO = re.compile(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})')


def shift_iso(text):
    def move(m):
        zone = m.group(3)
        t = dt.datetime.fromisoformat(m.group(1) + ('+00:00' if zone == 'Z' else zone)) + delta
        return t.strftime('%Y-%m-%dT%H:%M:%S') + (m.group(2) or '') + zone
    return ISO.sub(move, text)


def write(path, data):
    path = os.path.join(out, path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data if isinstance(data, bytes) else data.encode('utf-8'))


def read(name):
    with open(os.path.join(fixtures, name), 'rb') as f:
        return f.read()


# AEMET: the bundle, every CAP moved in time, plus the Madrid copy of the Cartagena orange warning.
stamp = now.strftime('%Y%m%d%H%M%S')
files = []
with tarfile.open(fileobj=io.BytesIO(read('aemet-afae.tar.gz')), mode='r:gz') as tar:
    for member in tar.getmembers():
        if member.isfile():
            files.append((member.name, shift_iso(tar.extractfile(member).read().decode('utf-8'))))
orange = next(x for n, x in files if '733005PRP10505' in n)
box = '40.30,-3.90 40.30,-3.50 40.55,-3.50 40.55,-3.90 40.30,-3.90'
madrid = re.sub(r'<polygon>[^<]*</polygon>', f'<polygon>{box}</polygon>', orange)
madrid = madrid.replace('Campo de Cartagena y Mazarrón', 'Madrid (E2E)').replace('733005', '999001')
madrid = re.sub(r'<references>[^<]*</references>', '', madrid).replace('<msgType>Update</msgType>', '<msgType>Alert</msgType>')
files.append((f'Z_CAP_C_LEMM_{stamp}_AFAZ999001PRP10505.xml', madrid))
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w', format=tarfile.USTAR_FORMAT) as tar:
    for name, xml in files:
        data = xml.encode('utf-8')
        info = tarfile.TarInfo(name)
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
bundle = f'aemet/Z_CAP_C_LEMM_{stamp}_AFAE.tar.gz'
write(bundle, gzip.compress(buf.getvalue()))
rss = read('aemet-rss-afae.xml').decode('utf-8')
rss = re.sub(r'https://www\.aemet\.es/documentos_d/eltiempo/prediccion/avisos/cap/Z_CAP_C_LEMM_\d+_AFAE\.tar\.gz', f'{base}/alerts/{bundle}', rss)
write('aemet/rss.xml', rss)

# Earthquakes: the samples moved in time, and one near Madrid in USGS's.
usgs = json.loads(read('usgs-4.5_day.geojson'))
ms = int(delta.total_seconds() * 1000)
for f in usgs['features']:
    f['properties']['time'] += ms
    f['properties']['updated'] += ms
near = json.loads(json.dumps(usgs['features'][0]))
near['id'] = 'e2e0000001'
near['properties'].update({'mag': 4.8, 'place': '25 km NE of Madrid, Spain (E2E)', 'time': int(now.timestamp() * 1000) - 600_000,
                           'url': 'https://earthquake.usgs.gov/earthquakes/eventpage/e2e0000001'})
near['geometry']['coordinates'] = [-3.5, 40.58, 10.0]
usgs['features'].insert(0, near)
write('usgs/4.5_day.geojson', json.dumps(usgs))
write('emsc/query', shift_iso(read('emsc-query.json').decode('utf-8')))

# NWS and GDACS as published (moved in time): only read for the US and for countries without a national source.
write('nws/alerts/active', shift_iso(read('nws-active-point.json').decode('utf-8')))
write('gdacs/rss_24h.xml', read('gdacs-rss-24h.xml'))
print(out)
