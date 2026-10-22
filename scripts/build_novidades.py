#!/usr/bin/env python3
"""Compare two exported competências and write the "Novidades" data.

Everything listed comes from the two exports (data/ of the previous and of
the new competência): new, revoked and changed procedures, field by field,
and compatibilities added or removed. When a parsed Nota Técnica
(scripts/parse_nota_tecnica.py) is given, each item gets the PORTARIA that
published it, and the note and the base are cross-checked.

Usage:
  python scripts/build_novidades.py --anterior OLD/data --atual NEW/data \
      [--nota fontes/notas-tecnicas/202610.json]
Writes NEW/data/novidades/<competencia>.json and NEW/data/novidades/index.json
(the index keeps the competências already published in OLD/data/novidades).
"""
import argparse
import json
import shutil
from pathlib import Path

FIELDS = [  # (key, label, kind) — kind tells the page how to format the value
    ('nome', 'Nome', 'text'),
    ('valor_sa', 'Serviço Ambulatorial (SA)', 'money'),
    ('valor_sh', 'Serviço Hospitalar (SH)', 'money'),
    ('valor_sp', 'Serviço Profissional (SP)', 'money'),
    ('complexidade', 'Complexidade', 'complexidade'),
    ('financiamento_codigo', 'Financiamento', 'financiamento'),
    ('sexo', 'Sexo', 'sexo'),
    ('idade_minima', 'Idade Mínima', 'idade'),
    ('idade_maxima', 'Idade Máxima', 'idade'),
    ('quantidade_maxima', 'Quantidade Máxima', 'quantidade'),
    ('descricao', 'Descrição', 'descricao'),
]
SIGTAP_FIELDS = [
    ('dias_permanencia', 'Média de Permanência', 'dias'),
    ('tempo_permanencia', 'Tempo de Permanência', 'dias'),
    ('pontos', 'Pontos', 'int'),
    ('rubrica', 'Sub-Tipo de Financiamento', 'rubrica'),
]
RELATIONS = [  # relations[] kinds, read through catalog.json
    ('INSTRUMENTO', 'Instrumento de Registro'),
    ('MODALIDADE', 'Modalidade de Atendimento'),
    ('ATRIBUTO_COMPLEMENTAR', 'Atributos Complementares'),
    ('CID', 'CID'),
    ('CBO', 'CBO'),
    ('HABILITACAO', 'Habilitação'),
    ('SERVICO_CLASSIFICACAO', 'Serviço/Classificação'),
    ('REGRA_CONDICIONADA', 'Regra Condicionada'),
]
TABS = [  # sigtap.tabs lists (codes resolved by the page through lookups.json)
    ('leito', 'Leito'),
    ('incremento', 'Incremento'),
    ('redes', 'Redes'),
    ('renases', 'Renases'),
    ('origem_sia_sih', 'Origem SIA/SIH'),
    ('tuss', 'TUSS'),
]


def load(data_dir):
    data_dir = Path(data_dir)
    index = json.loads((data_dir / 'index.json').read_text(encoding='utf-8'))
    catalog = json.loads((data_dir / 'catalog.json').read_text(encoding='utf-8'))
    procs = {}
    for path in sorted(data_dir.glob('group-[0-9][0-9].json')):
        procs.update(json.loads(path.read_text(encoding='utf-8')))
    return index, catalog, procs


def rel_items(proc, catalog, kind):
    return {tuple(catalog[i]) for i in proc['relations'].get(kind, [])}


def tab_items(proc, kind):
    return {json.dumps(x, ensure_ascii=False) for x in proc.get('sigtap', {}).get('tabs', {}).get(kind, [])}


def compat_pairs(procs):
    pairs = {}
    for code, proc in procs.items():
        for item in proc.get('sigtap', {}).get('tabs', {}).get('compat', []):
            other, reg_p, reg_c, tipo, qt = item
            pairs[(code, other, reg_p, reg_c)] = [code, other, reg_p, reg_c, tipo, qt]
    return pairs


