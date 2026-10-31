# Offline-bench libzim server: mirrors modules/nomad-zim's search / suggest / getContent
# over HTTP so a Node script can run the app's retrieval (rag.ts) on the host.
# Usage: venv/bin/python -I zimserver.py <port> id=/path/a.zim id2=/path/b.zim ...
import json, sys, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from libzim.reader import Archive
from libzim.search import Query, Searcher
from libzim.suggestion import SuggestionSearcher

archives = {}
locks = {}
for arg in sys.argv[2:]:
    k, p = arg.split('=', 1)
    archives[k] = Archive(p)
    locks[k] = threading.Lock()


def search(a, q, limit):
    if not a.has_fulltext_index:
        return []
    s = Searcher(a).search(Query().set_query(q))
    out = []
    for r in s.get_results(0, limit):
        out.append({'path': r.path, 'title': r.title, 'snippet': r.snippet})
    return out


def suggest(a, q, limit):
    s = SuggestionSearcher(a).suggest(q)
    out = []
    for path in s.get_results(0, limit):
        try:
            out.append({'path': path, 'title': a.get_entry_by_path(path).title})
        except Exception:
            pass
    return out


def content(a, path):
    try:
        e = a.get_entry_by_path(path)
        item = e.get_item()
    except Exception:
        return None
    mime = item.mimetype
    if not (mime.startswith('text/') or 'json' in mime or 'xml' in mime or 'javascript' in mime):
        return {'path': item.path, 'title': item.title, 'mimeType': mime, 'content': None}
    if item.size > 8 * 1024 * 1024:
        return None
    return {'path': item.path, 'title': item.title, 'mimeType': mime, 'content': bytes(item.content).decode('utf-8', 'replace')}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        a = archives.get(q.get('id', ''))
        res = None
        try:
            if u.path == '/ids':
                res = {k: {'fulltext': v.has_fulltext_index} for k, v in archives.items()}
            elif a is None:
                res = None
            elif u.path == '/search':
                with locks[q['id']]:
                    res = search(a, q['q'], int(q.get('limit', 8)))
            elif u.path == '/suggest':
                with locks[q['id']]:
                    res = suggest(a, q['q'], int(q.get('limit', 8)))
            elif u.path == '/content':
                res = content(a, q['path'])
        except Exception as ex:
            res = {'error': str(ex)}
        body = json.dumps(res).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class S(ThreadingHTTPServer):
    request_queue_size = 512
    daemon_threads = True


S(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
