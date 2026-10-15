"""Advanced analytics: streaks, trends, predictions, anomalies, insights.

Keeps calculations centralized so both the HTTP routes (app/routes/analytics.py)
and the Celery tasks (app/tasks.py) share exactly one implementation.
"""

import math
from collections import Counter
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.config import logger
from app.models import (
    HABIT_TYPES,
    Book,
    DailyAnalytics,
    GuitarSession,
    LeetcodeProblem,
    ReadingSession,
    Streak,
    Task,
)

HABIT_LABELS = {
    "guitar": "Guitar Practice",
    "reading": "Book Reading",
    "leetcode": "LeetCode",
    "tasks": "Tasks",
}


# ---------------------------------------------------------------------------
# Daily aggregation (used by /analytics/today|weekly|monthly and Celery beat)
# ---------------------------------------------------------------------------

def compute_daily_analytics(db: Session, user_id: int, target_date: date) -> DailyAnalytics:
    guitar_minutes = (
        db.query(func.sum(GuitarSession.duration_minutes))
        .filter(GuitarSession.user_id == user_id, func.date(GuitarSession.created_at) == target_date)
        .scalar()
        or 0
    )
    reading_minutes = (
        db.query(func.sum(ReadingSession.duration_minutes))
        .join(Book)
        .filter(Book.user_id == user_id, ReadingSession.session_date == target_date)
        .scalar()
        or 0
    )
    leetcode_count = (
        db.query(LeetcodeProblem)
        .filter(
            LeetcodeProblem.user_id == user_id,
            LeetcodeProblem.solved == True,  # noqa: E712
            LeetcodeProblem.solved_date == target_date,
        )
        .count()
    )
    tasks_completed = (
        db.query(Task)
        .filter(Task.user_id == user_id, Task.task_date == target_date, Task.completed == True)  # noqa: E712
        .count()
    )

    record = (
        db.query(DailyAnalytics)
        .filter(DailyAnalytics.user_id == user_id, DailyAnalytics.date == target_date)
        .first()
    )
    if not record:
        record = DailyAnalytics(user_id=user_id, date=target_date)
        db.add(record)

    record.guitar_minutes = guitar_minutes
    record.reading_minutes = reading_minutes
    record.leetcode_count = leetcode_count
    record.tasks_completed = tasks_completed

    db.commit()
    db.refresh(record)
    return record


def get_heatmap_data(db: Session, user_id: int, start: date, end: date) -> dict:
    """Per-day totals for every habit between start and end (inclusive), read-only.

    Uses one GROUP BY query per habit (4 total) instead of looping compute_daily_analytics
    per day (4+ queries x every day in the range) - a 30-day heatmap used to cost 120+
    round trips for data that's purely read-only anyway, since only the Celery beat job
    should be writing DailyAnalytics rows, not every dashboard load.
    """
    guitar_rows = (
        db.query(func.date(GuitarSession.created_at), func.sum(GuitarSession.duration_minutes))
        .filter(
            GuitarSession.user_id == user_id,
            func.date(GuitarSession.created_at) >= start,
            func.date(GuitarSession.created_at) <= end,
        )
        .group_by(func.date(GuitarSession.created_at))
        .all()
    )
    reading_rows = (
        db.query(ReadingSession.session_date, func.sum(ReadingSession.duration_minutes))
        .join(Book)
        .filter(Book.user_id == user_id, ReadingSession.session_date >= start, ReadingSession.session_date <= end)
        .group_by(ReadingSession.session_date)
        .all()
    )
    leetcode_rows = (
        db.query(LeetcodeProblem.solved_date, func.count(LeetcodeProblem.id))
        .filter(
            LeetcodeProblem.user_id == user_id,
            LeetcodeProblem.solved == True,  # noqa: E712
            LeetcodeProblem.solved_date >= start,
            LeetcodeProblem.solved_date <= end,
        )
        .group_by(LeetcodeProblem.solved_date)
        .all()
    )
    tasks_rows = (
        db.query(Task.task_date, func.count(Task.id))
        .filter(
            Task.user_id == user_id,
            Task.completed == True,  # noqa: E712
            Task.task_date >= start,
            Task.task_date <= end,
        )
        .group_by(Task.task_date)
        .all()
    )

    result: dict = {}
    for d, minutes in guitar_rows:
        result.setdefault(_to_date(d), {}).setdefault("guitar_minutes", 0)
        result[_to_date(d)]["guitar_minutes"] = minutes or 0
    for d, minutes in reading_rows:
        result.setdefault(_to_date(d), {})["reading_minutes"] = minutes or 0
    for d, count in leetcode_rows:
        result.setdefault(_to_date(d), {})["leetcode_count"] = count or 0
    for d, count in tasks_rows:
        result.setdefault(_to_date(d), {})["tasks_completed"] = count or 0

    return result


