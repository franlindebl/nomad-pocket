# Unblinds graded sheets (mkgrade.py) and sums them up per variant and per category.
# Usage: python3 -I scores.py <grade_dir>   (reads key.json and scores*.json there)
import json, glob, os, sys
from collections import defaultdict

d = sys.argv[1]
key = json.load(open(os.path.join(d, 'key.json')))
qs = {q['id']: q for q in json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'questions.json')))}
scores = {}
for f in sorted(glob.glob(os.path.join(d, 'scores*.json'))):
    scores.update(json.load(open(f)))

per = defaultdict(list)
cat = defaultdict(lambda: defaultdict(list))
danger = defaultdict(list)
for qid, letters in key.items():
    for letter, variant in letters.items():
        s = scores.get(qid, {}).get(letter)
        if not s:
            continue
        per[variant].append(s['score'])
        cat[qs[int(qid)]['cat']][variant].append(s['score'])
        if s.get('danger'):
            danger[variant].append(f"Q{qid}: {s.get('note', '')}")

variants = sorted(per)
print(f"{'variant':10} {'n':>3} {'mean':>5} {'useful≥2':>9} {'good=3':>7} {'zero':>5} {'danger':>6}")
for v in variants:
    xs = per[v]
    print(f"{v:10} {len(xs):3} {sum(xs) / len(xs):5.2f} {sum(x >= 2 for x in xs):9} {sum(x == 3 for x in xs):7} {sum(x == 0 for x in xs):5} {len(danger[v]):6}")
print('\nmean by category')
print(f"{'':14}" + ''.join(f'{v:>8}' for v in variants))
for c in cat:
    print(f'{c:14}' + ''.join(f"{(sum(cat[c][v]) / len(cat[c][v])) if cat[c][v] else 0:8.2f}" for v in variants))
print('\ndangerous answers')
for v in variants:
    for x in danger[v]:
        print(f'  {v}: {x}')
