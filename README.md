# SIGTAP Explorador

Consulta pública em https://sigtap.github.io/ com busca de procedimentos, grupo/subgrupo/forma, CID e CBO por código ou descrição e detalhes automáticos. CID e CBO simultâneos cruzam os vínculos (ambos devem estar presentes). Uma sugestão selecionada consulta o código exato; texto livre reúne os códigos correspondentes. Outros filtros continuam ativos.

A competência e os totais são lidos de `data/index.json`. A fonte é o DuckDB fornecido pelo responsável. A importação original não foi reconciliada com os TXT oficiais. Vínculos não substituem outras regras de faturamento; ausência de vínculo não indica dispensa.

## Estrutura da página

- `page.html` é a fonte da página; `python scripts/build_page.py` gera o `index.html` publicado (rode após editar `page.html`; `--check` confere se está atualizado).
- `app.js` e `style.css`: ficha no formato SIGTAP (atributos em ordem fixa, Valores, abas de vínculos) e relatórios com download em PDF e CSV.
- `vendor/`: jsPDF 2.5.1 e jsPDF-AutoTable 3.8.2 (MIT), carregados só ao gerar um PDF.
- `historico/`: layouts anteriores, preservados.

## De onde vem cada dado

Tudo vem do DuckDB, por script, de forma determinística: rodar o fluxo de novo com a mesma base gera os mesmos arquivos, byte a byte.

- `scripts/export_web.py`: procedimentos, hierarquia, vínculos (CID, CBO, instrumento, modalidade, atributos, habilitação, serviço, compatibilidade, regra condicionada) e `validation.json`.
- `scripts/build-relations.py`: índice reverso CID/CBO.
- `scripts/export_ficha.py`: chave `sigtap` de cada procedimento (média e tempo de permanência, pontos, subtipo de financiamento, leito, habilitações e grupos, incremento, origem SIGTAP e SIA/SIH, redes, Renases, TUSS, compatibilidades nos dois sentidos) e `data/lookups.json`.
- `scripts/build_novidades.py`: aba "Novidades" (`data/novidades/`). Compara a exportação publicada com a nova, campo a campo: procedimentos novos, revogados e alterados, e compatibilidades incluídas ou removidas.
- `scripts/parse_nota_tecnica.py`: lê a Nota Técnica da competência (PDF da CGSI) e guarda em `fontes/notas-tecnicas/AAAAMM.json` só o que a base não tem: a portaria de cada mudança. A aba Novidades mostra essa portaria e confere nota × base (itens que aparecem só em uma das duas).

A página só formata (código 04.07.02.017-9, idade em anos, 9999 como "Não se aplica", Total Hospitalar = SH + SP). O modo "Legível" muda apenas maiúsculas e minúsculas; "Original" mostra o texto exato da base. As "Categorias" de CBO são as famílias CBO (4 dígitos) com todas as ocupações vinculadas; os títulos das famílias não estão na base SIGTAP e vêm de `fontes/` (ver `fontes/README.md`); A Nota Técnica é complementar à base: dela vêm só as portarias da aba Novidades e o rótulo do tipo 2 de compatibilidade ("Excludente"), que a base não traz.

## Atualizar com outro DuckDB

Use uma base SIGTAP nativa com uma única competência e estrutura compatível com o MVP.

1. Instale Python e execute `python -m pip install -r requirements.txt` na pasta do projeto.
2. Execute `python scripts/update_database.py` e escolha o `.duckdb` na janela. Alternativa: `python scripts/update_database.py "caminho/base.duckdb"`. Com a Nota Técnica da competência: `python scripts/update_database.py "caminho/base.duckdb" --nota "caminho/nota_tecnica.pdf"` (o PDF é copiado para `fontes/notas-tecnicas/`). A aba Novidades compara com a competência que estava publicada; sem `--nota`, ela sai sem as portarias. Requer `pdftotext` (poppler) para ler o PDF.
3. A exportação ocorre em pasta temporária. Falhas na validação impedem a troca. A base anterior fica em `data-backup/` e nunca é enviada pelo Git.
4. Revise `data/validation.json`, teste a interface com `python -m http.server 8000` e execute `node scripts/test-relations.cjs` se tiver Node instalado.
5. Envie as mudanças em `data/` ao GitHub. O Pages publica a branch `main`, pasta raiz.

O arquivo DuckDB não precisa ser publicado; somente o catálogo exportado. A interface pública ainda não oferece upload administrativo nem atualização automática agendada. A competência exibida acompanha os dados exportados.

O gerador pode ser usado futuramente em GitHub Actions: `python scripts/export_web.py base.duckdb --output staging/data`, seguido de `python scripts/build-relations.py --data staging/data` e `python scripts/export_ficha.py --db base.duckdb --data staging/data`. Revise e publique os arquivos somente após sucesso das validações.
