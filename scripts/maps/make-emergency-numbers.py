#!/usr/bin/env python3
# Builds src/features/maps/emergency-numbers.json (the number the app offers to call in each country
# of regions.json) and docs/EMERGENCY_NUMBERS.md (the table the owner reviews), from Wikipedia's "List
# of emergency telephone numbers" plus the corrections in OVERRIDES.
#
# One number per country: the one that reaches every service when there is one (the first the page
# lists: 999 in the UK, 112 in Ireland), else the ambulance's, marked as such. Re-run and review the diff
# before each release that touches it:
#
#   python3 scripts/maps/make-emergency-numbers.py            # fetches the page
#   python3 scripts/maps/make-emergency-numbers.py page.wiki  # or reads a saved copy (action=raw)
import datetime
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAGE = 'https://en.wikipedia.org/w/index.php?title=List_of_emergency_telephone_numbers&action=raw'

# id -> (number, 'all' | 'ambulance' | 'police', why). Checked by hand against what the page says.
EU_112 = '112 reaches every service (the EU/EEA single number; the page lists the services\' own numbers)'
OVERRIDES = {
    'at': ('112', 'all', EU_112),
    'de': ('112', 'all', EU_112),
    'fr': ('112', 'all', EU_112),
    'no': ('112', 'all', EU_112),
    'si': ('112', 'all', EU_112),
    'ch': ('112', 'all', '112 is routed to the emergency services, like in the EU'),
    'li': ('112', 'all', '112 is routed to the emergency services, like in the EU'),
    'mc': ('112', 'all', '112 is routed to the emergency services, like in the EU'),
    'sm': ('112', 'all', '112 is routed to the emergency services, like in the EU'),
    'co': ('123', 'all', 'Línea 123, the national emergency line'),
    'pk': ('1122', 'ambulance', 'Rescue 1122, the government emergency service'),
    'td': ('17', 'police', 'the ambulance number on the page is a local landline'),
    'km': ('17', 'police', 'the ambulance number on the page is a local landline'),
    'cd': ('112', 'police', 'no national ambulance number'),
    'cg': ('117', 'police', 'no national ambulance number'),
    'na': ('10111', 'police', 'ambulance numbers depend on the town'),
    'ioa': ('000', 'all', 'Australian territory (Christmas and Cocos Islands)'),
    'nf': ('000', 'all', 'Australian territory'),
    # Rows the page gets wrong or leaves unclear, checked by the owner (2026-10-29).
    'ad': ('116', 'ambulance', 'checked: 110 police, 116 ambulance, 118 fire'),
    'et': ('911', 'all', 'checked: 911 general, 991 police, 907 ambulance, 939 fire'),
    'ug': ('911', 'ambulance', 'checked: 999 police, 911 ambulance, 112 fire'),
    'tz': ('112', 'all', 'checked: 112 reaches ambulance, fire and police (GOV.UK travel advice); 115 ambulance, 114 fire'),
    'pe': ('106', 'ambulance', 'checked: 105 police, 106 ambulance (SAMU), 116 fire'),
    'bo': ('118', 'ambulance', 'checked: 110 police, 118 ambulance, 119 fire'),
    'lk': ('1990', 'ambulance', 'checked: 118/119 police, 1990 ambulance (Suwa Seriya), 110/111 fire'),
    'ae': ('998', 'ambulance', 'checked: 999 police, 998 ambulance, 997 fire'),
}
# Countries whose row on the page reads doubtful: kept as derived, flagged for review.
DOUBTFUL = {}

# Page names that don't match regions.json's English or Spanish names.
ALIAS = {
    'peoplesrepublicofchina': 'cn', 'republicofchina': 'tw', 'unitedstatesofamerica': 'us', 'thebahamas': 'bs',
    'republicofcongo': 'cg', 'democraticrepublicofcongo': 'cd', 'ivorycoast': 'ci', 'easttimor': 'tl',
    'czechrepublic': 'cz', 'northkorea': 'kp', 'southkorea': 'kr', 'micronesia': 'fm', 'curacao': 'cw',
    'saotomeandprincipe': 'st', 'turksandcaicos': 'tc', 'usvirginislands': 'vi', 'falklandislands': 'fk',
    'vaticancity': 'va', 'eswatini': 'sz', 'capeverde': 'cv', 'northerncyprus': 'cyn', 'palestine': 'ps',
    'saintbarthelemy': 'bl', 'saintmartin': 'mf', 'sintmaarten': 'sx', 'hongkong': 'hk', 'macau': 'mo',
    'alandislands': 'ax', 'saintvincentandthegrenadines': 'vc', 'britishindianoceanterritory': 'io',
    'southgeorgiaandthesouthsandwichislands': 'gs', 'russia': 'ru', 'syria': 'sy', 'laos': 'la', 'vietnam': 'vn',
    'iran': 'ir', 'moldova': 'md', 'tanzania': 'tz', 'bolivia': 'bo', 'venezuela': 've', 'brunei': 'bn',
    'kosovo': 'xk', 'westernsahara': 'eh', 'saintkittsandnevis': 'kn', 'saintlucia': 'lc',
    'saintpierreandmiquelon': 'pm', 'gambia': 'gm', 'northmacedonia': 'mk', 'bosniaandherzegovina': 'ba',
    'antiguaandbarbuda': 'ag', 'trinidadandtobago': 'tt', 'britishvirginislands': 'vg', 'unitedarabemirates': 'ae',
    'unitedkingdom': 'gb', 'marshallislands': 'mh', 'northernmarianaislands': 'mp', 'wallisandfutuna': 'wf',
    'americansamoa': 'as', 'cookislands': 'ck', 'frenchpolynesia': 'pf', 'newcaledonia': 'nc',
    'papuanewguinea': 'pg', 'solomonislands': 'sb', 'centralafricanrepublic': 'cf', 'equatorialguinea': 'gq',
    'guineabissau': 'gw', 'southsudan': 'ss', 'southafrica': 'za', 'dominicanrepublic': 'do',
}


