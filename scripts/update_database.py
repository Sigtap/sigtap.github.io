"""Select a DuckDB, validate in staging, then update the site's generated data."""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('database', nargs='?', type=Path)
parser.add_argument('--nota', type=Path, help='PDF da Nota Técnica da competência (portarias das mudanças)')
args = parser.parse_args()
if args.database is None:
    from tkinter import Tk, filedialog
    window = Tk(); window.withdraw()
    selected = filedialog.askopenfilename(title='Selecionar base SIGTAP', filetypes=[('DuckDB', '*.duckdb')])
    window.destroy()
    if not selected:
        sys.exit('Nenhum arquivo selecionado; nenhuma alteração.')
    args.database = Path(selected)
with tempfile.TemporaryDirectory() as folder:
    staging = Path(folder)/'data'
    subprocess.run([sys.executable, str(ROOT/'scripts/export_web.py'), str(args.database), '--output', str(staging)], check=True)
    subprocess.run([sys.executable, str(ROOT/'scripts/build-relations.py'), '--data', str(staging)], check=True)
    # Ficha fields and tabs (permanência, pontos, leito, incremento, origem, Renases, compatibilidades…) and lookups.json.
    subprocess.run([sys.executable, str(ROOT/'scripts/export_ficha.py'), '--db', str(args.database), '--data', str(staging)], check=True)
    # Novidades: diff between the published data/ and the staging export; portarias from the Nota Técnica.
    comp_old = json.loads((ROOT/'data/index.json').read_text(encoding='utf-8'))['competencia']
    comp_new = json.loads((staging/'index.json').read_text(encoding='utf-8'))['competencia']
    notas = ROOT/'fontes/notas-tecnicas'
    if args.nota:
        notas.mkdir(parents=True, exist_ok=True)
        pdf = notas/args.nota.name
        if args.nota.resolve() != pdf.resolve():
            shutil.copy2(args.nota, pdf)
        subprocess.run([sys.executable, str(ROOT/'scripts/parse_nota_tecnica.py'), str(pdf),
                        '--competencia', comp_new, '--out', str(notas/f'{comp_new}.json')], check=True)
    if comp_new > comp_old:
        command = [sys.executable, str(ROOT/'scripts/build_novidades.py'), '--anterior', str(ROOT/'data'), '--atual', str(staging)]
        if (notas/f'{comp_new}.json').exists():
            command += ['--nota', str(notas/f'{comp_new}.json')]
        subprocess.run(command, check=True)
    elif (ROOT/'data/novidades').exists():
        shutil.copytree(ROOT/'data/novidades', staging/'novidades')   # same competência re-exported: keep what was published
    backup = ROOT/'data-backup'
    if backup.exists():
        sys.exit('data-backup já existe. Preserve ou renomeie essa pasta antes de atualizar novamente.')
    shutil.copytree(ROOT/'data', backup)
    try:
        for path in (ROOT/'data').glob('*.json'):
            path.unlink()
        for path in staging.glob('*.json'):
            shutil.copy2(path, ROOT/'data'/path.name)
        if (staging/'novidades').exists():
            shutil.rmtree(ROOT/'data/novidades', ignore_errors=True)
            shutil.copytree(staging/'novidades', ROOT/'data/novidades')
    except Exception:
        shutil.rmtree(ROOT/'data')
        shutil.copytree(backup, ROOT/'data')
        raise
print('Base validada e atualizada localmente. Revise data/validation.json antes de enviar ao GitHub. Backup em data-backup/.')
