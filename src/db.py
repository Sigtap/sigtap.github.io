from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import duckdb


REQUIRED_VIEWS = {
    "vw_sigtap_competencias",
    "vw_procedimento_base",
    "vw_procedimento_relacao",
    "vw_sigtap_source_metadata",
}

NATIVE_SIGTAP_TABLES = {
    "tb_procedimento",
    "tb_descricao",
    "rl_procedimento_cid",
    "rl_procedimento_ocupacao",
}


class DatabaseContractError(RuntimeError):
    pass


@contextmanager
def readonly_connection(path: Path) -> Iterator[duckdb.DuckDBPyConnection]:
    if not path.is_file():
        raise FileNotFoundError(f"Base DuckDB não encontrada: {path}")
    connection = duckdb.connect(str(path), read_only=True)
    try:
        yield connection
    finally:
        connection.close()


def database_flavor(connection: duckdb.DuckDBPyConnection) -> str:
    rows = connection.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main'
        """
    ).fetchall()
    available = {row[0] for row in rows}
    if REQUIRED_VIEWS <= available:
        return "canonical"
    if NATIVE_SIGTAP_TABLES <= available:
        return "native"
    missing_views = ", ".join(sorted(REQUIRED_VIEWS - available))
    missing_native = ", ".join(sorted(NATIVE_SIGTAP_TABLES - available))
    raise DatabaseContractError(
        "A base não possui o contrato canônico nem as tabelas SIGTAP nativas. "
        f"Views ausentes: {missing_views}. Tabelas nativas ausentes: {missing_native}."
    )


def validate_contract(connection: duckdb.DuckDBPyConnection) -> None:
    database_flavor(connection)