# ---------------------------------------------------------------------------
# Activity-date helpers shared by streaks/trends/predictions/anomalies
# ---------------------------------------------------------------------------

def _to_date(value):
    # func.date(...) round-trips as a str on SQLite but a real date on Postgres -
    # normalize so callers (and Date-typed columns like Streak.last_activity_date)
    # always get a real date.
    return date.fromisoformat(value) if isinstance(value, str) else value


def _activity_dates(db: Session, user_id: int, habit_type: str, since: Optional[date] = None) -> set:
    if habit_type == "guitar":
        query = db.query(func.date(GuitarSession.created_at)).filter(GuitarSession.user_id == user_id)
        if since:
            query = query.filter(func.date(GuitarSession.created_at) >= since)
    elif habit_type == "reading":
        query = (
            db.query(ReadingSession.session_date)
            .join(Book)
            .filter(Book.user_id == user_id)
        )
        if since:
            query = query.filter(ReadingSession.session_date >= since)
    elif habit_type == "leetcode":
        query = db.query(LeetcodeProblem.solved_date).filter(
            LeetcodeProblem.user_id == user_id,
            LeetcodeProblem.solved == True,  # noqa: E712
            LeetcodeProblem.solved_date.isnot(None),
        )
        if since:
            query = query.filter(LeetcodeProblem.solved_date >= since)
    elif habit_type == "tasks":
        query = db.query(Task.task_date).filter(Task.user_id == user_id, Task.completed == True)  # noqa: E712
        if since:
            query = query.filter(Task.task_date >= since)
    else:
        raise ValueError(f"Unknown habit_type: {habit_type}")

    return {_to_date(row[0]) for row in query.all() if row[0] is not None}


def _metric_total(db: Session, user_id: int, habit_type: str, start: date, end: date) -> float:
    """Sum of the 'primary metric' for a habit between start and end (inclusive)."""
    if habit_type == "guitar":
        return (
            db.query(func.sum(GuitarSession.duration_minutes))
            .filter(
                GuitarSession.user_id == user_id,
                func.date(GuitarSession.created_at) >= start,
                func.date(GuitarSession.created_at) <= end,
            )
            .scalar()
            or 0
        )
    if habit_type == "reading":
        return (
            db.query(func.sum(ReadingSession.pages_read))
            .join(Book)
            .filter(Book.user_id == user_id, ReadingSession.session_date >= start, ReadingSession.session_date <= end)
            .scalar()
            or 0
        )
    if habit_type == "leetcode":
        return (
            db.query(LeetcodeProblem)
            .filter(
                LeetcodeProblem.user_id == user_id,
                LeetcodeProblem.solved == True,  # noqa: E712
                LeetcodeProblem.solved_date >= start,
                LeetcodeProblem.solved_date <= end,
            )
            .count()
        )
    if habit_type == "tasks":
        return (
            db.query(Task)
            .filter(
                Task.user_id == user_id,
                Task.completed == True,  # noqa: E712
                Task.task_date >= start,
                Task.task_date <= end,
            )
            .count()
        )
    raise ValueError(f"Unknown habit_type: {habit_type}")


def _longest_streak(dates_set: set) -> int:
    if not dates_set:
        return 0
    ordered = sorted(dates_set)
    best = current = 1
    for prev, curr in zip(ordered, ordered[1:]):
        if curr - prev == timedelta(days=1):
            current += 1
            best = max(best, current)
        else:
            current = 1
    return best


def _current_streak(dates_set: set, today: date) -> int:
    if today in dates_set:
        anchor = today
    elif (today - timedelta(days=1)) in dates_set:
        anchor = today - timedelta(days=1)
    else:
        return 0
    count = 0
    d = anchor
    while d in dates_set:
        count += 1
        d -= timedelta(days=1)
    return count


# ---------------------------------------------------------------------------
# Public analytics functions
# ---------------------------------------------------------------------------

