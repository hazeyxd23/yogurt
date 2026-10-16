"""Static checks on model-written SQL, before it reaches the database.

This is the first of three layers. The query also runs inside a READ ONLY transaction (db.py),
ideally as a role that can only SELECT the allowed tables (scripts/create_agent_role.py), so a
query that slips past these checks still can't write or read anything outside the habit tables.
"""

import re

from app.agent.schema import ALLOWED_TABLES, BLOCKED_TABLES


class UnsafeSQL(ValueError):
    """The query was rejected before running. The message is fed back to the model."""


class WriteAttempt(UnsafeSQL):
    """The query would change data. The agent declines rather than asking for a fix."""


# Keywords that mean the query is trying to change something, not just read badly.
WRITE_KEYWORDS = frozenset({
    "insert", "update", "delete", "merge", "upsert", "drop", "alter", "create", "truncate",
    "grant", "revoke", "copy", "into",
})


# Statement keywords that have no place in a read-only query. "into" catches SELECT ... INTO,
# "update" also catches SELECT ... FOR UPDATE row locks.
FORBIDDEN_KEYWORDS = frozenset({
    "insert", "update", "delete", "merge", "upsert", "drop", "alter", "create", "truncate",
    "grant", "revoke", "copy", "call", "do", "execute", "prepare", "deallocate", "vacuum",
    "analyze", "refresh", "reindex", "cluster", "comment", "lock", "listen", "notify", "unlisten",
    "set", "reset", "begin", "commit", "rollback", "savepoint", "release", "into", "load",
    "import", "security", "owner",
})

# Functions that read files, open connections, change settings or stall the server.
FORBIDDEN_FUNCTIONS = frozenset({
    "dblink", "dblink_exec", "lo_import", "lo_export", "lo_get", "lo_put", "set_config",
    "query_to_xml", "query_to_json", "table_to_xml", "cursor_to_xml", "copy_from", "txid_current",
})

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_STRING = re.compile(r"'(?:[^']|'')*'")
_DOLLAR_QUOTE = re.compile(r"\$[a-zA-Z_]*\$")
_WORD = re.compile(r"[a-z_][a-z0-9_$]*")
_CALL = re.compile(r"([a-z_][a-z0-9_]*)\s*\(")


def _strip(sql: str) -> str:
    """Lower-cased SQL with comments removed and string literals blanked, for keyword checks."""
    if _DOLLAR_QUOTE.search(sql):
        raise UnsafeSQL("dollar-quoted strings are not allowed; use single quotes")
    text = _BLOCK_COMMENT.sub(" ", sql)
    text = _LINE_COMMENT.sub(" ", text)
    text = _STRING.sub(" _str_ ", text)
    if "'" in text:
        raise UnsafeSQL("unterminated string literal")
    return text.lower()


def check_sql(sql: str) -> str:
    """Return the query ready to run (trailing semicolons removed), or raise UnsafeSQL."""
    query = sql.strip().rstrip(";").strip()
    if not query:
        raise UnsafeSQL("the query is empty")

    text = _strip(query)
    if ";" in text:
        raise UnsafeSQL("only one statement is allowed")

    words = _WORD.findall(text)
    writes = sorted(set(words) & WRITE_KEYWORDS)
    if writes:
        raise WriteAttempt(f"{writes[0].upper()} would change data; only reading is allowed")
    if not words or words[0] not in ("select", "with"):
        raise UnsafeSQL("the query must start with SELECT or WITH")

    bad = sorted(set(words) & FORBIDDEN_KEYWORDS)
    if bad:
        raise UnsafeSQL(f"{bad[0].upper()} is not allowed in a read-only query")

    blocked = sorted(set(words) & BLOCKED_TABLES)
    if blocked:
        raise UnsafeSQL(f"table {blocked[0]} is not available; use only: {', '.join(ALLOWED_TABLES)}")

    for word in words:
        if word.startswith("pg_") or word == "information_schema":
            raise UnsafeSQL("system catalogs are not available; use only the listed tables")

    for name in _CALL.findall(text):
        if name in FORBIDDEN_FUNCTIONS:
            raise UnsafeSQL(f"function {name}() is not allowed")

    return query
