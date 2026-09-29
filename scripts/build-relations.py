"""Regenerate the CID/CBO search index from exported SIGTAP relationships."""
import json, argparse
from pathlib import Path
root = Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--data',type=Path,default=root/'data')
args=parser.parse_args()
data=args.data
cat = json.loads((data/'catalog.json').read_text(encoding='utf-8'))
index = {kind: {} for kind in ('CID', 'CBO')}
for path in sorted(data.glob('group-*.json')):
    for code, procedure in json.loads(path.read_text(encoding='utf-8')).items():
        for kind in index:
            for relation in procedure['relations'].get(kind, []):
                value, name, *_ = cat[relation]
                entry = index[kind].setdefault(value, [name, set()])
                entry[1].add(code)
result = {kind: [[code, name, sorted(procs)] for code, (name, procs) in sorted(entries.items())] for kind, entries in index.items()}
(data/'relations-index.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
print({kind: len(entries) for kind, entries in result.items()})
