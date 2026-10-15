#!/usr/bin/env python3
"""Add the SIGTAP "ficha" data to the site's JSON export.

Reads the SIGTAP DuckDB (read-only) and:
  * augments every data/group-XX.json in place with a per-procedure key "sigtap"
    (existing keys and values are left exactly as they are; the new key is
    appended last and omitted when the procedure has nothing to add);
  * writes data/lookups.json with the code -> label tables the ficha needs.

Data contract (documented below and in README.md):

  "sigtap": {
    "dias_permanencia": 7,        QT_DIAS_PERMANENCIA, omitted when 9999
    "tempo_permanencia": 3,       QT_TEMPO_PERMANENCIA, omitted when 9999
    "pontos": 200,                QT_PONTOS, omitted when 0
    "rubrica": "040066",          CO_RUBRICA, omitted when null
    "tabs": {                     only non-empty lists are present
      "leito": ["01","07"],
      "habilitacao": ["3802"],                  rows with NU_GRUPO_HABILITACAO null
      "grupo_habilitacao": [["0001",["0801","0803"]]],
      "incremento": [["2701",20,0,20]],         [hab, %SH, %SA, %SP] = VL_PERCENTUAL_*/100
      "origem_sigtap": ["0301070016"],
      "origem_sia_sih": [["H","33021066","ENTERECTOMIA"]],  joined on (code, TP)
      "redes": ["95.02"],
      "renases": ["138"],
      "tuss": ["..."],
      "compat":    [["0702050040","03","04",1,1]],  [compatível, reg_princ, reg_compat, tipo, qt]
      "compat_de": [["0407020179","03","04",1,1]]   [principal,  reg_princ, reg_compat, tipo, qt]
    }
  }

Every list is sorted by code, so the output is deterministic, and re-running the
script on its own output gives byte-identical files (files are rewritten only
when their content changes). index.json, catalog.json and relations-index.json
are never opened for writing.

Usage:
  python3 -I tools/export_ficha.py [--db PATH] [--data DIR] [--check]
    --check  compute everything and report what would change, write nothing.
"""
import argparse
import csv
import io
import collections
import json
import os
import pathlib
import sys

import duckdb

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_DATA = HERE.parent / 'data'

SENTINEL = 9999
TAB_ORDER = ('leito', 'habilitacao', 'grupo_habilitacao', 'incremento', 'origem_sigtap',
             'origem_sia_sih', 'redes', 'renases', 'tuss', 'compat', 'compat_de')

# Code tables that have no lookup table in the DuckDB.
SEXO = {'I': 'Ambos', 'M': 'Masculino', 'F': 'Feminino', 'N': 'Não se aplica'}
COMPLEXIDADE = {'0': 'Não se aplica', '1': 'Atenção Básica Complexidade',
                '2': 'Média Complexidade', '3': 'Alta Complexidade'}
TIPO_SIA_SIH = {'A': 'Ambulatorial', 'H': 'Hospitalar'}
# Only tipo 1 is confirmed on the SIGTAP screens; the UI shows "Tipo N" for 2-5.
TIPO_COMPATIBILIDADE = {'1': 'Compatível'}


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


def pct(value):
    """VL_PERCENTUAL_* is stored x100 (2000 = 20.0 %). Whole numbers stay ints."""
    value = int(value)
    return value // 100 if value % 100 == 0 else value / 100


