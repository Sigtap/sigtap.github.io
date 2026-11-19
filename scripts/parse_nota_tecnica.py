#!/usr/bin/env python3
"""Read a CGSI "Nota Técnica" PDF (SIGTAP monthly changes) into JSON.

The note is complementary to the SIGTAP base: it says which PORTARIA
published each change. This script keeps only what the base does not have:
section, procedure code, portaria and (for compatibilities) the registro pair,
type and quantity as printed. Names, values and links shown on the site still
come from the base.

Needs `pdftotext` (poppler-utils) on the PATH.

Usage:
  python scripts/parse_nota_tecnica.py NOTA.pdf --competencia 202610 \
      --out fontes/notas-tecnicas/202610.json
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

SECTIONS = {
    'Novos Procedimentos': 'novos',
    'Procedimentos Revogados': 'revogados',
    'Alterações em Procedimentos': 'alterados',
    'Novas Compatibilidades': 'compat_novas',
    'Compatibilidades Revogadas': 'compat_revogadas',
}
TITLE = re.compile(r'NOTA TÉCNICA nº\s*(\d+/\d{4})\s+de\s+(\d\d/\d\d/\d{4})\s*-\s*(\w+)')
PORTARIA = re.compile(r'^PORTARIA nº\s*(.+?)\s+de\s+(\d\d/\d\d/\d{4})\s*-\s*(\w+)$')
PROC = re.compile(r'^(\d\d\.\d\d\.\d\d\.\d{3}-\d)\s+-\s+')
COMPAT_ITEM = re.compile(r'^(\d{10})\s+-\s+')
QTD = re.compile(r'^Qtd:\s*(\d+)$')
REGISTRO = re.compile(r'^(.+?\)) x (.+?\)) \(([^()]+)\)$')
NOISE = re.compile(r'^(Página \d+ de \d+|NOTA TÉCNICA nº .* - \w+)$')


def pdf_text(path):
    try:
        return subprocess.run(['pdftotext', '-layout', str(path), '-'], check=True,
                              capture_output=True, text=True, encoding='utf-8').stdout
    except FileNotFoundError:
        sys.exit('pdftotext não encontrado: instale poppler-utils (Linux) ou poppler (Windows) e tente de novo.')


def unmask(code):
    return re.sub(r'\D', '', code)


def join_wrapped_registro(rows):
    """A registro header can wrap: "... x ... (Concomitantes - APACs diferentes para o mesmo" + "paciente)"."""
    out, i = [], 0
    while i < len(rows):
        indent, line = rows[i]
        if ') x ' in line and line.count('(') > line.count(')') and i + 1 < len(rows) and rows[i + 1][1]:
            line = f'{line} {rows[i + 1][1]}'
            i += 1
        out.append((indent, line))
        i += 1
    return out


def parse(text):
    rows = join_wrapped_registro([(len(l) - len(l.lstrip()), l.strip()) for l in text.splitlines()])
    title = TITLE.search(text)
    if not title:
        sys.exit('Cabeçalho "NOTA TÉCNICA nº ... de ... - ..." não encontrado.')
    note = {'numero': title.group(1), 'data': title.group(2), 'orgao': title.group(3),
            **{key: [] for key in SECTIONS.values()}}
    section = portaria = registro = None
    current = None
    principal = None        # compat sections: principal procedure
    prev_indent = None      # indent of the previous text line (None after a blank line or page header)
    prev_header = False     # the previous line opened an item
    for indent, line in rows:
        if not line or NOISE.match(line) or '....' in line:
            prev_indent = None
            continue
        if line in SECTIONS:
            section, portaria, registro, current, principal = SECTIONS[line], None, None, None, None
            prev_indent, prev_header = None, False
            continue
        if section is None:
            continue
        m = PORTARIA.match(line)
        if m:
            portaria = {'numero': m.group(1), 'data': m.group(2), 'orgao': m.group(3)}
            current = principal = None
            prev_indent, prev_header = None, False
            continue
        if section.startswith('compat'):
            m = REGISTRO.match(line)
            if m:
                registro = {'principal': m.group(1), 'compativel': m.group(2), 'tipo': m.group(3)}
                principal = None
                continue
            m = PROC.match(line)
            if m:
                principal = unmask(m.group(1))
                continue
            m = COMPAT_ITEM.match(line)
            if m and principal:
                note[section].append({'principal': principal, 'compativel': m.group(1),
                                      'registro': registro, 'qtd': None, 'portaria': portaria})
                continue
            m = QTD.match(line)
            if m and note[section]:
                note[section][-1]['qtd'] = int(m.group(1))
            continue
        m = PROC.match(line)
        # "99.99.99.999-9 - NAME" with the indent of the description text just above is a citation
        # inside that description, not a new item. A line right after another item's header is an item.
        citation = bool(m) and not prev_header and prev_indent == indent
        if m and not citation:
            current = {'codigo': unmask(m.group(1)), 'portaria': portaria}
            note[section].append(current)
        prev_indent, prev_header = indent, bool(m) and not citation
    return note


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('pdf', type=Path)
    ap.add_argument('--competencia', required=True, help='AAAAMM a que a nota se refere')
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    note = parse(pdf_text(args.pdf))
    note['competencia'] = args.competencia
    note['arquivo'] = args.pdf.name
    note['sha256'] = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(note, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    counts = {k: len(note[k]) for k in SECTIONS.values()}
    print(f'Nota Técnica nº {note["numero"]} ({note["data"]}): {counts}')


if __name__ == '__main__':
    main()
