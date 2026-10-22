#!/usr/bin/env python3
"""PDF report: what the establishment's habilitações (CNES) mean for the SIGTAP table.

Reads data/estabelecimento.json (scripts/export_estabelecimento.py), the
habilitação requirements of each procedure and the habilitação names from the
SIGTAP base, and the establishment's own habilitações from fontes/cnes.

Usage:
  python scripts/relatorio_habilitacoes.py --data data --out relatorio-habilitacoes.pdf
"""
import argparse
from collections import Counter, defaultdict
from pathlib import Path

from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, PageBreak, Spacer

from pdf_common import (BRAND_SOFT, CONTENT_WIDTH, NOHAB, ROSE_BG, SKY_BG, box, build, comp_label, fmt_int,
                        load_json, load_procs, mask_hab, mask_proc, numbers, pct, table, P, x)

ROOT = Path(__file__).resolve().parents[1]
# Habilitações of the "Agora Tem Especialistas" programme: every name in the base that contains it (3802–3808).
ATE_NAME = 'Agora Tem Especialistas'


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data', type=Path, default=ROOT / 'data')
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()

    est = load_json(args.data / 'estabelecimento.json')
    ficha = load_json(ROOT / f"fontes/cnes/{est['cnes']}.json")
    lk = load_json(args.data / 'lookups.json')
    idx = load_json(args.data / 'index.json')
    procs = load_procs(args.data)
    comp = est['competencia']
    have = set(est['habilitacoes'])
    sem = est['sem_habilitacao']
    hname = lambda h: lk['habilitacao'].get(h, '')
    ate = {h for h, n in lk['habilitacao'].items() if ATE_NAME in n}

    def required(code):
        s = sem[code]
        return set(s['h']) | {h for _, hs in s['g'] for h in hs}

    sem_ate = sorted(c for c in sem if required(c) <= ate)        # only programme habilitações
    sem_real = sorted(c for c in sem if c not in set(sem_ate))
    total = len(procs)
    res = est['resumo']

    # Per SIGTAP group
    by_group = defaultdict(Counter)
    for code, p in procs.items():
        t = p.get('sigtap', {}).get('tabs', {})
        g = code[:2]
        by_group[g]['total'] += 1
        if code in sem:
            by_group[g]['sem'] += 1
            if code in sem_ate:
                by_group[g]['ate'] += 1
        elif t.get('habilitacao') or t.get('grupo_habilitacao'):
            by_group[g]['hab'] += 1
        else:
            by_group[g]['livre'] += 1

    # What each habilitação of the establishment does in the base
    uses = defaultdict(Counter)
    for code, p in procs.items():
        t = p.get('sigtap', {}).get('tabs', {})
        for h in t.get('habilitacao', []):
            uses[h]['exige'] += 1
        for _, hs in t.get('grupo_habilitacao', []):
            for h in set(hs):
                uses[h]['grupo'] += 1
        for i in t.get('incremento', []):
            uses[i[0]]['incremento'] += 1

    # Missing habilitações that block the most procedures (programme aside)
    blockers = Counter()
    partial = Counter()
    for c in sem_real:
        s = sem[c]
        for h in s['h']:
            if h not in ate:
                blockers[h] += 1
        for nu, hs in s['g']:
            missing = [h for h in hs if h not in have]
            if len(missing) < len(hs):
                partial[(nu, tuple(hs), tuple(missing))] += 1
            for h in missing:
                if h not in ate:
                    blockers[h] += 1

    title = 'Habilitações do hospital e a tabela SIGTAP'
    story = [
        P(x(title), 'title'),
        P(f"{x(ficha['nome_fantasia'])} (CNES {x(est['cnes'])}) · base SIGTAP {comp_label(comp)} · "
          f"habilitações conforme ficha do CNES de {x(est['data_ficha'])}", 'subtitle'),
        P('Nem todo procedimento da tabela pode ser faturado por qualquer estabelecimento: parte deles exige uma '
          'habilitação. Este relatório cruza as habilitações do hospital com as exigências cadastradas na base SIGTAP, '
          'procedimento por procedimento.', 'body'),
        Spacer(1, 4),
        numbers([(fmt_int(res['sem_exigencia']), f"não exigem habilitação ({pct(res['sem_exigencia'], total)})"),
                 (fmt_int(res['habilitado']), f"exigem, e o hospital tem ({pct(res['habilitado'], total)})"),
                 (fmt_int(res['sem_habilitacao']), f"exigem, e o hospital não tem ({pct(res['sem_habilitacao'], total)})")]),
        Spacer(1, 4),
        P(f'Total: {fmt_int(total)} procedimentos na competência {comp_label(comp)}.', 'small'),
        Spacer(1, 6),
        box([P(f"<b>Ponto de atenção.</b> Dos {fmt_int(len(sem))} procedimentos sem habilitação, <b>{fmt_int(len(sem_ate))}</b> "
               f"têm como única exigência as habilitações do programa <i>Agora Tem Especialistas</i> "
               f"({', '.join(mask_hab(h) for h in sorted(ate & set().union(*[required(c) for c in sem_ate])))}). "
               'São, na maioria, cirurgias de média complexidade que um hospital geral costuma realizar. '
               'A base não diz se a habilitação do programa é condição para faturar o procedimento ou só para '
               'receber pelo programa. <b>Precisa ser confirmado com o faturamento</b> (por exemplo, se esses '
               'procedimentos são aceitos no SIH sem rejeição).', 'body'),
             P(f"Sem esses, os procedimentos que de fato dependem de uma habilitação que o hospital não tem são "
               f"<b>{fmt_int(len(sem_real))}</b>.", 'body')], bg=ROSE_BG),
        Spacer(1, 6),
        P('Como a regra funciona', 'h2'),
        P('Na base SIGTAP, um procedimento pode listar habilitações avulsas, e basta ter uma delas; ou grupos de '
          'habilitação (por exemplo, "0801 e 0803"), e então são necessárias todas as do grupo. Procedimento sem '
          'nenhuma habilitação cadastrada não depende disso. Só contam as habilitações vigentes na competência '
          '(competência inicial e final da ficha do CNES).', 'body'),
        P('A habilitação é um dos critérios de faturamento, não o único: o SIH e o SIA também conferem '
          'serviço/classificação, leitos e CBO dos profissionais cadastrados no CNES, que não estão neste cruzamento.',
          'small'),
    ]

    # Por grupo
    story += [P('Por grupo da tabela', 'h1')]
    rows = [['Grupo', 'Total', 'Não exigem', 'Hospital tem', 'Hospital não tem', 'dos quais só Agora Tem Esp.']]
    for g, name in idx['hierarchy']['groups']:
        c = by_group[g]
        rows.append([f'<b>{g}</b> {x(name)}', fmt_int(c['total']), fmt_int(c['livre']), fmt_int(c['hab']),
                     f"<b>{fmt_int(c['sem'])}</b>" if c['sem'] else '0', fmt_int(c['ate']) if c['ate'] else '—'])
    rows.append(['<b>Total</b>', fmt_int(total), fmt_int(res['sem_exigencia']), fmt_int(res['habilitado']),
                 f"<b>{fmt_int(res['sem_habilitacao'])}</b>", fmt_int(len(sem_ate))])
    w = (CONTENT_WIDTH - 66 * mm) / 5
    story.append(table(rows, [66 * mm] + [w] * 5))

    # O que falta
    story += [CondPageBreak(60 * mm), P('Habilitações que o hospital não tem e que mais limitam a tabela', 'h1'),
              P('Sem contar o Agora Tem Especialistas. Um procedimento pode aceitar várias habilitações; '
                'ele aparece na contagem de cada uma.', 'small')]
    rows = [['Habilitação', 'Nome (base SIGTAP)', 'Procedimentos']]
    for h, n in blockers.most_common(20):
        rows.append([mask_hab(h), x(hname(h)), fmt_int(n)])
    story.append(table(rows, [22 * mm, CONTENT_WIDTH - 50 * mm, 28 * mm]))
    if partial:
        story.append(P('Grupos de habilitação em que o hospital tem só parte', 'h2'))
        rows = [['Grupo', 'Exige', 'Falta', 'Procedimentos']]
        for (nu, hs, missing), n in partial.most_common():
            rows.append([nu, x(' e '.join(f'{mask_hab(h)} {hname(h)}' for h in hs)), x(', '.join(mask_hab(h) for h in missing)), fmt_int(n)])
        story.append(table(rows, [16 * mm, CONTENT_WIDTH - 62 * mm, 22 * mm, 24 * mm]))

    # Habilitações do hospital
    story += [PageBreak(), P('As habilitações do hospital na base SIGTAP', 'h1'),
              P('Para cada habilitação da ficha do CNES: em quantos procedimentos da base ela aparece como exigência '
                '(avulsa ou dentro de um grupo) e em quantos dá incremento financeiro.', 'small')]
    rows = [['Hab.', 'Nome (base SIGTAP)', 'Origem', 'Vigência', 'Exige', 'Em grupo', 'Incremento']]
    no_effect = []
    for h in ficha['habilitacoes']:
        c = uses[h['codigo']]
        fim = comp_label(h['competencia_final']) if h['competencia_final'] else 'sem fim'
        rows.append([mask_hab(h['codigo']), x(hname(h['codigo'])), h['origem'].title(),
                     f"{comp_label(h['competencia_inicial'])} a {fim}",
                     *(fmt_int(c[k]) if c[k] else '—' for k in ('exige', 'grupo', 'incremento'))])
        if not (c['exige'] or c['grupo'] or c['incremento']):
            no_effect.append(h['codigo'])
    story.append(table(rows, [13 * mm, CONTENT_WIDTH - 112 * mm, 17 * mm, 30 * mm, 16 * mm, 17 * mm, 19 * mm], style='cell_small'))
    notes = []
    if no_effect:
        notes.append(f"Não aparecem em nenhum procedimento da base {comp_label(comp)}: "
                     + '; '.join(f'{mask_hab(h)} {x(hname(h))}' for h in no_effect) + '.')
    ending = [h for h in ficha['habilitacoes'] if h['competencia_final']]
    if ending:
        notes.append('Habilitações com prazo: ' + '; '.join(f"{mask_hab(h['codigo'])} até {comp_label(h['competencia_final'])}" for h in ending)
                     + '. Depois disso, os procedimentos que dependem delas passam a aparecer como sem habilitação, se não houver renovação.')
    top_inc = sorted(((uses[h]['incremento'], h) for h in have if uses[h]['incremento']), reverse=True)[:3]
    if top_inc:
        notes.append('Incremento: ' + '; '.join(f'{mask_hab(h)} {x(hname(h))} dá incremento em {fmt_int(n)} procedimentos' for n, h in top_inc)
                     + '. Isso muda o valor recebido, mesmo em procedimentos que não exigem habilitação.')
    for n in notes:
        story.append(Spacer(1, 4))
        story.append(P(n, 'body'))

    # No site
    story += [Spacer(1, 6), box([P(f'<b>No SIGTAP Explorador</b> (sigtap.github.io), os procedimentos sem habilitação '
                                   f'aparecem com o sinal {NOHAB} ao lado do nome. Passando o mouse, o site mostra a habilitação '
                                   'exigida; na ficha, um clique no sinal lista as habilitações pelo nome.', 'body')], bg=SKY_BG)]

    # Anexos
    def proc_table(codes, with_req):
        rows = [['Código', 'Procedimento'] + (['Exige (uma das opções)'] if with_req else [])]
        for c in codes:
            row = [f"<font name='Mono'>{mask_proc(c)}</font>", x(procs[c]['nome'])]
            if with_req:
                s = sem[c]
                opts = [mask_hab(h) for h in s['h']] + [' e '.join(mask_hab(h) for h in hs) for _, hs in s['g']]
                row.append(x(', '.join(opts)))
            rows.append(row)
        widths = [27 * mm, CONTENT_WIDTH - 77 * mm, 50 * mm] if with_req else [27 * mm, CONTENT_WIDTH - 27 * mm]
        return table(rows, widths, style='cell_small')

    story += [PageBreak(), P(f'Anexo A. Procedimentos sem habilitação ({fmt_int(len(sem_real))})', 'h1'),
              P('Exceto os que exigem só habilitações do Agora Tem Especialistas (anexo B).', 'small'),
              proc_table(sem_real, True),
              PageBreak(), P(f'Anexo B. Procedimentos que exigem só habilitações do Agora Tem Especialistas ({fmt_int(len(sem_ate))})', 'h1'),
              P('Situação a confirmar com o faturamento (ver ponto de atenção na primeira página).', 'small'),
              proc_table(sem_ate, False),
              Spacer(1, 10),
              P(f"<b>Fontes.</b> Base SIGTAP {comp_label(comp)} (DuckDB), tabelas rl_procedimento_habilitacao, tb_habilitacao "
                f"e tb_grupo_habilitacao; ficha do CNES {x(est['cnes'])} de {x(est['data_ficha'])} ({x(ficha['arquivo'])}). "
                'Gerado por scripts/relatorio_habilitacoes.py.', 'small')]
    build(args.out, story, f"Habilitações · CNES {est['cnes']} · SIGTAP {comp_label(comp)}")
    print(f'Relatório de habilitações: {args.out} ({len(sem_real)} + {len(sem_ate)} sem habilitação)')


if __name__ == '__main__':
    main()
