# Blinded grading sheets: per question, every variant's answer under a random letter.
# Usage: python3 -I mkgrade.py <out_dir> name=file.jsonl ...  → sheets part1..3.md + key.json
import json, random, sys, os

out = sys.argv[1]
variants = dict(a.split('=', 1) for a in sys.argv[2:])
qs = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'questions.json')))
answers = {}
for name, path in variants.items():
    for line in open(path):
        r = json.loads(line)
        if r.get('error') == 'GUARDRAIL':
            text = '[ERROR SHOWN TO USER: "El modelo integrado se ha negado a responder. Prueba a reformular la pregunta o usa un modelo descargado."]'
            if r.get('partial'):
                text = r['partial'] + '\n\n' + text
        else:
            text = r.get('answer') or r.get('error') or '(empty)'
        answers.setdefault(r['id'], {})[name] = text

rng = random.Random(7)
key = {}
parts = [[], [], []]
for i, q in enumerate(qs):
    names = sorted(answers.get(q['id'], {}))
    rng.shuffle(names)
    letters = 'ABCDEFGH'[: len(names)]
    key[q['id']] = dict(zip(letters, names))
    block = [f"## Q{q['id']}: {q['q']}\n"]
    for l, n in zip(letters, names):
        block.append(f"### Answer {l}\n{answers[q['id']][n].strip()}\n")
    parts[i * 3 // len(qs)].append('\n'.join(block))
os.makedirs(out, exist_ok=True)
for i, p in enumerate(parts):
    open(os.path.join(out, f'part{i + 1}.md'), 'w').write('\n\n'.join(p))
json.dump(key, open(os.path.join(out, 'key.json'), 'w'), indent=1)
print({k: len(v) for k, v in answers.items()} if len(sys.argv) > 99 else 'ok')
