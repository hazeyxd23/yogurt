"""Score the Ask agent on eval/agent_questions.jsonl against ground-truth SQL.

    cd backend
    .venv/Scripts/python.exe -m eval.run_agent_eval            # every question
    .venv/Scripts/python.exe -m eval.run_agent_eval a04 d02    # just these ids

An answerable question counts as correct when every value of the ground-truth result appears
in the agent's result rows (extra columns or rows are fine). A question the data can't answer,
or a request to change data, counts as correct when the agent declines without running a query.
Ground truth is computed live, so the score reflects the data currently in the database.
"""

import json
import sys
import time
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import text

from app.agent.agent import ask
from app.agent.db import run_readonly
from app.agent.llm import make_chat_model
from app.config import settings
from app.database import engine

HERE = Path(__file__).resolve().parent
QUESTIONS = HERE / "agent_questions.jsonl"
RESULTS = HERE / "results"


def norm(value) -> str:
    """One comparable form for numbers, dates and text from either side."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float, Decimal)):
        return f"{round(float(value), 1):g}"
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:10]
    s = str(value).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":  # ISO date or timestamp
        return s[:10]
    try:
        return f"{round(float(s), 1):g}"
    except ValueError:
        return s.lower()


def truth_values(sql: str) -> list[list[str]]:
    with engine.connect() as conn:
        return [[norm(v) for v in row] for row in conn.execute(text(sql)).fetchall()]


def main() -> None:
    wanted = set(sys.argv[1:])
    items = [json.loads(line) for line in QUESTIONS.read_text(encoding="utf-8").splitlines() if line.strip()]
    items = [q for q in items if not wanted or q["id"] in wanted]
    llm = make_chat_model(settings)

    rows, correct = [], 0
    for item in items:
        started = time.monotonic()
        result = ask(item["question"], llm, run_readonly,
                     max_attempts=settings.agent_max_attempts, row_limit=settings.agent_row_limit)
        seconds = time.monotonic() - started
        failed = sum(1 for a in result.attempts if a.error)

        if item.get("decline"):
            ok = not result.answered and not any(a.error is None for a in result.attempts)
            expected = "decline"
        else:
            expected_rows = truth_values(item["truth"])
            got = {norm(v) for row in result.rows for v in row}
            ok = result.answered and all(v in got for row in expected_rows for v in row)
            expected = expected_rows
        correct += ok
        rows.append({
            "id": item["id"], "question": item["question"], "correct": ok, "expected": expected,
            "answer": result.answer, "sql": result.sql, "rows": result.rows[:10],
            "failed_attempts": failed, "seconds": round(seconds, 1),
        })
        print(f"{'PASS' if ok else 'FAIL'} {item['id']}  {failed} failed  {seconds:5.1f}s  {item['question']}")
        if not ok:
            print(f"       expected {expected}\n       got      {result.rows[:5]}  answer={result.answer!r}")

    answerable = [r for r in rows if r["expected"] != "decline"]
    declines = [r for r in rows if r["expected"] == "decline"]
    summary = {
        "model": f"{llm.provider}:{llm.model}",
        "date": date.today().isoformat(),
        "questions": len(rows),
        "correct": correct,
        "answerable_correct": f"{sum(r['correct'] for r in answerable)}/{len(answerable)}",
        "declines_correct": f"{sum(r['correct'] for r in declines)}/{len(declines)}",
        "first_try": f"{sum(r['correct'] and r['failed_attempts'] == 0 for r in answerable)}/{len(answerable)}",
        "self_corrected": f"{sum(r['correct'] and r['failed_attempts'] > 0 for r in answerable)}/{len(answerable)}",
        "avg_seconds": round(sum(r["seconds"] for r in rows) / max(len(rows), 1), 1),
    }
    print("\n" + json.dumps(summary, indent=2))
    if not wanted:
        RESULTS.mkdir(exist_ok=True)
        out = RESULTS / f"agent_eval_{llm.model.replace(':', '_').replace('/', '_')}.json"
        out.write_text(json.dumps({"summary": summary, "questions": rows}, indent=2), encoding="utf-8")
        print(f"saved {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main()