def build(con):
    q = lambda sql: con.execute(sql).fetchall()

    competencias = q('select distinct DT_COMPETENCIA from tb_procedimento')
    if len(competencias) != 1:
        raise SystemExit(f'expected one competência in tb_procedimento, got {competencias}')
    competencia = competencias[0][0]

    procs = {}
    for code, dias, tempo, pontos, rubrica in q(
            'select CO_PROCEDIMENTO, QT_DIAS_PERMANENCIA, QT_TEMPO_PERMANENCIA, QT_PONTOS, CO_RUBRICA '
            'from tb_procedimento order by CO_PROCEDIMENTO'):
        s = {}
        if dias is not None and dias != SENTINEL:
            s['dias_permanencia'] = int(dias)
        if tempo is not None and tempo != SENTINEL:
            s['tempo_permanencia'] = int(tempo)
        if pontos:
            s['pontos'] = int(pontos)
        if rubrica:
            s['rubrica'] = rubrica
        procs[code] = s

    tabs = collections.defaultdict(lambda: collections.defaultdict(list))

    def add(name, rows, fn):
        for row in rows:
            tabs[row[0]][name].append(fn(row))

    add('leito', q('select CO_PROCEDIMENTO, CO_TIPO_LEITO from rl_procedimento_leito order by 1, 2'),
        lambda r: r[1])
    add('habilitacao', q('select CO_PROCEDIMENTO, CO_HABILITACAO from rl_procedimento_habilitacao '
                         'where NU_GRUPO_HABILITACAO is null order by 1, 2'),
        lambda r: r[1])
    grouped = collections.defaultdict(lambda: collections.defaultdict(list))
    for code, nu, hab in q('select CO_PROCEDIMENTO, NU_GRUPO_HABILITACAO, CO_HABILITACAO '
                           'from rl_procedimento_habilitacao where NU_GRUPO_HABILITACAO is not null '
                           'order by 1, 2, 3'):
        grouped[code][nu].append(hab)
    for code, by_nu in grouped.items():
        tabs[code]['grupo_habilitacao'] = [[nu, habs] for nu, habs in sorted(by_nu.items())]
    add('incremento', q('select CO_PROCEDIMENTO, CO_HABILITACAO, VL_PERCENTUAL_SH, VL_PERCENTUAL_SA, '
                        'VL_PERCENTUAL_SP from rl_procedimento_incremento order by 1, 2'),
        lambda r: [r[1], pct(r[2]), pct(r[3]), pct(r[4])])
    add('origem_sigtap', q('select CO_PROCEDIMENTO, CO_PROCEDIMENTO_ORIGEM from rl_procedimento_origem '
                           'order by 1, 2'),
        lambda r: r[1])
    # tb_sia_sih is only unique on (code, TP): 90 legacy codes exist as both A and H.
    add('origem_sia_sih', q('select r.CO_PROCEDIMENTO, r.TP_PROCEDIMENTO, r.CO_PROCEDIMENTO_SIA_SIH, '
                            's.NO_PROCEDIMENTO_SIA_SIH from rl_procedimento_sia_sih r '
                            'left join tb_sia_sih s on s.CO_PROCEDIMENTO_SIA_SIH = r.CO_PROCEDIMENTO_SIA_SIH '
                            'and s.TP_PROCEDIMENTO = r.TP_PROCEDIMENTO '
                            'order by r.CO_PROCEDIMENTO, r.CO_PROCEDIMENTO_SIA_SIH, r.TP_PROCEDIMENTO'),
        lambda r: [r[1], r[2], r[3]])
    add('redes', q('select CO_PROCEDIMENTO, CO_COMPONENTE_REDE from rl_procedimento_comp_rede order by 1, 2'),
        lambda r: r[1])
    add('renases', q('select CO_PROCEDIMENTO, CO_RENASES from rl_procedimento_renases order by 1, 2'),
        lambda r: r[1])
    add('tuss', q('select CO_PROCEDIMENTO, CO_TUSS from rl_procedimento_tuss order by 1, 2'),
        lambda r: r[1])
    compat = q('select CO_PROCEDIMENTO_PRINCIPAL, CO_PROCEDIMENTO_COMPATIVEL, CO_REGISTRO_PRINCIPAL, '
               'CO_REGISTRO_COMPATIVEL, TP_COMPATIBILIDADE, QT_PERMITIDA from rl_procedimento_compativel')
    item = lambda other, r: [other, r[2], r[3], int(r[4]), int(r[5])]
    for r in sorted(compat, key=lambda r: (r[0], r[1], r[2], r[3], int(r[4]), r[5])):
        tabs[r[0]]['compat'].append(item(r[1], r))
    for r in sorted(compat, key=lambda r: (r[1], r[0], r[2], r[3], int(r[4]), r[5])):
        tabs[r[1]]['compat_de'].append(item(r[0], r))

    unknown = set(tabs) - set(procs)
    if unknown:
        raise SystemExit(f'relations reference procedures missing from tb_procedimento: {sorted(unknown)[:10]}')
    for code, by_tab in tabs.items():
        ordered = {name: by_tab[name] for name in TAB_ORDER if by_tab.get(name)}
        if ordered:
            procs[code]['tabs'] = ordered

    def table(sql):
        return {row[0]: (row[1] if len(row) == 2 else list(row[1:])) for row in sorted(q(sql))}

    familia = collections.Counter(code[:4] for (code,) in q('select CO_OCUPACAO from tb_ocupacao'))
    lookups = {
        'competencia': competencia,
        'sexo': SEXO,
        'complexidade': COMPLEXIDADE,
        'financiamento': table('select CO_FINANCIAMENTO, NO_FINANCIAMENTO from tb_financiamento'),
        'rubrica': table('select CO_RUBRICA, NO_RUBRICA from tb_rubrica'),
        'modalidade': table('select CO_MODALIDADE, NO_MODALIDADE from tb_modalidade'),
        'registro': table('select CO_REGISTRO, NO_REGISTRO from tb_registro'),
        'detalhe': table('select d.CO_DETALHE, d.NO_DETALHE, dd.DS_DETALHE from tb_detalhe d '
                         'left join tb_descricao_detalhe dd on dd.CO_DETALHE = d.CO_DETALHE'),
        'tipo_leito': table('select CO_TIPO_LEITO, NO_TIPO_LEITO from tb_tipo_leito'),
        'habilitacao': table('select CO_HABILITACAO, NO_HABILITACAO from tb_habilitacao'),
        'grupo_habilitacao': table('select NU_GRUPO_HABILITACAO, NO_GRUPO_HABILITACAO, DS_GRUPO_HABILITACAO '
                                   'from tb_grupo_habilitacao'),
        'renases': table('select CO_RENASES, NO_RENASES from tb_renases'),
        'componente_rede': table('select CO_COMPONENTE_REDE, NO_COMPONENTE_REDE, CO_REDE_ATENCAO '
                                 'from tb_componente_rede'),
        'rede_atencao': table('select CO_REDE_ATENCAO, NO_REDE_ATENCAO from tb_rede_atencao'),
        'regra_condicionada': table('select CO_REGRA_CONDICIONADA, NO_REGRA_CONDICIONADA, DS_REGRA_CONDICIONADA '
                                    'from tb_regra_condicionada'),
        'tipo_sia_sih': TIPO_SIA_SIH,
        'tipo_compatibilidade': TIPO_COMPATIBILIDADE,
        'cbo_familia_total': dict(sorted(familia.items())),
    }
    return procs, lookups