def proc_changes(old, new, cat_old, cat_new):
    changes = []
    for key, label, kind in FIELDS:
        if old.get(key) != new.get(key):
            changes.append({'campo': label, 'tipo': kind, 'antes': old.get(key), 'depois': new.get(key)})
    so, sn = old.get('sigtap', {}), new.get('sigtap', {})
    for key, label, kind in SIGTAP_FIELDS:
        if so.get(key) != sn.get(key):
            changes.append({'campo': label, 'tipo': kind, 'antes': so.get(key), 'depois': sn.get(key)})
    for kind, label in RELATIONS:
        a, b = rel_items(old, cat_old, kind), rel_items(new, cat_new, kind)
        if a != b:
            changes.append({'campo': label, 'tipo': 'lista', 'relacao': kind,
                            'incluidos': sorted([list(x) for x in b - a]),
                            'removidos': sorted([list(x) for x in a - b])})
    for kind, label in TABS + [('habilitacao', 'Habilitação (individual)'), ('grupo_habilitacao', 'Grupo de Habilitação')]:
        if kind == 'habilitacao':
            continue  # habilitações are already compared through relations HABILITACAO
        a, b = tab_items(old, kind), tab_items(new, kind)
        if a != b:
            changes.append({'campo': label, 'tipo': 'tab', 'tab': kind,
                            'incluidos': sorted(json.loads(x) for x in b - a),
                            'removidos': sorted(json.loads(x) for x in a - b)})
    return changes


