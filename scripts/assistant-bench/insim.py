# Asks every question in a simulator's app and records what the screen says (refusals included).
# Usage: python3 -I insim.py <out.jsonl> <udid> [ids…]. Taps are for an iPhone 17 Pro on the assistant tab.
import json, subprocess, time, unicodedata, sys
U = sys.argv[2]
def ax(*a): return subprocess.run(['axe', *a, '--udid', U], capture_output=True, text=True).stdout
def labels():
    t = ax('describe-ui'); d = json.loads(t[t.index('['):])
    out = []
    def w(n):
        l = n.get('AXLabel') or ''
        if l: out.append((n.get('type'), l))
        for c in n.get('children') or []: w(c)
    for n in d: w(n)
    return out
def ascii(s): return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn').replace('¿', '').replace('¡', '')
qs = json.load(open('questions.json'))
only = [int(x) for x in sys.argv[3:]]
for q in qs:
    if only and q['id'] not in only: continue
    ax('tap', '-x', '330', '-y', '820'); time.sleep(2)  # Asistente tab
    # Never tap blind: a tap meant for the chat once opened Settings' "delete Wikipedia" dialog.
    if not any(l.startswith('Modelo:') for _, l in labels()):
        sys.exit(f'not on the assistant screen before question {q["id"]}: stopping')
    ax('tap', '-x', '364', '-y', '84'); time.sleep(2)  # new conversation
    ax('tap', '-x', '200', '-y', '718'); time.sleep(1)
    ax('type', ascii(q['q'])); time.sleep(1)
    ax('tap', '-x', '359', '-y', '756')
    t0 = time.time(); last = None; stable = 0
    while time.time() - t0 < 120:
        time.sleep(5)
        ls = labels()
        texts = [l for _, l in ls]
        done = any(l == 'Copiar' for l in texts) or any('negado' in l for l in texts) or any(l == 'Reintentar' for l in texts)
        if done:
            sig = len(' '.join(texts))
            stable = stable + 1 if sig == last else 0; last = sig
            if stable >= 1: break
    rec = {'id': q['id'], 'q': q['q'], 'refused': any('negado' in l for _, l in ls), 'screen': [l for t, l in ls if t == 'StaticText']}
    open(sys.argv[1], 'a').write(json.dumps(rec, ensure_ascii=False) + '\n')
    print(q['id'], 'REFUSED' if rec['refused'] else 'ok', flush=True)
