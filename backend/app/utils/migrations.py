"""Tiny additive migrations.

Base.metadata.create_all() creates missing tables but never alters existing ones, so
columns added to a model after its table already exists are added here on startup.
Additive, nullable/defaulted columns only - nothing destructive.
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

from app.config import logger

ADDED_COLUMNS = {
    "notes": {"system_key": "VARCHAR"},
    "reading_sessions": {"end_page": "INTEGER"},
    "tasks": {
        "end_time": "TIMESTAMP",
        "all_day": "BOOLEAN DEFAULT FALSE",
        "color": "VARCHAR",
        "recurrence": "VARCHAR",
        "series_id": "VARCHAR",
    },
}


def ensure_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table, columns in ADDED_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
                    logger.info("Migrated: added %s.%s", table, name)
