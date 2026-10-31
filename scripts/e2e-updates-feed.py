"""Stand-in Kiwix catalog for the content updates flows (docs/E2E.md, "Content updates").

    python3 -I scripts/e2e-updates-feed.py <serve dir> <base url>

E2E builds ask EXPO_PUBLIC_UPDATES_OPDS_URL (<base url>/opds) for newer editions of what is
installed instead of opds.library.kiwix.org. This writes the one feed every query gets
(<serve dir>/opds/catalog/v2/entries: python's http.server ignores the query string; the app
keeps the entry whose name it asked for) and copies the fixtures it lists as newer editions:

- wikipedia_en_100 (mini) and devdocs_en_node: a "2099-12" edition, the fixture under that name
  (a date no real edition reaches, so a fixture never catches up with it);
- freecodecamp_es_all: a 2099-12 edition of 50 TB, which never fits (the "no room" path); its
  file doesn't exist.

The flows' scripts copy the feed into place only for flows tagged `updates-server` (and
remove it otherwise: 404, no updates), so other flows see no update.
"""
import os
import shutil
import sys

serve, base = sys.argv[1], sys.argv[2].rstrip('/')
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'e2e', 'fixtures')
ACQ = 'http://opds-spec.org/acquisition/open-access'

books = [
    # (OPDS name, flavour, fixture to serve, size or None for the fixture's own)
    ('wikipedia_en_100', 'mini', 'wikipedia_en_100_mini_2026-01.zim', None),
    ('devdocs_en_node', '', 'devdocs_en_node_2026-08.zim', None),
    ('freecodecamp_es_all', '', None, 50 * 10**12),
]

entries = []
for i, (name, flavour, fixture, size) in enumerate(books):
    file = f"{name}{'_' + flavour if flavour else ''}_2099-12.zim"
    src = os.path.join(root, fixture) if fixture else None
    if src:
        if not os.path.exists(src):
            continue
        shutil.copyfile(src, os.path.join(serve, file))
        size = os.path.getsize(src)
    entries.append(
        f"""  <entry>
    <id>urn:uuid:00000000-0000-4000-8000-{i:012d}</id>
    <title>{name}</title>
    <updated>2099-12-01T00:00:00Z</updated>
    <name>{name}</name>
    <flavour>{flavour}</flavour>
    <language>eng</language>
    <link rel="{ACQ}" type="application/x-zim" href="{base}/{file}.meta4" length="{size}"/>
  </entry>"""
    )

feed = os.path.join(serve, 'updates-feed.xml')
with open(feed, 'w') as f:
    f.write('<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">\n')
    f.write(f'  <totalResults>{len(entries)}</totalResults>\n')
    f.write('\n'.join(entries))
    f.write('\n</feed>\n')
print(feed)
