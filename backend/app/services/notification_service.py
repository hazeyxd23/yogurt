from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.config import logger
from app.models import EmailPreferences, Notification, Streak, User
from app.services.email_service import (
    generate_daily_digest_email,
    generate_streak_alert_email,
    generate_weekly_digest_email,
    send_email,
)
from app.utils.analytics_engine import (
    calculate_anomalies,
    calculate_streaks,
    calculate_trends,
    compute_daily_analytics,
    generate_insights,
    get_active_days,
)


def get_or_create_email_preferences(db: Session, user_id: int) -> EmailPreferences:
    prefs = db.query(EmailPreferences).filter(EmailPreferences.user_id == user_id).first()
    if not prefs:
        prefs = EmailPreferences(user_id=user_id)
        db.add(prefs)
        db.commit()
        db.refresh(prefs)
    return prefs


def create_notification(db: Session, user_id: int, type_: str, title: str, message: str) -> Notification:
    notification = Notification(user_id=user_id, type=type_, title=title, message=message)
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


def send_streak_notification_if_needed(db: Session, user_id: int) -> list[str]:
    """Recompute streaks; notify (in-app + optional email) for any habit whose streak just broke."""
    prior_map = {
        s.habit_type: (s.current_count, s.best_count)
        for s in db.query(Streak).filter(Streak.user_id == user_id).all()
    }

    updated = calculate_streaks(db, user_id)
    prefs = get_or_create_email_preferences(db, user_id)
    user = db.query(User).filter(User.id == user_id).first()

    broken_habits = []
    for streak in updated:
        prior_current, _prior_best = prior_map.get(streak["habit_type"], (0, 0))
        if prior_current > 0 and streak["current_count"] == 0:
            title = f"{streak['label']} streak broken"
            message = f"Your {prior_current}-day {streak['label']} streak ended. Best so far: {streak['best_count']} days."
            create_notification(db, user_id, "streak_broken", title, message)
            broken_habits.append(streak["habit_type"])

            if prefs.streak_alerts and user:
                html = generate_streak_alert_email(
                    user, streak["label"], {"previous_count": prior_current, "best_count": streak["best_count"]}
                )
                send_email(user.email, title, html)

    return broken_habits


def send_daily_email_if_configured(db: Session, user_id: int, today: date | None = None) -> bool:
    today = today or date.today()
    prefs = get_or_create_email_preferences(db, user_id)
    if not prefs.daily_digest:
        return False

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning("send_daily_email_if_configured: no user %s", user_id)
        return False

    analytics = compute_daily_analytics(db, user_id, today)
    summary = {
        "guitar_minutes": analytics.guitar_minutes,
        "reading_minutes": analytics.reading_minutes,
        "leetcode_count": analytics.leetcode_count,
        "tasks_completed": analytics.tasks_completed,
        "insights": generate_insights(db, user_id, today=today),
    }
    html = generate_daily_digest_email(user, summary)
    return send_email(user.email, f"Daily Digest - {today.isoformat()}", html)


def send_weekly_email_if_configured(db: Session, user_id: int, today: date | None = None) -> bool:
    today = today or date.today()
    prefs = get_or_create_email_preferences(db, user_id)
    if not prefs.weekly_report:
        return False

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        logger.warning("send_weekly_email_if_configured: no user %s", user_id)
        return False

    week_start = today - timedelta(days=6)
    active_days = get_active_days(db, user_id, week_start, today)

    trends = calculate_trends(db, user_id, period="week", today=today)
    streaks = calculate_streaks(db, user_id, today=today)
    summary = {
        "trends": trends,
        "streaks": streaks,
        "insights": generate_insights(db, user_id, today=today, trends=trends, streaks=streaks),
    }
    html = generate_weekly_digest_email(user, summary)
    subject = f"Weekly Summary: You were active {len(active_days)} days this week"
    return send_email(user.email, subject, html)


def trigger_anomaly_alert(db: Session, user_id: int, today: date | None = None) -> list[dict]:
    anomalies = calculate_anomalies(db, user_id, today=today)
    for anomaly in anomalies:
        create_notification(
            db,
            user_id,
            "anomaly",
            f"{anomaly['label']} activity drop",
            anomaly["message"],
        )
    return anomalies
