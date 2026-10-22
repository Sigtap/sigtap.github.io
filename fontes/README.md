# Fontes auxiliares

Arquivos externos guardados para conferência. **Nenhuma informação deles aparece no site**, exceto os títulos das famílias CBO na sub-aba "Categoria" da aba CBO, que a base SIGTAP não traz, as portarias das Notas Técnicas na aba "Novidades" e as habilitações do estabelecimento (ficha do CNES), usadas só para marcar os procedimentos sem habilitação.

## cbo-mte/ — Classificação Brasileira de Ocupações (CBO 2002), Ministério do Trabalho

Arquivos originais (Windows-1252, separador ";"), sem alteração além do nome:

```
76a56fa0d2d5844c0f470cca74a560c48400455dff4ec306fb2a2672f8c0f928  CBO2002 - Familia.csv
cad67f4971a9ff1eb47129c1f43e733b792c034b1f9fd18476bed3b14e55da4f  CBO2002 - Grande Grupo.csv
ad6d51d5d139125b15ea746464b2a39fa832ae295cdb6aa63dc7eddf2d2bed00  CBO2002 - Ocupacao.csv
01f2f99f0831d57fae27b90c57d112432350bee80fe55e969f969d4d9d6f7a91  CBO2002 - PerfilOcupacional.csv
d49e700161106e0da7e69083db97d0a94ec6d7feed3ab874da5a0cd175a1ace1  CBO2002 - Sinonimo.csv
0e74bcd22818be529eb1c737ecc463c034d730194ecd1f241723c617cc6853b7  CBO2002 - SubGrupo Principal.csv
f9c7dd232da09330e248b42c9e2002ba7a1379de7c5479d6e0dbccf62f3fec69  CBO2002 - SubGrupo.csv
```

Uso no site: só `CBO2002 - Familia.csv` (título de cada família de 4 dígitos), lido por `scripts/export_ficha.py` e gravado em `data/lookups.json` (`cbo_familia_nome`). Ocupações, códigos e vínculos continuam vindo exclusivamente da base SIGTAP.

## cbo-familias-sigtap.csv

Famílias próprias do SUS que não existem no arquivo do MTE, com o título como aparece na tela "Categoria CBO" do SIGTAP (hoje só 2231 - Médicos).

## notas-tecnicas/ — Notas Técnicas CGSI (alterações mensais do SIGTAP)

- `nota_tecnica_cgsi_sigtap_2026_10.pdf`: Nota Técnica CGSI nº 10/2026, de 25/09/2026 (competência 10/2026), sem alteração. SHA-256 `7bc85229acf3b8432210e6559fedf36d5be80753f9c86dc93d74c68c529fc606`.
- `202610.json`: o que `scripts/parse_nota_tecnica.py` extrai do PDF. Para cada item, guarda a seção (novos, revogados, alterados, compatibilidades novas/revogadas), o código do procedimento e a portaria. Para compatibilidades, guarda também o registro, o tipo e a quantidade como impressos.
- `LEIA_ME.TXT`: histórico de layout dos arquivos TXT do SIGTAP (2007–2008), só para referência.

Uso no site: só as portarias, na aba "Novidades". As mudanças em si (nomes, valores, vínculos) vêm da comparação entre a base anterior e a nova. Para cada lista, a aba "Conferência nota × base" mostra os itens que estão só na base ou só na nota. Em 10/2026, nota e base conferem.

A nota também dá nome a tipos de compatibilidade que a base guarda só como número. Conferido par a par: todo par listado como "(Excludente)" (Qtd 0) é tipo 2 na base, "(Compatível Seq)" é tipo 4 e "(Obrigatória)" é tipo 5. A tela de compatibilidades usa esses rótulos, escritos como na nota. O tipo 3 segue sem rótulo até uma nota trazer um par desse tipo.

## cnes/ — Ficha do estabelecimento (CNES)

- `ficha_cnes_3157245_2026-10-22.pdf`: ficha do CNES 3157245 (Hospital Universitário Professor Polydoro Ernani de São Thiago), emitida em 22/10/2026, sem alteração.
- `3157245.json`: o que `scripts/parse_cnes_habilitacoes.py` extrai da ficha: código, origem e competências inicial e final de cada habilitação (42).

Uso no site: só os códigos das habilitações vigentes na competência, cruzados com as exigências da base SIGTAP (`data/estabelecimento.json`). Nomes das habilitações e regras vêm da base.
