"""Runs a checked query read-only, with a time limit and a row cap."""

from dataclasses import dataclass
from datetime import date, datetime, time
from decimal import Decimal
from functools import lru_cache
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine

from app.config import settings


@dataclass
class QueryResult:
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool  # more rows matched than the cap


@lru_cache(maxsize=1)
def agent_engine() -> Engine:
    """A small separate pool, on the SELECT-only role when AGENT_DATABASE_URL is set."""
    return create_engine(
        settings.agent_database_url or settings.database_url,
        pool_size=2,
        max_overflow=0,
        pool_pre_ping=True,
    )


def uses_readonly_role() -> bool:
    return bool(settings.agent_database_url)


def _json_safe(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if value is None or isinstance(value, (int, float, bool, str)):
        return value
    return str(value)


def run_readonly(sql: str, engine: Engine | None = None) -> QueryResult:
    """Execute inside a READ ONLY transaction that is always rolled back.

    Postgres itself refuses any write in a read-only transaction, so this holds even if a
    query got past guard.check_sql. statement_timeout stops runaway queries, and only the
    first agent_row_limit rows are fetched.
    """
    engine = engine or agent_engine()
    limit = settings.agent_row_limit
    with engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.exec_driver_sql("SET TRANSACTION READ ONLY")
            conn.exec_driver_sql(f"SET LOCAL statement_timeout = {int(settings.agent_statement_timeout_ms)}")
            # The query runs exactly as written, so Postgres error positions (LINE n, ^) match
            # what the model wrote. psycopg2 treats % as a placeholder marker whenever
            # parameters are passed (SQLAlchemy passes an empty tuple), so double them to keep
            # LIKE '%x%' intact.
            result = conn.exec_driver_sql(sql.replace("%", "%%"))
            columns = list(result.keys())
            raw = result.fetchmany(limit + 1)
            result.close()
        finally:
            tx.rollback()
    rows = [[_json_safe(v) for v in row] for row in raw[:limit]]
    return QueryResult(columns=columns, rows=rows, truncated=len(raw) > limit)