def read_cbo_familias(path, known):
    """Family titles from the official MTE file (not in the SIGTAP base). Fails on unknown layouts."""
    raw = path.read_bytes()
    for encoding in ('utf-8-sig', 'cp1252'):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    rows = list(csv.reader(io.StringIO(text), delimiter=';'))
    header = [h.strip().upper() for h in rows[0]]
    if header[:2] != ['CODIGO', 'TITULO']:
        raise SystemExit(f'{path.name}: expected header CODIGO;TITULO, got {rows[0]}')
    names = {r[0].strip(): r[1].strip() for r in rows[1:] if len(r) >= 2 and r[0].strip()}
    missing = sorted(set(known) - set(names))
    print(f'cbo_familia_nome: {len(names)} titles from {path.name}; {len(missing)} SIGTAP families without a title {missing[:10]}')
    return {code: names[code] for code in sorted(known) if code in names}


def write_if_changed(path, text, check):
    data = text.encode('utf-8')
    old = path.read_bytes() if path.exists() else None
    if old == data:
        return 'unchanged', 0 if old is None else len(old), len(data)
    if not check:
        tmp = path.with_name(path.name + '.tmp')
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return ('would change' if check else 'written'), (0 if old is None else len(old)), len(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--db', required=True, help='SIGTAP DuckDB (opened read-only)')
    ap.add_argument('--data', default=str(DEFAULT_DATA))
    ap.add_argument('--check', action='store_true', help='report changes without writing')
    ap.add_argument('--cbo-familias', help='official CBO 2002 family titles (MTE "CBO2002 - Familia.csv": CODIGO;TITULO)')
    args = ap.parse_args()
    data_dir = pathlib.Path(args.data)

    con = duckdb.connect(args.db, read_only=True)
    try:
        procs, lookups = build(con)
    finally:
        con.close()

    seen = set()
    base_total = new_total = 0
    for path in sorted(data_dir.glob('group-[0-9][0-9].json')):
        group = json.loads(path.read_text(encoding='utf-8'))
        for code, proc in group.items():
            if code not in procs:
                raise SystemExit(f'{path.name}: {code} is not in tb_procedimento')
            seen.add(code)
            proc.pop('sigtap', None)          # idempotent: rebuild from the DB every run
            if procs[code]:
                proc['sigtap'] = procs[code]
        status, before, after = write_if_changed(path, dump(group), args.check)
        base_total += before
        new_total += after
        print(f'{path.name}: {len(group)} procedures, {before} -> {after} bytes ({status})')
    missing = set(procs) - seen
    if missing:
        raise SystemExit(f'{len(missing)} procedures from tb_procedimento are in no group file, e.g. {sorted(missing)[:5]}')

    if args.cbo_familias:
        lookups['cbo_familia_nome'] = read_cbo_familias(pathlib.Path(args.cbo_familias), lookups['cbo_familia_total'])
    status, before, after = write_if_changed(data_dir / 'lookups.json', dump(lookups), args.check)
    print(f'lookups.json: {before} -> {after} bytes ({status})')
    with_sigtap = sum(1 for s in procs.values() if s)
    print(f'{with_sigtap}/{len(procs)} procedures carry a "sigtap" block; group files {base_total} -> {new_total} bytes')


if __name__ == '__main__':
    sys.exit(main())
