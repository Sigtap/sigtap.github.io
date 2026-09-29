from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

import duckdb

from .db import database_flavor


@dataclass(frozen=True)
class ProcedureSummary:
    competencia: str
    codigo: str
    nome: str
    descricao: str | None
    valor_sa: Decimal | None
    valor_sh: Decimal | None
    valor_sp: Decimal | None
    quantidade_maxima: int | None
    exige_cpf: bool | None
    complexidade: str | None
    sexo: str | None
    idade_minima: int | None
    idade_maxima: int | None
    financiamento_codigo: str | None
    financiamento_nome: str | None
    origem_dado: str


@dataclass(frozen=True)
class RelationItem:
    tipo: str
    codigo: str | None
    nome: str | None
    condicao: str | None
    evidencia: str | None


class SigtapRepository:
    def __init__(self, connection: duckdb.DuckDBPyConnection):
        self.connection = connection
        self.flavor = database_flavor(connection)

    def list_competencias(self) -> list[str]:
        if self.flavor == "native":
            sql = "SELECT DISTINCT DT_COMPETENCIA FROM tb_procedimento ORDER BY DT_COMPETENCIA DESC"
        else:
            sql = "SELECT competencia FROM vw_sigtap_competencias ORDER BY competencia DESC"
        rows = self.connection.execute(sql).fetchall()
        return [str(row[0]) for row in rows]

    def hierarchy(self, competencia: str, parent: str = "") -> list[tuple[str, str]]:
        """Return cumulative code prefixes and names for the next hierarchy level."""
        level = len(parent)
        if level not in (0, 2, 4) or (parent and not parent.isdigit()):
            raise ValueError("Prefixo de hierarquia inválido")
        if self.flavor == "native":
            table, code, name = {
                0: ("tb_grupo", "CO_GRUPO", "NO_GRUPO"),
                2: ("tb_sub_grupo", "CO_GRUPO || CO_SUB_GRUPO", "NO_SUB_GRUPO"),
                4: ("tb_forma_organizacao", "CO_GRUPO || CO_SUB_GRUPO || CO_FORMA_ORGANIZACAO", "NO_FORMA_ORGANIZACAO"),
            }[level]
            return self.connection.execute(
                f"SELECT {code} AS prefixo, {name} FROM {table} "
                f"WHERE DT_COMPETENCIA = ? AND starts_with({code}, ?) ORDER BY 1",
                [competencia, parent],
            ).fetchall()
        return self.connection.execute(
            "SELECT DISTINCT left(codigo, ?) AS prefixo, 'Nome não disponível nesta base' "
            "FROM vw_procedimento_base WHERE competencia = ? AND starts_with(codigo, ?) ORDER BY 1",
            [level + 2, competencia, parent],
        ).fetchall()

    def search(self, competencia: str, term: str, limit: int | None = None,
               prefix: str = "") -> list[ProcedureSummary]:
        normalized = term.strip()
        like_term = f"%{normalized}%"
        if self.flavor == "native":
            sql = """
            SELECT p.DT_COMPETENCIA, p.CO_PROCEDIMENTO, p.NO_PROCEDIMENTO,
                   d.DS_PROCEDIMENTO,
                   CAST(p.VL_SA AS DECIMAL(12,2)) / 100,
                   CAST(p.VL_SH AS DECIMAL(12,2)) / 100,
                   CAST(p.VL_SP AS DECIMAL(12,2)) / 100,
                   p.QT_MAXIMA_EXECUCAO,
                   CASE
                     WHEN EXISTS (
                       SELECT 1 FROM rl_procedimento_detalhe rd
                       WHERE rd.CO_PROCEDIMENTO = p.CO_PROCEDIMENTO
                         AND rd.DT_COMPETENCIA = p.DT_COMPETENCIA
                         AND rd.CO_DETALHE IN ('009', '058')
                     ) THEN TRUE
                     WHEN EXISTS (
                       SELECT 1 FROM rl_procedimento_detalhe rd
                       WHERE rd.CO_PROCEDIMENTO = p.CO_PROCEDIMENTO
                         AND rd.DT_COMPETENCIA = p.DT_COMPETENCIA
                         AND rd.CO_DETALHE = '034'
                     ) THEN FALSE
                     ELSE NULL
                   END AS exige_cpf,
                   p.TP_COMPLEXIDADE, p.TP_SEXO,
                   p.VL_IDADE_MINIMA, p.VL_IDADE_MAXIMA,
                   p.CO_FINANCIAMENTO, f.NO_FINANCIAMENTO,
                   'SIGTAP_OFICIAL' AS origem_dado
            FROM tb_procedimento p
            LEFT JOIN tb_descricao d
              ON d.CO_PROCEDIMENTO = p.CO_PROCEDIMENTO
             AND d.DT_COMPETENCIA = p.DT_COMPETENCIA
            LEFT JOIN tb_financiamento f
              ON f.CO_FINANCIAMENTO = p.CO_FINANCIAMENTO
             AND f.DT_COMPETENCIA = p.DT_COMPETENCIA
            WHERE p.DT_COMPETENCIA = ?
              AND (? = '' OR p.CO_PROCEDIMENTO LIKE ? OR p.NO_PROCEDIMENTO ILIKE ?)
              AND starts_with(p.CO_PROCEDIMENTO, ?)
            ORDER BY p.CO_PROCEDIMENTO
            LIMIT ?
            """
        else:
            sql = """
            SELECT competencia, codigo, nome, descricao, valor_sa, valor_sh,
                   valor_sp, quantidade_maxima, exige_cpf, complexidade, sexo,
                   idade_minima, idade_maxima, financiamento_codigo,
                   financiamento_nome, origem_dado
            FROM vw_procedimento_base
            WHERE competencia = ?
              AND (? = '' OR codigo LIKE ? OR nome ILIKE ?)
              AND starts_with(codigo, ?)
            ORDER BY codigo
            LIMIT ?
            """
        params = [competencia, normalized, like_term, like_term, prefix]
        if limit is None:
            sql = sql.replace("LIMIT ?", "")
        else:
            params.append(limit)
        rows = self.connection.execute(sql, params).fetchall()
        return [ProcedureSummary(*row) for row in rows]

    def get_relations(self, competencia: str, codigo: str) -> list[RelationItem]:
        if self.flavor == "native":
            sql = """
            SELECT * FROM (
              SELECT 'CBO', ro.CO_OCUPACAO, o.NO_OCUPACAO, NULL, 'SIGTAP ' || ro.DT_COMPETENCIA
              FROM rl_procedimento_ocupacao ro JOIN tb_ocupacao o USING (CO_OCUPACAO)
              WHERE ro.DT_COMPETENCIA = ? AND ro.CO_PROCEDIMENTO = ?
              UNION ALL
              SELECT 'CID', rc.CO_CID, c.NO_CID,
                     CASE WHEN rc.ST_PRINCIPAL = 'S' THEN 'CID principal' ELSE 'CID relacionado' END,
                     'SIGTAP ' || rc.DT_COMPETENCIA
              FROM rl_procedimento_cid rc JOIN tb_cid c USING (CO_CID)
              WHERE rc.DT_COMPETENCIA = ? AND rc.CO_PROCEDIMENTO = ?
              UNION ALL
              SELECT 'MODALIDADE', rm.CO_MODALIDADE, m.NO_MODALIDADE, NULL, 'SIGTAP ' || rm.DT_COMPETENCIA
              FROM rl_procedimento_modalidade rm JOIN tb_modalidade m
                ON m.CO_MODALIDADE=rm.CO_MODALIDADE AND m.DT_COMPETENCIA=rm.DT_COMPETENCIA
              WHERE rm.DT_COMPETENCIA = ? AND rm.CO_PROCEDIMENTO = ?
              UNION ALL
              SELECT 'INSTRUMENTO', rr.CO_REGISTRO, r.NO_REGISTRO, NULL, 'SIGTAP ' || rr.DT_COMPETENCIA
              FROM rl_procedimento_registro rr JOIN tb_registro r
                ON r.CO_REGISTRO=rr.CO_REGISTRO AND r.DT_COMPETENCIA=rr.DT_COMPETENCIA
              WHERE rr.DT_COMPETENCIA = ? AND rr.CO_PROCEDIMENTO = ?
              UNION ALL
              SELECT 'ATRIBUTO_COMPLEMENTAR', rd.CO_DETALHE, d.NO_DETALHE, NULL, 'SIGTAP ' || rd.DT_COMPETENCIA
              FROM rl_procedimento_detalhe rd JOIN tb_detalhe d
                ON d.CO_DETALHE=rd.CO_DETALHE AND d.DT_COMPETENCIA=rd.DT_COMPETENCIA
              WHERE rd.DT_COMPETENCIA = ? AND rd.CO_PROCEDIMENTO = ?
              UNION ALL
              SELECT 'HABILITACAO', rh.CO_HABILITACAO, h.NO_HABILITACAO,
                     'Grupo ' || COALESCE(rh.NU_GRUPO_HABILITACAO, ''), 'SIGTAP ' || rh.DT_COMPETENCIA
              FROM rl_procedimento_habilitacao rh JOIN tb_habilitacao h
                ON h.CO_HABILITACAO=rh.CO_HABILITACAO AND h.DT_COMPETENCIA=rh.DT_COMPETENCIA
              WHERE rh.DT_COMPETENCIA = ? AND rh.CO_PROCEDIMENTO = ?
              UNION ALL
              SELECT 'SERVICO_CLASSIFICACAO', rs.CO_SERVICO || '/' || rs.CO_CLASSIFICACAO,
                     s.NO_SERVICO || ' — ' || sc.NO_CLASSIFICACAO, NULL, 'SIGTAP ' || rs.DT_COMPETENCIA
              FROM rl_procedimento_servico rs
              JOIN tb_servico s ON s.CO_SERVICO=rs.CO_SERVICO AND s.DT_COMPETENCIA=rs.DT_COMPETENCIA
              JOIN tb_servico_classificacao sc ON sc.CO_SERVICO=rs.CO_SERVICO
                AND sc.CO_CLASSIFICACAO=rs.CO_CLASSIFICACAO AND sc.DT_COMPETENCIA=rs.DT_COMPETENCIA
              WHERE rs.DT_COMPETENCIA = ? AND rs.CO_PROCEDIMENTO = ?
              UNION ALL
              SELECT 'COMPATIBILIDADE', rp.CO_PROCEDIMENTO_COMPATIVEL, pc.NO_PROCEDIMENTO,
                     'Tipo ' || COALESCE(rp.TP_COMPATIBILIDADE, '') ||
                     CASE WHEN rp.QT_PERMITIDA IS NULL THEN '' ELSE '; quantidade permitida ' || CAST(rp.QT_PERMITIDA AS VARCHAR) END,
                     'SIGTAP ' || rp.DT_COMPETENCIA
              FROM rl_procedimento_compativel rp JOIN tb_procedimento pc
                ON pc.CO_PROCEDIMENTO=rp.CO_PROCEDIMENTO_COMPATIVEL AND pc.DT_COMPETENCIA=rp.DT_COMPETENCIA
              WHERE rp.DT_COMPETENCIA = ? AND rp.CO_PROCEDIMENTO_PRINCIPAL = ?
              UNION ALL
              SELECT 'REGRA_CONDICIONADA', rrc.CO_REGRA_CONDICIONADA, tr.NO_REGRA_CONDICIONADA,
                     tr.DS_REGRA_CONDICIONADA, 'SIGTAP ' || ?
              FROM rl_procedimento_regra_cond rrc JOIN tb_regra_condicionada tr USING (CO_REGRA_CONDICIONADA)
              WHERE rrc.CO_PROCEDIMENTO = ?
            ) relations(tipo, codigo_relacionado, nome_relacionado, condicao, evidencia)
            ORDER BY tipo, codigo_relacionado, nome_relacionado
            """
            params = [competencia, codigo] * 8 + [competencia, codigo]
        else:
            sql = """
            SELECT tipo, codigo_relacionado, nome_relacionado, condicao, evidencia
            FROM vw_procedimento_relacao
            WHERE competencia = ? AND procedimento_codigo = ?
            ORDER BY tipo, codigo_relacionado, nome_relacionado
            """
            params = [competencia, codigo]
        rows = self.connection.execute(sql, params).fetchall()
        return [RelationItem(*row) for row in rows]

    def source_metadata(self) -> dict[str, Any]:
        if self.flavor == "native":
            comp = self.list_competencias()
            return {
                "source_kind": "SIGTAP_OFICIAL",
                "source_label": "Base SIGTAP em estrutura nativa",
                "imported_at": None,
                "validation_status": f"Estrutura reconhecida; competência {', '.join(comp)}. Integridade completa ainda pendente.",
            }
        row = self.connection.execute(
            """
            SELECT source_kind, source_label, imported_at, validation_status
            FROM vw_sigtap_source_metadata
            LIMIT 1
            """
        ).fetchone()
        if not row:
            return {}
        return dict(zip(("source_kind", "source_label", "imported_at", "validation_status"), row))
