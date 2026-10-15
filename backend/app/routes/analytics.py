import csv
import io
from datetime import date, datetime, timedelta
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.cache import cache_get, cache_set
from app.database import get_db
from app.models import DailyAnalytics
from app.schemas import (
    AnalyticsResponse,
    AnalyticsSummaryResponse,
    AnomalyResponse,
    HeatmapDay,
    PeakHoursResponse,
    PredictionResponse,
    StreakResponse,
    TrendResponse,
)
from app.utils.analytics_engine import (
    calculate_anomalies,
    calculate_comparison,
    calculate_predictions,
    calculate_streaks,
    calculate_trends,
    compute_daily_analytics,
    generate_insights,
    get_heatmap_data,
    get_peak_hours,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])

CURRENT_USER_ID = 1
CACHE_TTL = 3600


def _cache_key(name: str, **params) -> str:
    parts = ":".join(f"{k}={v}" for k, v in sorted(params.items()))
    # Every date-dependent calculation (streaks, trends, ...) is keyed by today's date
    # so a new day naturally causes a cache miss - a write-triggered invalidation alone
    # can't catch "yesterday's cached streak is stale because a new day started with no
    # activity yet", since no write occurred to trigger it.
    return f"analytics:{CURRENT_USER_ID}:{date.today().isoformat()}:{name}:{parts}"


# ---------- Basic daily aggregation (Phase 1, kept for the dashboard) ----------

@router.get("/today", response_model=AnalyticsResponse)
def analytics_today(db: Session = Depends(get_db)):
    return compute_daily_analytics(db, CURRENT_USER_ID, date.today())


@router.get("/weekly", response_model=List[AnalyticsResponse])
def analytics_weekly(db: Session = Depends(get_db)):
    today = date.today()
    return [compute_daily_analytics(db, CURRENT_USER_ID, today - timedelta(days=o)) for o in range(6, -1, -1)]


@router.get("/monthly", response_model=List[AnalyticsResponse])
def analytics_monthly(db: Session = Depends(get_db)):
    today = date.today()
    return [compute_daily_analytics(db, CURRENT_USER_ID, today - timedelta(days=o)) for o in range(29, -1, -1)]


# ---------- Phase 2: advanced analytics (Redis-cached, 1h TTL) ----------

@router.get("/summary", response_model=AnalyticsSummaryResponse)
def analytics_summary(db: Session = Depends(get_db)):
    key = _cache_key("summary")
    cached = cache_get(key)
    if cached:
        return cached

    streaks = calculate_streaks(db, CURRENT_USER_ID)
    trends = calculate_trends(db, CURRENT_USER_ID, period="week")
    anomalies = calculate_anomalies(db, CURRENT_USER_ID, trends=trends)
    insights = generate_insights(db, CURRENT_USER_ID, trends=trends, streaks=streaks, anomalies=anomalies)

    result = {"streaks": streaks, "trends": trends, "anomalies": anomalies, "insights": insights}
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/streaks", response_model=List[StreakResponse])
def analytics_streaks(db: Session = Depends(get_db)):
    key = _cache_key("streaks")
    cached = cache_get(key)
    if cached:
        return cached
    result = calculate_streaks(db, CURRENT_USER_ID)
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/trends", response_model=List[TrendResponse])
def analytics_trends(period: Literal["week", "month"] = "week", db: Session = Depends(get_db)):
    key = _cache_key("trends", period=period)
    cached = cache_get(key)
    if cached:
        return cached
    result = calculate_trends(db, CURRENT_USER_ID, period=period)
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/predictions", response_model=List[PredictionResponse])
def analytics_predictions(db: Session = Depends(get_db)):
    key = _cache_key("predictions")
    cached = cache_get(key)
    if cached:
        return cached
    result = calculate_predictions(db, CURRENT_USER_ID)
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/comparison", response_model=List[TrendResponse])
def analytics_comparison(db: Session = Depends(get_db)):
    key = _cache_key("comparison")
    cached = cache_get(key)
    if cached:
        return cached
    result = calculate_comparison(db, CURRENT_USER_ID)
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/anomalies", response_model=List[AnomalyResponse])
def analytics_anomalies(db: Session = Depends(get_db)):
    key = _cache_key("anomalies")
    cached = cache_get(key)
    if cached:
        return cached
    result = calculate_anomalies(db, CURRENT_USER_ID)
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/peak-hours", response_model=PeakHoursResponse)
def analytics_peak_hours(
    habit_type: Literal["guitar", "reading", "leetcode", "tasks"] = "guitar",
    db: Session = Depends(get_db),
):
    key = _cache_key("peak_hours", habit_type=habit_type)
    cached = cache_get(key)
    if cached:
        return cached
    result = get_peak_hours(db, CURRENT_USER_ID, habit_type)
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/heatmap", response_model=List[HeatmapDay])
def analytics_heatmap(month: str = Query(..., description="YYYY-MM"), db: Session = Depends(get_db)):
    try:
        month_start = datetime.strptime(month, "%Y-%m").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")

    key = _cache_key("heatmap", month=month)
    cached = cache_get(key)
    if cached:
        return cached

    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    days_in_month = (next_month - month_start).days
    month_end = month_start + timedelta(days=days_in_month - 1)

    by_day = get_heatmap_data(db, CURRENT_USER_ID, month_start, month_end)

    result = []
    for offset in range(days_in_month):
        day = month_start + timedelta(days=offset)
        totals = by_day.get(day, {})
        guitar_minutes = totals.get("guitar_minutes", 0)
        reading_minutes = totals.get("reading_minutes", 0)
        leetcode_count = totals.get("leetcode_count", 0)
        tasks_completed = totals.get("tasks_completed", 0)
        result.append(
            {
                "date": day,
                "guitar_minutes": guitar_minutes,
                "reading_minutes": reading_minutes,
                "leetcode_count": leetcode_count,
                "tasks_completed": tasks_completed,
                "total_activity": guitar_minutes + reading_minutes + leetcode_count + tasks_completed,
            }
        )
    cache_set(key, result, ttl=CACHE_TTL)
    return result


@router.get("/export")
def analytics_export(format: Literal["csv", "pdf"] = "csv", db: Session = Depends(get_db)):
    if format == "pdf":
        raise HTTPException(
            status_code=501,
            detail="PDF export isn't implemented yet - use format=csv. Add a PDF library (e.g. reportlab) to support it.",
        )

    records = (
        db.query(DailyAnalytics)
        .filter(DailyAnalytics.user_id == CURRENT_USER_ID)
        .order_by(DailyAnalytics.date.asc())
        .all()
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["date", "guitar_minutes", "reading_minutes", "leetcode_count", "tasks_completed"])
    for r in records:
        writer.writerow([r.date.isoformat(), r.guitar_minutes, r.reading_minutes, r.leetcode_count, r.tasks_completed])
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=analytics_export.csv"},
    )