def portaria_text(p):
    return f"Portaria {p['orgao']} nº {p['numero']} de {p['data']}" if p else None


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--anterior', required=True, type=Path)
    ap.add_argument('--atual', required=True, type=Path)
    ap.add_argument('--nota', type=Path)
    args = ap.parse_args()

    idx_old, cat_old, old = load(args.anterior)
    idx_new, cat_new, new = load(args.atual)
    comp_old, comp_new = idx_old['competencia'], idx_new['competencia']
    if comp_old >= comp_new:
        raise SystemExit(f'A competência anterior ({comp_old}) deve ser menor que a atual ({comp_new}).')

    note = json.loads(args.nota.read_text(encoding='utf-8')) if args.nota else None
    if note and note['competencia'] != comp_new:
        raise SystemExit(f'A nota técnica é da competência {note["competencia"]}, a base é {comp_new}.')

    def portarias(section, code):
        if not note:
            return []
        seen = []
        for e in note[section]:
            text = portaria_text(e['portaria'])
            if e['codigo'] == code and text not in seen:
                seen.append(text)
        return seen

    novos = [{'codigo': c, 'nome': new[c]['nome'], 'portarias': portarias('novos', c)} for c in sorted(set(new) - set(old))]
    revogados = [{'codigo': c, 'nome': old[c]['nome'], 'portarias': portarias('revogados', c)} for c in sorted(set(old) - set(new))]
    alterados = []
    for code in sorted(set(old) & set(new)):
        changes = proc_changes(old[code], new[code], cat_old, cat_new)
        if changes:
            alterados.append({'codigo': code, 'nome': new[code]['nome'], 'portarias': portarias('alterados', code), 'mudancas': changes})

    pairs_old, pairs_new = compat_pairs(old), compat_pairs(new)
    note_pairs = {}
    if note:
        for section in ('compat_novas', 'compat_revogadas'):
            for e in note[section]:
                note_pairs.setdefault((section, e['principal'], e['compativel']), portaria_text(e['portaria']))
    compat = []
    for key in sorted(set(pairs_new) - set(pairs_old)):
        compat.append({'situacao': 'incluida', 'par': pairs_new[key], 'portaria': note_pairs.get(('compat_novas', key[0], key[1]))})
    revoked = {r['codigo']: r for r in revogados}
    for key in sorted(set(pairs_old) - set(pairs_new)):
        item = {'situacao': 'removida', 'par': pairs_old[key], 'portaria': note_pairs.get(('compat_revogadas', key[0], key[1]))}
        gone = next((c for c in key[:2] if c in revoked), None)
        if not item['portaria'] and gone:
            # A pair disappears with a revoked procedure even when the note does not list the pair.
            item['decorrente_de'] = gone
            item['portaria'] = (revoked[gone]['portarias'] or [None])[0]
        compat.append(item)

    conferencia = None
    if note:
        def cmp(label, base_codes, note_codes):
            return {'item': label, 'so_na_base': sorted(base_codes - note_codes), 'so_na_nota': sorted(note_codes - base_codes)}
        changed = {a['codigo'] for a in alterados}
        conferencia = [
            cmp('Procedimentos novos', {n['codigo'] for n in novos}, {e['codigo'] for e in note['novos']}),
            cmp('Procedimentos revogados', {r['codigo'] for r in revogados}, {e['codigo'] for e in note['revogados']}),
            {'item': 'Alterações em procedimentos', 'so_na_base': [],
             'so_na_nota': sorted({e['codigo'] for e in note['alterados']} - changed),
             'observacao': 'Alterações da base sem item na nota não são divergência: a nota lista as portarias, a base traz todas as mudanças.'},
            {'item': 'Compatibilidades incluídas',
             'so_na_base': sorted(f'{c["par"][0]}→{c["par"][1]}' for c in compat if c['situacao'] == 'incluida' and not c['portaria']),
             'so_na_nota': sorted(f'{e["principal"]}→{e["compativel"]}' for e in note['compat_novas']
                                  if not any(k[:2] == (e['principal'], e['compativel']) for k in set(pairs_new) - set(pairs_old)))},
            {'item': 'Compatibilidades removidas',
             'so_na_base': sorted(f'{c["par"][0]}→{c["par"][1]}' for c in compat if c['situacao'] == 'removida' and not c['portaria']),
             'observacao': 'Pares removidos junto com um procedimento revogado recebem a portaria da revogação.',
             'so_na_nota': sorted(f'{e["principal"]}→{e["compativel"]}' for e in note['compat_revogadas']
                                  if not any(k[:2] == (e['principal'], e['compativel']) for k in set(pairs_old) - set(pairs_new)))},
        ]

    out_dir = args.atual / 'novidades'
    out_dir.mkdir(parents=True, exist_ok=True)
    nota_meta = None
    if note:
        nota_meta = {k: note[k] for k in ('numero', 'data', 'orgao', 'arquivo', 'sha256')}
        nota_meta['caminho'] = f'fontes/notas-tecnicas/{note["arquivo"]}'
    result = {
        'competencia': comp_new, 'anterior': comp_old, 'nota': nota_meta,
        'resumo': {'novos': len(novos), 'revogados': len(revogados), 'alterados': len(alterados),
                   'compat_incluidas': sum(c['situacao'] == 'incluida' for c in compat),
                   'compat_removidas': sum(c['situacao'] == 'removida' for c in compat)},
        'novos': novos, 'revogados': revogados, 'alterados': alterados, 'compatibilidades': compat,
        'conferencia': conferencia,
    }
    (out_dir / f'{comp_new}.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

    # Keep earlier competências published with the previous export.
    previous = args.anterior / 'novidades'
    entries = {}
    if (previous / 'index.json').exists():
        for e in json.loads((previous / 'index.json').read_text(encoding='utf-8')):
            entries[e['competencia']] = e
            src = previous / f'{e["competencia"]}.json'
            if src.exists() and e['competencia'] != comp_new:
                shutil.copy2(src, out_dir / src.name)
    entries[comp_new] = {'competencia': comp_new, 'anterior': comp_old, 'resumo': result['resumo'],
                         'nota': f"Nota Técnica {nota_meta['orgao']} nº {nota_meta['numero']}" if nota_meta else None}
    index = sorted(entries.values(), key=lambda e: e['competencia'], reverse=True)
    (out_dir / 'index.json').write_text(json.dumps(index, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'Novidades {comp_old} -> {comp_new}: {result["resumo"]}')
    if conferencia:
        for c in conferencia:
            print(f'  conferência {c["item"]}: só na base {len(c["so_na_base"])}, só na nota {len(c["so_na_nota"])}')


if __name__ == '__main__':
    main()
