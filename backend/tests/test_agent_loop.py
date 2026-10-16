"""The agent loop with a scripted model and a fake database: no LLM or Postgres needed."""

from datetime import date

import pytest
from sqlalchemy.exc import ProgrammingError

from app.agent.agent import READ_ONLY_ANSWER, ask, cannot_answer, extract_sql
from app.agent.db import QueryResult

TODAY = date(2026, 10, 16)


class ScriptedLLM:
    """Returns the queued replies in order and records every conversation it was sent."""

    provider = "fake"
    model = "scripted"

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls = []

    def chat(self, messages, max_tokens=None):
        self.calls.append([dict(m) for m in messages])
        return self.replies.pop(0)


def db_error(message):
    return ProgrammingError("SELECT ...", {}, Exception(message))


def fake_db(results):
    """An executor that returns or raises the queued outcomes and records the SQL it ran."""
    ran = []

    def execute(sql):
        ran.append(sql)
        outcome = results.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    execute.ran = ran
    return execute


MINUTES = QueryResult(columns=["total_minutes"], rows=[[135]], truncated=False)


def test_answers_on_first_try():
    llm = ScriptedLLM("```sql\nSELECT sum(duration_minutes) AS total_minutes FROM guitar_sessions\n```",
                      "You practised guitar for 135 minutes.")
    db = fake_db([MINUTES])

    result = ask("How long have I practised guitar?", llm, db, today=TODAY)

    assert result.answered
    assert result.answer == "You practised guitar for 135 minutes."
    assert result.rows == [[135]]
    assert [a.error for a in result.attempts] == [None]
    assert db.ran == ["SELECT sum(duration_minutes) AS total_minutes FROM guitar_sessions"]
    # the answer step sees the question and the actual rows
    answer_prompt = llm.calls[1][-1]["content"]
    assert "How long have I practised guitar?" in answer_prompt and "135" in answer_prompt


def test_corrects_a_query_postgres_rejects():
    llm = ScriptedLLM(
        "```sql\nSELECT sum(minutes) AS total_minutes FROM guitar_sessions\n```",
        "```sql\nSELECT sum(duration_minutes) AS total_minutes FROM guitar_sessions\n```",
        "135 minutes.",
    )
    db = fake_db([db_error('column "minutes" does not exist'), MINUTES])

    result = ask("Total guitar time?", llm, db, today=TODAY)

    assert result.answered and len(result.attempts) == 2
    assert result.attempts[0].error == 'PostgreSQL error: column "minutes" does not exist'
    assert result.sql == "SELECT sum(duration_minutes) AS total_minutes FROM guitar_sessions"
    # the database's error was fed back for the second attempt
    fix_request = llm.calls[1][-1]["content"]
    assert 'column "minutes" does not exist' in fix_request


def test_rejected_query_never_reaches_the_database():
    llm = ScriptedLLM(
        "```sql\nSELECT email FROM users\n```",
        "```sql\nSELECT count(*) AS n FROM tasks\n```",
        "You have 3 tasks.",
    )
    db = fake_db([QueryResult(columns=["n"], rows=[[3]], truncated=False)])

    result = ask("How many tasks?", llm, db, today=TODAY)

    assert result.answered
    assert db.ran == ["SELECT count(*) AS n FROM tasks"]
    assert "table users is not available" in result.attempts[0].error


def test_gives_up_after_max_attempts():
    llm = ScriptedLLM(*["```sql\nSELECT nope FROM tasks\n```"] * 3)
    db = fake_db([db_error('column "nope" does not exist')] * 3)

    result = ask("Something odd", llm, db, max_attempts=3, today=TODAY)

    assert not result.answered
    assert len(result.attempts) == 3 and all(a.error for a in result.attempts)
    assert "3 attempts" in result.answer
    assert len(llm.calls) == 3  # no answer-writing call without a result


