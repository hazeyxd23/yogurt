"""Question -> SQL -> checked, read-only run -> self-correction on failure -> written answer."""

import re
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Callable

from sqlalchemy.exc import DBAPIError, SQLAlchemyError

from app.agent.db import QueryResult
from app.agent.guard import UnsafeSQL, WriteAttempt, check_sql
from app.agent.llm import ChatModel, Message
from app.agent.schema import schema_prompt

SQL_SYSTEM = """You write PostgreSQL queries that answer questions about one person's habit-tracking data \
(guitar practice, reading, LeetCode practice, calendar tasks and notes).

Database schema. These are the only tables and columns you may use:

{schema}

Rules:
- Reply with exactly one query in a ```sql code block and nothing else.
- Read only: SELECT, optionally with WITH. Never write data.
- Use only the tables and columns above. All rows belong to the same person, so never filter by user.
- Today is {today} ({weekday}). Resolve relative dates such as "this week" or "last month" with \
CURRENT_DATE and date_trunc. Weeks start on Monday.
- To group by day, week or month, truncate each row's own date column, for example date_trunc('week', session_date), never CURRENT_DATE.
- Name every result column with AS, in plain words. Round averages with ROUND(x::numeric, 1).
- Return at most {limit} rows; aggregate rather than listing raw rows when the question asks for totals.
- If the question asks to add, change or delete anything, reply with exactly: -- CANNOT_ANSWER: I can only read your data
- If the question is about something these tables don't record (for example sleep, mood, weight or money), reply with exactly: -- CANNOT_ANSWER: <what isn't recorded>. Never estimate one quantity from unrelated columns."""

FIX_PROMPT = """That query failed:
{error}

Write a corrected query. Reply with only the ```sql block."""

ANSWER_SYSTEM = """You answer a question about a person's own habit data using only the query result \
provided. Speak to them directly ("you"). Be brief: one to three sentences of plain text, no markdown \
and no tables. Quote the actual numbers from the result. If the result has no rows, say there is no \
matching data. Never mention SQL, queries or tables, and don't offer follow-ups or ask questions."""

READ_ONLY_ANSWER = "I can only read your data, so I can't add, change or delete anything."
SQL_TOKENS = 700  # output caps: a query, then a short answer
ANSWER_TOKENS = 200

ANSWER_ROWS = 40  # rows shown to the model when it writes the answer

