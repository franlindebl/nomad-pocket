# The text of every PDF inside some ZIMs, per page, for mkdb.ts: a search.db without a simulator.
# Needs poppler (pdftotext, pdfinfo). Usage: venv/bin/python -I pdfindex.py out.jsonl tmpdir id=/path/a.zim ...
import json, os, subprocess, sys
from libzim.reader import Archive

out = open(sys.argv[1], 'w')
pdf = os.path.join(sys.argv[2], 'doc.pdf')
for arg in sys.argv[3:]:
    item, path = arg.split('=', 1)
    a = Archive(path)
    n = 0
    for i in range(a.entry_count):
        e = a.get_entry_by_id(i)
        if e.is_redirect:
            continue
        it = e.get_item()
        if it.mimetype != 'application/pdf':
            continue
        open(pdf, 'wb').write(bytes(it.content))
        # documents-core MAX_PAGES; pdftotext separates pages with form feeds.
        text = subprocess.run(['pdftotext', '-enc', 'UTF-8', '-l', '1500', pdf, '-'], capture_output=True).stdout.decode('utf-8', 'replace')
        pages = text.split('\f')
        if pages and not pages[-1].strip():
            pages = pages[:-1]
        info = subprocess.run(['pdfinfo', pdf], capture_output=True).stdout.decode('utf-8', 'replace')
        title = next((l.split(':', 1)[1].strip() for l in info.splitlines() if l.startswith('Title:')), None)
        out.write(json.dumps({'itemId': item, 'path': e.path, 'pdfTitle': title, 'pages': pages}) + '\n')
        n += 1
    print(item, n, 'PDFs', flush=True)
