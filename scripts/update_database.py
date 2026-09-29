"""Select a DuckDB, validate in staging, then update the site's generated data."""
import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('database', nargs='?', type=Path)
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
    backup = ROOT/'data-backup'
    if backup.exists():
        sys.exit('data-backup já existe. Preserve ou renomeie essa pasta antes de atualizar novamente.')
    shutil.copytree(ROOT/'data', backup)
    try:
        for path in (ROOT/'data').glob('*.json'):
            path.unlink()
        for path in staging.glob('*.json'):
            shutil.copy2(path, ROOT/'data'/path.name)
    except Exception:
        shutil.rmtree(ROOT/'data')
        shutil.copytree(backup, ROOT/'data')
        raise
print('Base validada e atualizada localmente. Revise data/validation.json antes de enviar ao GitHub. Backup em data-backup/.')