_SQL_BLOCK = re.compile(r"```(?:sql|postgresql)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
_CANNOT = re.compile(r"CANNOT_ANSWER:?\s*(.*)", re.IGNORECASE)


@dataclass
class Attempt:
    sql: str | None
    error: str | None = None


@dataclass
class AgentResult:
    question: str
    answer: str
    answered: bool
    sql: str | None = None
    columns: list[str] = field(default_factory=list)
    rows: list[list] = field(default_factory=list)
    truncated: bool = False
    attempts: list[Attempt] = field(default_factory=list)
    elapsed_ms: int = 0


def extract_sql(reply: str) -> str | None:
    """The query in a model reply: a fenced block if there is one, else a bare SELECT/WITH."""
    match = _SQL_BLOCK.search(reply)
    if match:
        return match.group(1).strip() or None
    text = reply.strip()
    if re.match(r"(select|with)\b", text, re.IGNORECASE):
        return text
    return None


def cannot_answer(reply: str) -> str | None:
    """The model's reason when it says the data can't answer the question, else None."""
    match = _CANNOT.search(reply)
    if not match or re.search(r"^\s*(select|with)\b", reply, re.IGNORECASE | re.MULTILINE):
        return None
    return match.group(1).strip().strip("`").strip().rstrip(".") or "the data doesn't cover that"


def _db_error(exc: Exception) -> str:
    """The database's own message, with its LINE / ^ pointer when it gives one."""
    message = str(exc.orig if isinstance(exc, DBAPIError) and exc.orig is not None else exc)
    lines = [line.rstrip() for line in message.strip().splitlines()]
    keep = [lines[0]] + [line for line in lines[1:] if line.startswith(("LINE", "HINT", " "))]
    return "\n".join(keep[:4])


def _result_table(result: QueryResult) -> str:
    lines = [" | ".join(result.columns)]
    lines += [" | ".join("" if v is None else str(v) for v in row) for row in result.rows[:ANSWER_ROWS]]
    more = len(result.rows) - ANSWER_ROWS
    if more > 0 or result.truncated:
        lines.append(f"... ({'more than ' if result.truncated else ''}{len(result.rows)} rows in total)")
    return "\n".join(lines)


def check_sql_or_raw(sql: str) -> str:
    """The normalised form check_sql would run, or the raw text if it would reject it."""
    try:
        return check_sql(sql)
    except UnsafeSQL:
        return sql


# Two worked turns before the real question. Small local models follow the reply format far
# more reliably from an example than from the rules alone.
FEW_SHOT: list[Message] = [
    {"role": "user", "content": "How many guitar sessions have I logged, and for how long in total?"},
    {"role": "assistant", "content": "```sql\nSELECT COUNT(*) AS sessions,\n       SUM(duration_minutes) AS total_minutes\nFROM guitar_sessions\n```"},
    {"role": "user", "content": "What did I eat yesterday?"},
    {"role": "assistant", "content": "-- CANNOT_ANSWER: meals aren't recorded"},
]


def sql_messages(question: str, today: date, limit: int) -> list[Message]:
    system = SQL_SYSTEM.format(schema=schema_prompt(), today=today.isoformat(), weekday=today.strftime("%A"), limit=limit)
    return [{"role": "system", "content": system}, *FEW_SHOT, {"role": "user", "content": question}]


def ask(
    question: str,
    llm: ChatModel,
    execute: Callable[[str], QueryResult],
    *,
    max_attempts: int = 3,
    row_limit: int = 200,
    today: date | None = None,
) -> AgentResult:
    """Answer a question about the habit data.

    Each attempt asks the model for SQL, checks it (guard.check_sql) and runs it read-only.
    A rejected or failing query goes back to the model with the error so it can correct
    itself, up to max_attempts times. A working result is then turned into a short answer.
    """
    started = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    messages = sql_messages(question, today or date.today(), row_limit)
    attempts: list[Attempt] = []
    result: QueryResult | None = None

    for _ in range(max_attempts):
        reply = llm.chat(messages, max_tokens=SQL_TOKENS)
        messages.append({"role": "assistant", "content": reply})

        reason = cannot_answer(reply)
        if reason:
            return AgentResult(
                question=question,
                answer=READ_ONLY_ANSWER if "only read" in reason.lower()
                else f"I can't answer that: {reason}.",
                answered=False,
                attempts=attempts,
                elapsed_ms=elapsed(),
            )

        sql = extract_sql(reply)
        if sql is None:
            error = "No SQL query was found in the reply."
        elif any(a.sql == check_sql_or_raw(sql) for a in attempts):
            error = "This is the same query that already failed. Change it to fix the error above."
        else:
            try:
                sql = check_sql(sql)
                result = execute(sql)
                attempts.append(Attempt(sql=sql))
                break
            except WriteAttempt:
                attempts.append(Attempt(sql=sql, error="Declined: the query would change data."))
                return AgentResult(
                    question=question, answer=READ_ONLY_ANSWER, answered=False,
                    sql=sql, attempts=attempts, elapsed_ms=elapsed(),
                )
            except UnsafeSQL as e:
                error = f"Rejected before running: {e}."
            except (SQLAlchemyError, DBAPIError) as e:
                error = f"PostgreSQL error: {_db_error(e)}"
        attempts.append(Attempt(sql=sql, error=error))
        messages.append({"role": "user", "content": FIX_PROMPT.format(error=error)})

    if result is None:
        return AgentResult(
            question=question,
            answer=f"I couldn't write a working query for that in {max_attempts} attempts.",
            answered=False,
            sql=attempts[-1].sql if attempts else None,
            attempts=attempts,
            elapsed_ms=elapsed(),
        )

    answer = llm.chat([
        {"role": "system", "content": ANSWER_SYSTEM},
        {"role": "user", "content": f"Question: {question}\n\nQuery result:\n{_result_table(result)}"},
    ], max_tokens=ANSWER_TOKENS).strip()

    return AgentResult(
        question=question,
        answer=answer,
        answered=True,
        sql=attempts[-1].sql,
        columns=result.columns,
        rows=result.rows,
        truncated=result.truncated,
        attempts=attempts,
        elapsed_ms=elapsed(),
    )
