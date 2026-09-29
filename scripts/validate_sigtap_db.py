from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.config import resolve_database_path
from src.db import readonly_connection


RELATION_TABLES = (
    "rl_procedimento_cid",
    "rl_procedimento_detalhe",
    "rl_procedimento_habilitacao",
    "rl_procedimento_incremento",
    "rl_procedimento_leito",
    "rl_procedimento_modalidade",
    "rl_procedimento_ocupacao",
    "rl_procedimento_origem",
    "rl_procedimento_registro",
    "rl_procedimento_servico",
    "rl_procedimento_sia_sih",
)


def validate(path: Path) -> dict:
    report: dict = {"database": str(path), "checks": {}}
    with readonly_connection(path) as con:
        tables = [row[0] for row in con.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name"
        ).fetchall()]
        report["table_count"] = len(tables)
        report["competencias"] = [row[0] for row in con.execute(
            "SELECT DISTINCT DT_COMPETENCIA FROM tb_procedimento ORDER BY 1"
        ).fetchall()]
        report["row_counts"] = {
            table: con.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            for table in tables
        }
        report["checks"]["duplicate_procedure_keys"] = con.execute(
            """
            SELECT COUNT(*) FROM (
              SELECT CO_PROCEDIMENTO, DT_COMPETENCIA
              FROM tb_procedimento GROUP BY 1,2 HAVING COUNT(*) > 1
            )
            """
        ).fetchone()[0]
        report["checks"]["invalid_procedure_code_length"] = con.execute(
            "SELECT COUNT(*) FROM tb_procedimento WHERE LENGTH(CO_PROCEDIMENTO) <> 10"
        ).fetchone()[0]
        report["checks"]["procedures_without_description"] = con.execute(
            """
            SELECT COUNT(*) FROM tb_procedimento p
            LEFT JOIN tb_descricao d USING (CO_PROCEDIMENTO, DT_COMPETENCIA)
            WHERE d.CO_PROCEDIMENTO IS NULL
            """
        ).fetchone()[0]
        report["checks"]["tabs_in_procedure_descriptions"] = con.execute(
            "SELECT COUNT(*) FROM tb_descricao WHERE CONTAINS(DS_PROCEDIMENTO, chr(9))"
        ).fetchone()[0]
        report["checks"]["tabs_in_detail_descriptions"] = con.execute(
            "SELECT COUNT(*) FROM tb_descricao_detalhe WHERE CONTAINS(DS_DETALHE, chr(9))"
        ).fetchone()[0]
        orphans = {}
        for table in RELATION_TABLES:
            if table not in tables:
                continue
            columns = {row[0] for row in con.execute(
                "SELECT column_name FROM information_schema.columns WHERE table_name = ?", [table]
            ).fetchall()}
            if {"CO_PROCEDIMENTO", "DT_COMPETENCIA"} <= columns:
                orphans[table] = con.execute(
                    f"""
                    SELECT COUNT(*) FROM "{table}" r
                    LEFT JOIN tb_procedimento p
                      ON p.CO_PROCEDIMENTO=r.CO_PROCEDIMENTO
                     AND p.DT_COMPETENCIA=r.DT_COMPETENCIA
                    WHERE p.CO_PROCEDIMENTO IS NULL
                    """
                ).fetchone()[0]
        report["checks"]["orphan_procedure_relations"] = orphans
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Valida uma base SIGTAP sem alterá-la.")
    parser.add_argument("database", nargs="?", type=Path)
    args = parser.parse_args()
    selected = args.database or resolve_database_path().path
    print(json.dumps(validate(selected), ensure_ascii=False, indent=2))