def calculate_streaks(db: Session, user_id: int, today: Optional[date] = None) -> list[dict]:
    today = today or date.today()
    records_by_habit = {
        s.habit_type: s for s in db.query(Streak).filter(Streak.user_id == user_id).all()
    }

    results = []
    for habit_type in HABIT_TYPES:
        dates_set = _activity_dates(db, user_id, habit_type)
        current = _current_streak(dates_set, today)
        best = _longest_streak(dates_set)
        last_activity = max(dates_set) if dates_set else None

        record = records_by_habit.get(habit_type)
        if not record:
            record = Streak(user_id=user_id, habit_type=habit_type)
            db.add(record)
        record.current_count = current
        record.best_count = max(best, record.best_count or 0)
        record.last_activity_date = last_activity

        results.append(
            {
                "habit_type": habit_type,
                "label": HABIT_LABELS[habit_type],
                "current_count": record.current_count,
                "best_count": record.best_count,
                "last_activity_date": record.last_activity_date,
            }
        )

    db.commit()  # single round trip for all four habit upserts instead of one per habit
    return results


def _period_days(period: str) -> int:
    if period == "week":
        return 7
    if period == "month":
        return 30
    raise ValueError("period must be 'week' or 'month'")


def calculate_trends(db: Session, user_id: int, period: str = "week", today: Optional[date] = None) -> list[dict]:
    today = today or date.today()
    span = _period_days(period)
    current_start = today - timedelta(days=span - 1)
    previous_end = current_start - timedelta(days=1)
    previous_start = previous_end - timedelta(days=span - 1)

    trends = []
    for habit_type in HABIT_TYPES:
        current_total = _metric_total(db, user_id, habit_type, current_start, today)
        previous_total = _metric_total(db, user_id, habit_type, previous_start, previous_end)
        if previous_total:
            pct_change = round(((current_total - previous_total) / previous_total) * 100, 1)
        else:
            pct_change = 100.0 if current_total > 0 else 0.0

        trends.append(
            {
                "habit_type": habit_type,
                "label": HABIT_LABELS[habit_type],
                "period": period,
                "current_total": current_total,
                "previous_total": previous_total,
                "pct_change": pct_change,
                "velocity_per_week": round(current_total / (span / 7), 2),
            }
        )
    return trends


def calculate_comparison(db: Session, user_id: int, today: Optional[date] = None) -> list[dict]:
    """This week vs last week, per habit."""
    return calculate_trends(db, user_id, period="week", today=today)


def calculate_anomalies(
    db: Session,
    user_id: int,
    threshold_pct: float = 40.0,
    today: Optional[date] = None,
    trends: Optional[list[dict]] = None,
) -> list[dict]:
    """Pass `trends` (from calculate_trends) when the caller already has it, to avoid recomputing it."""
    if trends is None:
        trends = calculate_trends(db, user_id, period="week", today=today)
    anomalies = []
    for trend in trends:
        if trend["previous_total"] > 0 and trend["pct_change"] <= -threshold_pct:
            anomalies.append(
                {
                    "habit_type": trend["habit_type"],
                    "label": trend["label"],
                    "pct_change": trend["pct_change"],
                    "current_total": trend["current_total"],
                    "previous_total": trend["previous_total"],
                    "message": (
                        f"{trend['label']} activity dropped {abs(trend['pct_change']):.0f}% "
                        "vs. the previous week."
                    ),
                }
            )
    return anomalies


def generate_insights(
    db: Session,
    user_id: int,
    today: Optional[date] = None,
    trends: Optional[list[dict]] = None,
    streaks: Optional[list[dict]] = None,
    anomalies: Optional[list[dict]] = None,
) -> list[str]:
    """Pass precomputed trends/streaks/anomalies when the caller already has them
    (e.g. /analytics/summary) so this doesn't silently redo those queries."""
    today = today or date.today()
    insights: list[str] = []

    if trends is None:
        trends = calculate_trends(db, user_id, period="week", today=today)
    for trend in trends:
        if trend["current_total"] == 0 and trend["previous_total"] == 0:
            continue
        direction = "up" if trend["pct_change"] > 0 else "down" if trend["pct_change"] < 0 else "flat"
        if direction != "flat":
            insights.append(
                f"{trend['label']} is {direction} {abs(trend['pct_change']):.0f}% this week vs. last week."
            )

    if streaks is None:
        streaks = calculate_streaks(db, user_id, today=today)
    for streak in streaks:
        if streak["current_count"] >= 3:
            insights.append(f"You're on a {streak['current_count']}-day {streak['label']} streak. Keep it up!")

    if anomalies is None:
        anomalies = calculate_anomalies(db, user_id, today=today, trends=trends)
    for anomaly in anomalies:
        insights.append(f"Heads up: {anomaly['message']}")

    if not insights:
        insights.append("Not enough activity yet this week to generate insights — log a session to get started.")

    return insights