def test_reply_without_sql_counts_as_a_failed_attempt():
    llm = ScriptedLLM("Sure! Let me think about that.", "SELECT count(*) AS n FROM books", "You have 3 books.")
    db = fake_db([QueryResult(columns=["n"], rows=[[3]], truncated=False)])

    result = ask("How many books?", llm, db, today=TODAY)

    assert result.answered
    assert result.attempts[0].error == "No SQL query was found in the reply."


def test_model_can_decline():
    llm = ScriptedLLM("-- CANNOT_ANSWER: there is no sleep data")
    db = fake_db([])

    result = ask("How much did I sleep?", llm, db, today=TODAY)

    assert not result.answered
    assert result.answer == "I can't answer that: there is no sleep data."
    assert db.ran == []


def test_declined_write_request_gets_the_read_only_answer():
    llm = ScriptedLLM("-- CANNOT_ANSWER: I can only read your data")
    result = ask("Delete my tasks", llm, fake_db([]), today=TODAY)
    assert result.answer == READ_ONLY_ANSWER


def test_prompt_carries_schema_date_and_only_allowed_tables():
    llm = ScriptedLLM("-- CANNOT_ANSWER: n/a")
    ask("anything", llm, fake_db([]), today=TODAY)
    system = llm.calls[0][0]["content"]
    assert "2026-10-16 (Friday)" in system
    assert "guitar_sessions" in system and "daily_analytics" in system
    assert "users" not in system.split("Rules:")[0]
    assert "access_token" not in system and "user_id" not in system


@pytest.mark.parametrize("reply, sql", [
    ("```sql\nSELECT 1\n```", "SELECT 1"),
    ("Here you go:\n```postgresql\nSELECT 2;\n```\nThis counts rows.", "SELECT 2;"),
    ("```\nWITH a AS (SELECT 1) SELECT * FROM a\n```", "WITH a AS (SELECT 1) SELECT * FROM a"),
    ("select 3", "select 3"),
    ("I am not sure.", None),
])
def test_extract_sql(reply, sql):
    assert extract_sql(reply) == sql


def test_cannot_answer_ignores_real_queries():
    assert cannot_answer("```sql\nSELECT 1 -- CANNOT_ANSWER: no\n```") is None
    assert cannot_answer("```sql\n-- CANNOT_ANSWER: no mood data.\n```") == "no mood data"


def test_flags_a_repeated_failing_query_without_running_it_again():
    bad = "```sql\nSELECT ROUND(SUM(duration_minutes) AS total) FROM reading_sessions\n```"
    llm = ScriptedLLM(bad, bad, "```sql\nSELECT SUM(duration_minutes) AS total FROM reading_sessions\n```", "90 minutes.")
    db = fake_db([db_error('syntax error at or near "AS"'), QueryResult(columns=["total"], rows=[[90]], truncated=False)])

    result = ask("Reading time?", llm, db, today=TODAY)

    assert result.answered and len(result.attempts) == 3
    assert "same query that already failed" in result.attempts[1].error
    assert len(db.ran) == 2  # the repeat was not sent to the database


def test_error_feedback_keeps_the_position_pointer():
    message = 'syntax error at or near "AS"\nLINE 2:     ROUND(SUM(x) AS total)\n                          ^'
    llm = ScriptedLLM("SELECT ROUND(SUM(x) AS total) FROM tasks", "SELECT 1 AS one", "One.")
    db = fake_db([db_error(message), QueryResult(columns=["one"], rows=[[1]], truncated=False)])

    result = ask("q", llm, db, today=TODAY)

    assert "LINE 2:" in result.attempts[0].error and result.attempts[0].error.endswith("^")
    assert "LINE 2:" in llm.calls[1][-1]["content"]


def test_declines_writes_instead_of_retrying():
    llm = ScriptedLLM("```sql\nDELETE FROM tasks\n```")
    db = fake_db([])

    result = ask("Delete all my tasks", llm, db, today=TODAY)

    assert not result.answered
    assert result.answer == READ_ONLY_ANSWER
    assert db.ran == [] and len(llm.calls) == 1  # no retry that could drift to another query