def fold(s):
    return re.sub(r'[^a-z]', '', unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower())


def parse(src):
    """The page's tables as {name, police, ambulance, fire}, refs and markup removed."""
    src = re.sub(r'<ref[^>]*/>', '', src)
    src = re.sub(r'<ref[^>]*>.*?</ref>', '', src, flags=re.S)
    src = re.sub(r'<!--.*?-->', '', src, flags=re.S)
    rows = []
    for row in re.split(r'\n\|-+\s*\n', src):
        m = re.search(r'^\|\s*(?:\{\{nowrap\|)?\{\{(?:Flag|Flagicon|flag)\|([^}|]+)', row, flags=re.M)
        if not m:
            continue
        cells = []
        for line in row[m.end():].split('\n')[1:]:
            if not line.startswith('|') or line.startswith('|}'):
                continue
            c = line[1:]
            span = int(re.search(r'colspan="?(\d)', c).group(1)) if re.search(r'colspan="?(\d)', c) else 1
            if '|' in c and re.match(r'\s*(align|style|colspan|rowspan)', c):
                c = c.split('|', 1)[1]
            c = re.sub(r"'''", '', c)
            c = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]*)\]\]', r'\1', c)
            c = re.sub(r'<br\s*/?>', ' ', c)
            c = re.sub(r'\{\{[^}]*\}\}', '', c).strip()
            cells += [c] * span
        cells += [''] * (3 - len(cells))
        rows.append({'name': m.group(1).strip(), 'police': cells[0], 'ambulance': cells[1], 'fire': cells[2]})
    return rows


def numbers(cell):
    """The numbers in a cell, in order ("10 111" is one number, "112 or 999" two)."""
    if re.fullmatch(r'[\d ]+', cell.strip() or 'x'):
        cell = cell.replace(' ', '')
    return re.findall(r'\b\d{2,5}\b', cell)


def derive(row):
    p, a, f = (numbers(row[k]) for k in ('police', 'ambulance', 'fire'))
    common = [n for n in p if n in a and n in f]
    if common:
        return common[0], 'all'
    if a:
        return a[0], 'ambulance'
    return None, None


def main():
    src = Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else urllib.request.urlopen(PAGE).read().decode()
    regions = [r for r in json.loads((ROOT / 'src/features/maps/regions.json').read_text())['regions'] if r['type'] == 'country']
    by_name = {}
    for r in regions:
        for n in (r['name']['en'], r['name']['es']):
            by_name.setdefault(fold(n), r['id'])
    page = {}
    for row in parse(src):
        rid = ALIAS.get(fold(row['name'])) or by_name.get(fold(row['name']))
        if rid:
            page.setdefault(rid, row)

    out, table = {}, []
    for r in sorted(regions, key=lambda r: r['name']['es']):
        rid = r['id']
        row = page.get(rid)
        number, kind = derive(row) if row else (None, None)
        why = ''
        if rid in OVERRIDES:
            number, kind, why = OVERRIDES[rid]
        if number:
            out[rid] = {'n': number} if kind == 'all' else {'n': number, 'for': kind}
        note = why or DOUBTFUL.get(rid, '')
        if rid in DOUBTFUL:
            note = '**Revisar:** ' + note
        cols = (row['police'], row['ambulance'], row['fire']) if row else ('', '', '')
        table.append((r['name']['es'], rid, number or '—', {'all': 'todo', 'ambulance': 'ambulancia', 'police': 'policía'}.get(kind, '—'), *cols, note))

    today = datetime.date.today().isoformat()
    data = {
        'source': "Wikipedia, \"List of emergency telephone numbers\", with corrections (scripts/maps/make-emergency-numbers.py).",
        'checked': today,
        'numbers': out,
    }
    (ROOT / 'src/features/maps/emergency-numbers.json').write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n')

    cell = lambda s: s.replace('|', '/').replace('\n', ' ')[:60]
    lines = [
        '# Emergency numbers per country',
        '',
        'Generated by `scripts/maps/make-emergency-numbers.py` on ' + today + ' from Wikipedia\'s',
        '"List of emergency telephone numbers" (columns Police / Ambulance / Fire), with the corrections in the',
        'script. The app offers one number: the one for every service when there is one, else the ambulance\'s.',
        'Rows marked **Revisar** read doubtful on the page; "—" means no number (the app then offers 112, which',
        'GSM phones treat as an emergency call everywhere).',
        '',
        '| País | id | Número | Para | Policía (página) | Ambulancia (página) | Bomberos (página) | Nota |',
        '|---|---|---|---|---|---|---|---|',
    ]
    lines += ['| ' + ' | '.join(cell(str(c)) for c in t) + ' |' for t in table]
    (ROOT / 'docs/EMERGENCY_NUMBERS.md').write_text('\n'.join(lines) + '\n')
    print(f'{len(out)} of {len(regions)} countries with a number')


main()
