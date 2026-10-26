#!/usr/bin/env python3
"""PDF report of the changes between two SIGTAP competências, organised by the Nota Técnica.

The Nota Técnica is the main thread: sections and portarias in the order the
note prints them. Each item is detailed with what the base comparison found
(data/novidades/<AAAAMM>.json from scripts/build_novidades.py): values,
attributes, links. Changes the base shows without an item in the note come in
a separate section, and the report ends with the note × base check.

Usage:
  python scripts/relatorio_competencia.py --data data [--competencia 202610] [--out data/novidades/202610.pdf]
"""
import argparse
from collections import OrderedDict
from pathlib import Path

from reportlab.lib.units import mm
from reportlab.platypus import CondPageBreak, Spacer

from pdf_common import (BRAND_SOFT, CONTENT_WIDTH, NOHAB, ROSE_BG, box, build, comp_label, fmt_int,
                        load_json, load_procs, mask_hab, mask_proc, money, numbers, table, P, x)

ROOT = Path(__file__).resolve().parents[1]
LIST_MAX = 30   # items shown per changed list; the site has the whole list


def portaria_key(p):
    return f"Portaria {p['orgao']} nº {p['numero']} de {p['data']}" if p else None


class Fmt:
    """Text of a changed value, as the site shows it (names from lookups.json)."""

    def __init__(self, lk):
        self.lk = lk

    def age(self, v):
        if v == 9999:
            return 'Não se aplica'
        if v < 12:
            return f'{v} {"mês" if v == 1 else "meses"}'
        return f'{v // 12} {"ano" if v // 12 == 1 else "anos"}'

    def value(self, kind, v):
        lk = self.lk
        if v is None or v == '':
            return '—'
        return {
            'money': lambda: money(v),
            'complexidade': lambda: lk['complexidade'].get(v, v),
            'financiamento': lambda: f"{v} - {lk['financiamento'][v]}" if v in lk['financiamento'] else v,
            'sexo': lambda: lk['sexo'].get(v, v),
            'idade': lambda: self.age(v),
            'quantidade': lambda: 'Sem limite (9999)' if v == 9999 else fmt_int(v),
            'dias': lambda: f'{v} {"dia" if v == 1 else "dias"}',
            'int': lambda: fmt_int(v),
            'rubrica': lambda: f"{v} - {lk['rubrica'][v]}" if v in lk['rubrica'] else v,
        }.get(kind, lambda: str(v))()

    def tab_item(self, tab, item):
        lk = self.lk
        if tab == 'leito':
            return f"{item} - {lk['tipo_leito'].get(item, '')}"
        if tab == 'renases':
            return f"{item} - {lk['renases'].get(item, '')}"
        if tab == 'redes':
            return f"{item} - {(lk['componente_rede'].get(item) or [''])[0]}"
        if tab == 'incremento':
            return f"{mask_hab(item[0])} - {lk['habilitacao'].get(item[0], '')} (SH {item[1]}%, SA {item[2]}%, SP {item[3]}%)"
        if tab == 'origem_sia_sih':
            return f"{lk['tipo_sia_sih'].get(item[0], item[0])} {item[1]} - {item[2]}"
        if tab == 'grupo_habilitacao':
            return f"Grupo {item[0]}: {', '.join(mask_hab(h) for h in item[1])}"
        return ' - '.join(map(str, item)) if isinstance(item, list) else str(item)

    def list_item(self, m, item):
        if m['tipo'] == 'tab':
            return self.tab_item(m['tab'], item)
        code = mask_hab(item[0]) if m['relacao'] == 'HABILITACAO' else item[0]
        extra = ''
        if m['relacao'] == 'CID' and len(item) > 2 and item[2]:
            extra = ' (principal)' if item[2] == 'CID principal' else ' (secundário)'
        return f'{code} - {item[1] or ""}{extra}'

    def change(self, m):
        """Markup for one changed field."""
        if m['tipo'] == 'descricao':
            return (f"<b>{x(m['campo'])}</b> alterada.<br/><font color='#56635e'>Antes:</font> {x(m['antes'] or '—')}"
                    f"<br/><font color='#56635e'>Depois:</font> {x(m['depois'] or '—')}")
        if m['tipo'] in ('lista', 'tab'):
            lines = []
            for sign, color, items in (('+', '#1f5a45', m['incluidos']), ('−', '#8a3530', m['removidos'])):
                lines += [f"<font color='{color}'>{sign} {x(self.list_item(m, i))}</font>" for i in items[:LIST_MAX]]
                if len(items) > LIST_MAX:
                    lines.append(f"<font color='{color}'>{sign} … e mais {len(items) - LIST_MAX} "
                                 f"{'incluídos' if sign == '+' else 'removidos'} (lista completa na aba Novidades do site)</font>")
            return f"<b>{x(m['campo'])}</b><br/>" + '<br/>'.join(lines)
        return (f"<b>{x(m['campo'])}:</b> {x(self.value(m['tipo'], m['antes']))} → "
                f"<b>{x(self.value(m['tipo'], m['depois']))}</b>")