def calculate_predictions(db: Session, user_id: int, lookback_days: int = 60, today: Optional[date] = None) -> list[dict]:
    """Predict the probability of activity tomorrow, per habit.

    Uses a logistic regression over (day-of-week, trailing 7-day rate) when there's
    enough history (scikit-learn); otherwise falls back to a weighted heuristic so
    the endpoint still returns a sensible answer for a brand-new account.
    """
    today = today or date.today()
    tomorrow = today + timedelta(days=1)
    since = today - timedelta(days=lookback_days - 1)

    predictions = []
    for habit_type in HABIT_TYPES:
        dates_set = _activity_dates(db, user_id, habit_type, since=since)
        days = [since + timedelta(days=i) for i in range(lookback_days)]
        labels = [1 if d in dates_set else 0 for d in days]

        probability = _predict_probability(days, labels, tomorrow)
        predictions.append(
            {
                "habit_type": habit_type,
                "label": HABIT_LABELS[habit_type],
                "date": tomorrow,
                "probability": round(probability, 2),
                "will_likely_practice": probability >= 0.5,
            }
        )
    return predictions


def _predict_probability(days: list[date], labels: list[int], target_day: date) -> float:
    sample_count = sum(1 for x in labels if x is not None)
    weekday_target = target_day.weekday()

    def weekday_rate() -> float:
        same_weekday = [lbl for d, lbl in zip(days, labels) if d.weekday() == weekday_target]
        return sum(same_weekday) / len(same_weekday) if same_weekday else 0.5

    def rolling_rate(window: int = 7) -> float:
        recent = labels[-window:] if len(labels) >= window else labels
        return sum(recent) / len(recent) if recent else 0.5

    if sample_count < 14 or sum(labels) == 0 or sum(labels) == len(labels):
        # Not enough signal (or no variance) to fit a model - use the heuristic blend.
        return 0.6 * rolling_rate() + 0.4 * weekday_rate()

    try:
        from sklearn.linear_model import LogisticRegression

        X = [
            [
                math.sin(2 * math.pi * d.weekday() / 7),
                math.cos(2 * math.pi * d.weekday() / 7),
                sum(labels[max(0, i - 6): i + 1]) / len(labels[max(0, i - 6): i + 1]),
            ]
            for i, d in enumerate(days)
        ]
        y = labels
        model = LogisticRegression()
        model.fit(X, y)

        target_features = [
            math.sin(2 * math.pi * weekday_target / 7),
            math.cos(2 * math.pi * weekday_target / 7),
            rolling_rate(),
        ]
        return float(model.predict_proba([target_features])[0][1])
    except Exception as exc:  # noqa: BLE001 - sklearn missing/failure -> heuristic fallback
        logger.warning("Prediction model failed, falling back to heuristic: %s", exc)
        return 0.6 * rolling_rate() + 0.4 * weekday_rate()


def get_active_days(db: Session, user_id: int, start: date, end: date) -> set:
    """Distinct calendar days with activity in ANY habit, between start and end inclusive."""
    active: set = set()
    for habit_type in HABIT_TYPES:
        for d in _activity_dates(db, user_id, habit_type, since=start):
            if start <= d <= end:
                active.add(d)
    return active


def get_peak_hours(db: Session, user_id: int, habit_type: str, top_n: int = 3) -> dict:
    """Hour-of-day (0-23) the user is most often active for a given habit.

    Only guitar, reading, and leetcode have a timestamp; tasks use scheduled_time
    when present. Domains without enough data return an empty list with a note.
    """
    hours: list[int] = []

    if habit_type == "guitar":
        rows = db.query(GuitarSession.created_at).filter(GuitarSession.user_id == user_id).all()
        hours = [r[0].hour for r in rows if r[0] is not None]
    elif habit_type == "reading":
        rows = (
            db.query(ReadingSession.created_at)
            .join(Book)
            .filter(Book.user_id == user_id)
            .all()
        )
        hours = [r[0].hour for r in rows if r[0] is not None]
    elif habit_type == "leetcode":
        rows = db.query(LeetcodeProblem.created_at).filter(LeetcodeProblem.user_id == user_id).all()
        hours = [r[0].hour for r in rows if r[0] is not None]
    elif habit_type == "tasks":
        rows = (
            db.query(Task.scheduled_time)
            .filter(Task.user_id == user_id, Task.scheduled_time.isnot(None))
            .all()
        )
        hours = [r[0].hour for r in rows if r[0] is not None]
    else:
        raise ValueError(f"Unknown habit_type: {habit_type}")

    if not hours:
        return {"habit_type": habit_type, "peak_hours": [], "note": "Not enough timestamped activity yet."}

    counts = Counter(hours).most_common(top_n)
    return {
        "habit_type": habit_type,
        "peak_hours": [{"hour": hour, "count": count} for hour, count in counts],
        "note": None,
    }
