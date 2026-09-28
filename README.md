# Explorador SIGTAP

Consulta pública da base SIGTAP de agosto de 2026: 5.023 procedimentos, 9 grupos, filtros por Grupo, Subgrupo e Forma de Organização, busca e detalhes ao selecionar.

## Publicar no GitHub Pages

Em Settings → Pages, selecione Deploy from a branch, branch main e pasta / (root).

## Testar localmente

Execute `python -m http.server 8080` nesta pasta e abra http://localhost:8080.

## Fonte e limites

Dados exportados do banco DuckDB do MVP. São dados de procedimentos SIGTAP, sem dados de pacientes. 699 procedimentos não possuem descrição na base; a reconciliação com os TXT originais permanece pendente. Esta versão não se atualiza automaticamente.

Relatório: data/validation.json. A consulta funciona inteiramente no navegador. Não contém autenticação; a publicação no GitHub Pages é pública.
