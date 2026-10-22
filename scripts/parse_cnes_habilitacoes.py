#!/usr/bin/env python3
"""Read the habilitações of a CNES "Ficha de Estabelecimento" PDF into JSON.

Only what the SIGTAP base cannot know is kept: which habilitações the
establishment holds and for which competências. Names shown on the site still
come from the SIGTAP base (tb_habilitacao).

Needs `pdftotext` (poppler-utils) on the PATH.

Usage:
  python scripts/parse_cnes_habilitacoes.py FICHA.pdf --out fontes/cnes/3157245.json
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

CNES = re.compile(r'CNES:\s*(\d{7})\s+Nome Fantasia:\s*(.+?)\s{2,}')
DATA = re.compile(r'Data:\s*(\d\d/\d\d/\d{4})')
HAB = re.compile(r'^\s*(\d{4})\s+.*?\b(NACIONAL|LOCAL)\s+(\d\d/\d{4})\s+(\d\d/\d{4})\b')


def pdf_text(path):
    try:
        return subprocess.run(['pdftotext', '-layout', str(path), '-'], check=True,
                              capture_output=True, text=True, encoding='utf-8').stdout
    except FileNotFoundError:
        sys.exit('pdftotext não encontrado: instale poppler-utils (Linux) ou poppler (Windows) e tente de novo.')


def competencia(mm_aaaa):
    """'07/2004' -> '200407'; '99/9999' (sem fim) -> None."""
    mm, aaaa = mm_aaaa.split('/')
    return None if aaaa == '9999' else aaaa + mm


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('pdf', type=Path)
    ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args()
    text = pdf_text(args.pdf)
    head, data = CNES.search(text), DATA.search(text)
    if not head or not data:
        sys.exit('Cabeçalho "CNES: ... Nome Fantasia: ..." ou "Data:" não encontrado.')
    habs = []
    for line in text.splitlines():
        m = HAB.match(line)
        if m:
            habs.append({'codigo': m.group(1), 'origem': m.group(2),
                         'competencia_inicial': competencia(m.group(3)), 'competencia_final': competencia(m.group(4))})
    if not habs:
        sys.exit('Nenhuma habilitação encontrada na ficha.')
    out = {'cnes': head.group(1), 'nome_fantasia': head.group(2).strip(), 'data_ficha': data.group(1),
           'arquivo': args.pdf.name, 'sha256': hashlib.sha256(args.pdf.read_bytes()).hexdigest(),
           'habilitacoes': habs}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'CNES {out["cnes"]} ({out["data_ficha"]}): {len(habs)} habilitações')


if __name__ == '__main__':
    main()
