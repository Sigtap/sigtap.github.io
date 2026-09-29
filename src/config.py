from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OFFICIAL_DB = PROJECT_ROOT / "data" / "official" / "sigtap.duckdb"
DEFAULT_FIXTURE_DB = PROJECT_ROOT / "data" / "fixtures" / "sigtap_fixture.duckdb"
DEFAULT_OPERATIONAL_DB = PROJECT_ROOT / "data" / "local" / "operacional.duckdb"


@dataclass(frozen=True)
class DatabaseSelection:
    path: Path
    is_fixture: bool
    source_label: str


def resolve_database_path() -> DatabaseSelection:
    configured = os.environ.get("SIGTAP_DB_PATH")
    if configured:
        path = Path(configured).expanduser().resolve()
        return DatabaseSelection(path, False, "Base configurada pelo ambiente")
    if DEFAULT_OFFICIAL_DB.exists():
        return DatabaseSelection(DEFAULT_OFFICIAL_DB, False, "Base oficial local")
    versioned = sorted((PROJECT_ROOT / "data" / "official").glob("sigtap_*.duckdb"), reverse=True)
    if versioned:
        return DatabaseSelection(versioned[0], False, f"Base SIGTAP local: {versioned[0].stem}")
    return DatabaseSelection(DEFAULT_FIXTURE_DB, True, "Fixture sintética de demonstração")


def resolve_operational_db_path() -> Path:
    configured = os.environ.get("OPERACIONAL_DB_PATH")
    return Path(configured).expanduser().resolve() if configured else DEFAULT_OPERATIONAL_DB
