import pytest

from app.agent.guard import UnsafeSQL, WriteAttempt, check_sql


@pytest.mark.parametrize("sql", [
    "SELECT count(*) FROM tasks",
    "select title from tasks where title = 'delete me';",  # keywords inside strings are fine
    "WITH t AS (SELECT * FROM guitar_sessions) SELECT sum(duration_minutes) FROM t",
    "SELECT b.title, sum(r.duration_minutes) FROM reading_sessions r JOIN books b ON b.id = r.book_id GROUP BY 1",
    "SELECT question_name FROM leetcode_problems WHERE question_name LIKE '%Sum%'",
    "SELECT 1 -- trailing comment; DROP TABLE tasks",  # the comment never runs
    "SELECT updated_at, created_at FROM notes",  # column names containing keywords
])
def test_accepts_read_only_queries(sql):
    assert check_sql(sql) == sql.strip().rstrip(";").strip()


@pytest.mark.parametrize("sql, reason", [
    ("", "empty"),
    ("DELETE FROM tasks", "DELETE would change data"),
    ("VALUES (1)", "must start with SELECT or WITH"),
    ("SELECT 1; DELETE FROM tasks", "one statement"),
    ("WITH gone AS (DELETE FROM tasks RETURNING *) SELECT * FROM gone", "DELETE"),
    ("SELECT * INTO backup FROM tasks", "INTO"),
    ("SELECT * FROM tasks FOR UPDATE", "UPDATE"),
    ("SELECT email FROM users", "table users"),
    ("SELECT access_token FROM public.integrations", "table integrations"),
    ("SELECT * FROM pg_catalog.pg_roles", "system catalogs"),
    ("SELECT table_name FROM information_schema.tables", "system catalogs"),
    ("SELECT pg_sleep(30)", "system catalogs"),
    ("SELECT set_config('statement_timeout', '0', false)", "set_config"),
    ("SELECT * FROM dblink('host=x', 'select 1') AS t(a int)", "dblink"),
    ("SELECT $$x$$", "dollar-quoted"),
    ("SELECT 'unterminated FROM tasks", "unterminated"),
    ("SELECT 1 /* hide */; UPDATE tasks SET title = 'x'", "one statement"),
])
def test_rejects_unsafe_queries(sql, reason):
    with pytest.raises(UnsafeSQL, match=reason):
        check_sql(sql)


@pytest.mark.parametrize("sql", ["UPDATE tasks SET title = 'x'", "SELECT * INTO copy FROM tasks", "DROP TABLE notes"])
def test_writes_are_a_distinct_error(sql):
    with pytest.raises(WriteAttempt):
        check_sql(sql)
