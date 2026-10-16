"""The part of the database the agent may query, described for the prompt.

Only the habit tables are exposed. Users, notifications, email preferences and integrations
(which hold access tokens) are never shown to the model, and guard.py rejects any query that
names them.
"""

from sqlalchemy.dialects import postgresql

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.database import Base

# table -> what one row is
ALLOWED_TABLES: dict[str, str] = {
    "guitar_sessions": "one guitar practice session",
    "books": "a book in the reading library",
    "reading_sessions": "one reading session of a book (join books on reading_sessions.book_id = books.id)",
    "leetcode_problems": "a LeetCode problem on the practice list",
    "tasks": "a calendar event / task; recurring events have one row per occurrence",
    "daily_analytics": "per-day totals, one row per user per date",
    "streaks": "current and best streak per habit",
    "notes": "a note (markdown text or a graph note)",
}

# (table, column) -> meaning the column name alone doesn't carry
COLUMN_NOTES: dict[tuple[str, str], str] = {
    ("books", "status"): "'reading', 'completed', 'on_hold' or 'dropped'",
    ("reading_sessions", "key_note"): "where the reader left off",
    ("reading_sessions", "end_page"): "page the session ended on",
    ("leetcode_problems", "difficulty"): "'Easy', 'Medium' or 'Hard' (may be NULL)",
    ("tasks", "priority"): "1 = high, 2 = medium, 3 = low",
    ("tasks", "task_date"): "the day the event happens",
    ("tasks", "scheduled_time"): "start time; NULL for all-day events",
    ("tasks", "recurrence"): "'daily', 'weekdays', 'weekly', 'monthly' or NULL",
    ("streaks", "habit_type"): "'guitar', 'reading', 'leetcode' or 'tasks'",
    ("notes", "kind"): "'text' or 'graph'",
    ("notes", "content"): "markdown; checklist items look like '- [x] done' / '- [ ] open'",
    ("notes", "graph"): "JSON graph (nodes, edges, groups); ignore unless asked",
}

# columns the model doesn't need: every row belongs to the one user, and note
# window layout says nothing about the data
HIDDEN_COLUMNS = {"user_id"}
HIDDEN_NOTE_COLUMNS = {"floating", "floating_page", "pinned", "pos_x", "pos_y", "width", "height", "is_dashboard"}

ALL_TABLES: frozenset[str] = frozenset(Base.metadata.tables)
BLOCKED_TABLES: frozenset[str] = ALL_TABLES - ALLOWED_TABLES.keys()


def schema_prompt() -> str:
    """The allowed tables as compact pseudo-DDL, one table per block."""
    blocks = []
    for name, about in ALLOWED_TABLES.items():
        table = Base.metadata.tables[name]
        lines = [f"{name}  -- {about}"]
        for col in table.columns:
            if col.name in HIDDEN_COLUMNS or (name == "notes" and col.name in HIDDEN_NOTE_COLUMNS):
                continue
            kind = col.type.compile(dialect=postgresql.dialect()).lower().replace(" without time zone", "")
            fk = next(iter(col.foreign_keys), None)
            extras = []
            if col.primary_key:
                extras.append("primary key")
            if fk is not None and fk.column.table.name in ALLOWED_TABLES:
                extras.append(f"references {fk.column.table.name}.{fk.column.name}")
            if (name, col.name) in COLUMN_NOTES:
                extras.append(COLUMN_NOTES[(name, col.name)])
            lines.append(f"  {col.name} {kind}" + (f"  -- {'; '.join(extras)}" if extras else ""))
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)
