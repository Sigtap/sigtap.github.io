# SIGTAP Explorador

Consulta pública em https://sigtap.github.io/ com busca de procedimentos, grupo/subgrupo/forma, CID e CBO por código ou descrição e detalhes automáticos. CID e CBO simultâneos cruzam os vínculos (ambos devem estar presentes). Uma sugestão selecionada consulta o código exato; texto livre reúne os códigos correspondentes. Outros filtros continuam ativos.

A competência e os totais são lidos de `data/index.json`. A fonte é o DuckDB fornecido pelo responsável. A importação original não foi reconciliada com os TXT oficiais. Vínculos não substituem outras regras de faturamento; ausência de vínculo não indica dispensa.

## Atualizar com outro DuckDB

Use uma base SIGTAP nativa com uma única competência e estrutura compatível com o MVP.

1. Instale Python e execute `python -m pip install -r requirements.txt` na pasta do projeto.
2. Execute `python scripts/update_database.py` e escolha o `.duckdb` na janela. Alternativa: `python scripts/update_database.py "caminho/base.duckdb"`.
3. A exportação ocorre em pasta temporária. Falhas na validação impedem a troca. A base anterior fica em `data-backup/` e nunca é enviada pelo Git.
4. Revise `data/validation.json`, teste a interface com `python -m http.server 8000` e execute `node scripts/test-relations.cjs` se tiver Node instalado.
5. Envie as mudanças em `data/` ao GitHub. O Pages publica a branch `main`, pasta raiz.

O arquivo DuckDB não precisa ser publicado; somente o catálogo exportado. A interface pública ainda não oferece upload administrativo nem atualização automática agendada. A competência exibida acompanha os dados exportados.

O gerador pode ser usado futuramente em GitHub Actions: `python scripts/export_web.py base.duckdb --output staging/data`, seguido de `python scripts/build-relations.py --data staging/data`. Revise e publique os arquivos somente após sucesso das validações.