def by_portaria(entries):
    """OrderedDict portaria text -> [entries], in the order the note prints them."""
    groups = OrderedDict()
    for e in entries:
        groups.setdefault(portaria_key(e['portaria']), []).append(e)
    return groups


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data', type=Path, default=ROOT / 'data')
    ap.add_argument('--competencia')
    ap.add_argument('--out', type=Path)
    ap.add_argument('--estabelecimento', action='store_true',
                    help='marcar os procedimentos sem habilitação no estabelecimento (data/estabelecimento.json)')
    args = ap.parse_args()

    comp = args.competencia or load_json(args.data / 'novidades/index.json')[0]['competencia']
    nov = load_json(args.data / f'novidades/{comp}.json')
    if not nov.get('nota'):
        raise SystemExit(f'A competência {comp} não tem nota técnica cadastrada: o relatório usa a nota como base.')
    nota = load_json(ROOT / f'fontes/notas-tecnicas/{comp}.json')
    lk = load_json(args.data / 'lookups.json')
    procs = load_procs(args.data)
    # Habilitação marks only on request (--estabelecimento): the rules are still being checked.
    est_path = args.data / 'estabelecimento.json'
    est = load_json(est_path) if args.estabelecimento and est_path.exists() else None
    sem = est['sem_habilitacao'] if est else {}
    f = Fmt(lk)
    out = args.out or args.data / f'novidades/{comp}.pdf'

    alterados = {a['codigo']: a for a in nov['alterados']}
    novos = {n['codigo']: n for n in nov['novos']}
    revogados = {r['codigo']: r for r in nov['revogados']}
    compat = {(c['par'][0], c['par'][1], c['situacao']): c for c in nov['compatibilidades']}
    mark = lambda code: f'{NOHAB} ' if code in sem else ''
    name = lambda code: (procs.get(code) or {}).get('nome') or (revogados.get(code) or {}).get('nome') or ''
    nt = nov['nota']
    title = f'Mudanças na tabela SIGTAP — competência {comp_label(comp)}'
    story = [P(x(title), 'title'),
             P(f"Base principal: <b>Nota Técnica {x(nt['orgao'])} nº {x(nt['numero'])}, de {x(nt['data'])}</b>. "
               f"Os detalhes de cada mudança vêm da comparação entre as bases SIGTAP {comp_label(nov['anterior'])} e "
               f"{comp_label(comp)}.", 'subtitle')]

    # --- Resumo -------------------------------------------------------------
    r = nov['resumo']
    conf = {c['item']: c for c in nov['conferencia'] or []}
    divergences = sum(len(c['so_na_base']) + len(c['so_na_nota']) for c in conf.values())
    story.append(numbers([(fmt_int(r['novos']), 'procedimentos novos'), (fmt_int(r['revogados']), 'revogados'),
                          (fmt_int(r['alterados']), 'procedimentos alterados na base'),
                          (f"+{r['compat_incluidas']} / −{r['compat_removidas']}", 'compatibilidades')]))
    story.append(Spacer(1, 8))
    alt_only_base = [a for a in nov['alterados'] if not a['portarias']]
    rows = [['Seção da nota', 'Itens na nota', 'Na base', 'Observação'],
            ['Novos procedimentos', fmt_int(len(nota['novos'])), fmt_int(r['novos']), 'confere' if not conf['Procedimentos novos']['so_na_base'] + conf['Procedimentos novos']['so_na_nota'] else 'ver conferência'],
            ['Procedimentos revogados', fmt_int(len(nota['revogados'])), fmt_int(r['revogados']), 'confere' if not conf['Procedimentos revogados']['so_na_base'] + conf['Procedimentos revogados']['so_na_nota'] else 'ver conferência'],
            ['Alterações em procedimentos', fmt_int(len(nota['alterados'])), fmt_int(r['alterados']),
             f'{fmt_int(len(alt_only_base))} alterações da base sem item na nota (seção 6)' if alt_only_base else 'confere'],
            ['Novas compatibilidades', fmt_int(len(nota['compat_novas'])), fmt_int(r['compat_incluidas']), 'confere' if not conf['Compatibilidades incluídas']['so_na_base'] + conf['Compatibilidades incluídas']['so_na_nota'] else 'ver conferência'],
            ['Compatibilidades revogadas', fmt_int(len(nota['compat_revogadas'])), fmt_int(r['compat_removidas']),
             f"{sum(1 for c in nov['compatibilidades'] if c.get('decorrente_de'))} removidas junto com procedimento revogado"
             if any(c.get('decorrente_de') for c in nov['compatibilidades']) else 'confere']]
    story.append(table(rows, [52 * mm, 22 * mm, 20 * mm, CONTENT_WIDTH - 94 * mm]))
    story.append(Spacer(1, 6))
    story.append(box([P('<b>Conferência nota × base:</b> ' + (
        'nota e base conferem: tudo o que a nota lista está na base, e tudo o que mudou na base tem item na nota, '
        'exceto as alterações listadas na seção 6.' if not divergences else
        f'{divergences} divergência(s); ver seção 7.'), 'body')], bg=BRAND_SOFT))

    if est:
        hit_new = [c for c in novos if c in sem]
        hit_alt = [c for c in alterados if c in sem]
        story.append(Spacer(1, 6))
        story.append(box([P(f"{NOHAB} <b>Habilitações do estabelecimento (CNES {x(est['cnes'])}):</b> "
                            f"{len(hit_new)} dos {len(novos)} procedimentos novos e {len(hit_alt)} dos {len(alterados)} alterados "
                            f"exigem habilitação que o estabelecimento não tem (marcados com {NOHAB} ao longo do relatório). "
                            f"Habilitações conforme ficha do CNES de {x(est['data_ficha'])}.", 'body')], bg=ROSE_BG))

    # Portarias da nota
    story.append(P('Portarias citadas na nota', 'h2'))
    counts = OrderedDict()
    labels = [('novos', 'novos'), ('revogados', 'revogados'), ('alterados', 'alterados'),
              ('compat_novas', 'compat. novas'), ('compat_revogadas', 'compat. revogadas')]
    for sec, _ in labels:
        for e in nota[sec]:
            counts.setdefault(portaria_key(e['portaria']), OrderedDict()).setdefault(sec, 0)
            counts[portaria_key(e['portaria'])][sec] += 1
    rows = [['Portaria (como impressa na nota)', 'Itens']]
    for pk, c in counts.items():
        rows.append([x(pk), x(', '.join(f'{n} {lab}' for sec, lab in labels if (n := c.get(sec)))) ])
    story.append(table(rows, [70 * mm, CONTENT_WIDTH - 70 * mm]))

    # --- 1. Novos -------------------------------------------------------------
    def head(n, text):
        story.append(CondPageBreak(40 * mm))
        story.append(P(f'{n}. {x(text)}', 'h1'))

    head(1, 'Novos procedimentos')
    for pk, entries in by_portaria(nota['novos']).items():
        story.append(P(x(pk), 'h3'))
        rows = [['Código', 'Procedimento', 'Classificação', 'Valores']]
        for e in entries:
            p = procs.get(e['codigo'], {})
            vals = [f"SA {money(p.get('valor_sa') or 0)}", f"SH {money(p.get('valor_sh') or 0)}", f"SP {money(p.get('valor_sp') or 0)}"]
            rows.append([f"<font name='Mono'>{mask_proc(e['codigo'])}</font>",
                         f"{mark(e['codigo'])}{x(p.get('nome', '(fora da base)'))}",
                         x(f"{lk['complexidade'].get(p.get('complexidade'), '—')}; {lk['financiamento'].get(p.get('financiamento_codigo'), '—')}"),
                         '<br/>'.join(vals)])
        story.append(table(rows, [27 * mm, 68 * mm, 44 * mm, CONTENT_WIDTH - 139 * mm], style='cell_small'))

    # --- 2. Revogados ----------------------------------------------------------
    head(2, 'Procedimentos revogados')
    for pk, entries in by_portaria(nota['revogados']).items():
        story.append(P(x(pk), 'h3'))
        rows = [['Código', 'Procedimento (nome na base anterior)']]
        rows += [[f"<font name='Mono'>{mask_proc(e['codigo'])}</font>", x(name(e['codigo']))] for e in entries]
        story.append(table(rows, [27 * mm, CONTENT_WIDTH - 27 * mm]))

    # --- 3. Alterações -----------------------------------------------------------
    def alter_rows(codes):
        rows = [['Código', 'Procedimento', 'O que mudou na base']]
        for code in codes:
            a = alterados.get(code)
            changes = '<br/>'.join(f.change(m) for m in a['mudancas']) if a else '<i>sem mudança encontrada na base</i>'
            rows.append([f"<font name='Mono'>{mask_proc(code)}</font>", f'{mark(code)}{x(name(code))}', changes])
        return table(rows, [27 * mm, 52 * mm, CONTENT_WIDTH - 79 * mm], style='cell_small')

    head(3, 'Alterações em procedimentos')
    for pk, entries in by_portaria(nota['alterados']).items():
        story.append(P(f'{x(pk)} — {len(entries)} procedimento(s)', 'h3'))
        story.append(alter_rows([e['codigo'] for e in entries]))

    # --- 4 / 5. Compatibilidades ----------------------------------------------
    def compat_rows(entries, situacao):
        rows = [['Principal', 'Compatível', 'Registro', 'Tipo', 'Qtd.']]
        previous = None
        for e in entries:
            c = compat.get((e['principal'], e['compativel'], situacao))
            tipo = lk['tipo_compatibilidade'].get(str(c['par'][4]), f"Tipo {c['par'][4]}") if c else (e['registro'] or {}).get('tipo', '')
            reg = (f"{lk['registro'].get(c['par'][2], c['par'][2])} → {lk['registro'].get(c['par'][3], c['par'][3])}" if c
                   else f"{(e['registro'] or {}).get('principal', '')} → {(e['registro'] or {}).get('compativel', '')}")
            qt = c['par'][5] if c else e['qtd']
            same = e['principal'] == previous   # the note lists the pairs under each principal; so does the report
            previous = e['principal']
            rows.append(['' if same else f"<font name='Mono'>{mask_proc(e['principal'])}</font><br/>{mark(e['principal'])}{x(name(e['principal']))}",
                         f"<font name='Mono'>{mask_proc(e['compativel'])}</font><br/>{mark(e['compativel'])}{x(name(e['compativel']))}",
                         x(reg), x(tipo), '—' if qt is None else str(qt)])
        return table(rows, [54 * mm, 56 * mm, 36 * mm, 22 * mm, CONTENT_WIDTH - 168 * mm], style='cell_small')

    head(4, 'Novas compatibilidades')
    for pk, entries in by_portaria(nota['compat_novas']).items():
        story.append(P(f'{x(pk)} — {len(entries)} par(es)', 'h3'))
        story.append(compat_rows(entries, 'incluida'))

    head(5, 'Compatibilidades revogadas')
    for pk, entries in by_portaria(nota['compat_revogadas']).items():
        story.append(P(f'{x(pk)} — {len(entries)} par(es)', 'h3'))
        story.append(compat_rows(entries, 'removida'))
    extra = [c for c in nov['compatibilidades'] if c.get('decorrente_de')]
    if extra:
        story.append(P('Removidas junto com um procedimento revogado (não listadas na nota)', 'h3'))
        story.append(P('Os pares abaixo saíram da base porque um dos procedimentos foi revogado; recebem a portaria da revogação.', 'small'))
        story.append(compat_rows([{'principal': c['par'][0], 'compativel': c['par'][1], 'registro': None, 'qtd': None} for c in extra], 'removida'))

    # --- 6. Só na base ---------------------------------------------------------
    head(6, 'Alterações na base sem item na nota')
    if alt_only_base:
        story.append(P('Mudanças que a comparação entre as bases encontrou e a nota técnica não lista. '
                       'Não são divergência: a nota lista portarias; a base traz todas as mudanças.', 'small'))
        story.append(alter_rows([a['codigo'] for a in alt_only_base]))
    else:
        story.append(P('Nenhuma.', 'body'))

    # --- 7. Conferência ---------------------------------------------------------
    head(7, 'Conferência nota × base')
    rows = [['Item', 'Só na base', 'Só na nota']]
    for c in nov['conferencia'] or []:
        rows.append([x(c['item']), x(', '.join(c['so_na_base']) or 'nenhum'), x(', '.join(c['so_na_nota']) or 'nenhum')])
    story.append(table(rows, [52 * mm, (CONTENT_WIDTH - 52 * mm) / 2, (CONTENT_WIDTH - 52 * mm) / 2]))

    story.append(Spacer(1, 10))
    story.append(P(f"<b>Fontes.</b> Nota Técnica {x(nt['orgao'])} nº {x(nt['numero'])} ({x(nt['arquivo'])}, SHA-256 {x(nt['sha256'][:16])}…); "
                   f"bases SIGTAP {comp_label(nov['anterior'])} e {comp_label(comp)} exportadas do DuckDB. Nomes e textos como na base. "
                   'Gerado por scripts/relatorio_competencia.py a partir de data/novidades; os mesmos dados geram o mesmo arquivo.', 'small'))
    build(out, story, f'SIGTAP {comp_label(comp)} · Nota Técnica {nt["orgao"]} nº {nt["numero"]}')
    print(f'Relatório da competência {comp}: {out}')


if __name__ == '__main__':
    main()
