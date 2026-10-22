#!/usr/bin/env python3
"""Cross an establishment's habilitações (CNES) with the habilitações each procedure requires.

Rules, as the SIGTAP base states them (rl_procedimento_habilitacao):
- habilitações with no group: having any one of them is enough;
- a group of habilitações (tb_grupo_habilitacao, named "0801 e 0803"): all of them are needed;
- a procedure with no habilitação row requires none.
A procedure is marked "sem habilitação" when the establishment meets none of its options.
Only habilitações valid in the exported competência count (competência inicial/final of the ficha).

Usage:
  python scripts/export_estabelecimento.py --data data --cnes fontes/cnes/3157245.json
Writes data/estabelecimento.json.
"""
import argparse
import json
from pathlib import Path


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data', type=Path, required=True)
    ap.add_argument('--cnes', type=Path, required=True)
    args = ap.parse_args()
    comp = json.loads((args.data / 'index.json').read_text(encoding='utf-8'))['competencia']
    ficha = json.loads(args.cnes.read_text(encoding='utf-8'))
    valid = sorted({h['codigo'] for h in ficha['habilitacoes']
                    if (h['competencia_inicial'] or '000000') <= comp <= (h['competencia_final'] or '999999')})
    have = set(valid)
    sem, com, livres = {}, 0, 0
    for path in sorted(args.data.glob('group-[0-9][0-9].json')):
        for code, proc in json.loads(path.read_text(encoding='utf-8')).items():
            tabs = proc.get('sigtap', {}).get('tabs', {})
            single, groups = tabs.get('habilitacao', []), tabs.get('grupo_habilitacao', [])
            if not single and not groups:
                livres += 1
            elif any(h in have for h in single) or any(all(h in have for h in hs) for _, hs in groups):
                com += 1
            else:
                # What would be needed: each single habilitação, or each group's missing ones.
                sem[code] = {'h': single, 'g': [[nu, hs] for nu, hs in groups]}
    out = {
        'cnes': ficha['cnes'], 'nome': ficha['nome_fantasia'], 'data_ficha': ficha['data_ficha'],
        'caminho': f'fontes/cnes/{ficha["arquivo"]}', 'competencia': comp,
        'habilitacoes': valid,
        'vencidas': sorted({h['codigo'] for h in ficha['habilitacoes']} - have),
        'resumo': {'sem_exigencia': livres, 'habilitado': com, 'sem_habilitacao': len(sem)},
        'sem_habilitacao': sem,
    }
    (args.data / 'estabelecimento.json').write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'CNES {ficha["cnes"]} em {comp}: {out["resumo"]}')


if __name__ == '__main__':
    main()
