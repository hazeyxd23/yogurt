"""Celery app + background tasks.

Run a worker with:   celery -A app.tasks worker --loglevel=info
Run the scheduler with: celery -A app.tasks beat --loglevel=info
Both need the Redis broker (settings.celery_broker_url) reachable.
"""

from datetime import date

from celery import Celery
from celery.schedules import crontab

from app.config import logger, settings
from app.database import SessionLocal
from app.services import notification_service
from app.utils.analytics_engine import compute_daily_analytics

# Single-user MVP: no auth yet, so every task defaults to user_id=1.
CURRENT_USER_ID = 1

celery_app = Celery(
    "productivity_analytics",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    "aggregate-daily-analytics": {
        "task": "app.tasks.aggregate_daily_analytics",
        "schedule": crontab(hour=0, minute=5),  # just after midnight UTC
    },
    "send-daily-email-digest": {
        "task": "app.tasks.send_daily_email_digest",
        "schedule": crontab(hour=7, minute=0),
    },
    "send-weekly-digest": {
        "task": "app.tasks.send_weekly_digest",
        "schedule": crontab(hour=20, minute=0, day_of_week=0),  # Sunday night
    },
}


@celery_app.task(name="app.tasks.aggregate_daily_analytics")
def aggregate_daily_analytics(user_id: int = CURRENT_USER_ID, target_date_iso: str | None = None) -> dict:
    db = SessionLocal()
    try:
        target = date.fromisoformat(target_date_iso) if target_date_iso else date.today()
        record = compute_daily_analytics(db, user_id, target)
        notification_service.trigger_anomaly_alert(db, user_id, today=target)
        notification_service.send_streak_notification_if_needed(db, user_id)
        return {
            "user_id": user_id,
            "date": target.isoformat(),
            "guitar_minutes": record.guitar_minutes,
            "reading_minutes": record.reading_minutes,
            "leetcode_count": record.leetcode_count,
            "tasks_completed": record.tasks_completed,
        }
    finally:
        db.close()


@celery_app.task(name="app.tasks.send_daily_email_digest", bind=True, max_retries=3, default_retry_delay=60)
def send_daily_email_digest(self, user_id: int = CURRENT_USER_ID) -> dict:
    db = SessionLocal()
    try:
        sent = notification_service.send_daily_email_if_configured(db, user_id)
        return {"user_id": user_id, "sent": sent}
    except Exception as exc:  # noqa: BLE001
        logger.error("send_daily_email_digest failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)
    finally:
        db.close()


@celery_app.task(name="app.tasks.send_weekly_digest", bind=True, max_retries=3, default_retry_delay=60)
def send_weekly_digest(self, user_id: int = CURRENT_USER_ID) -> dict:
    db = SessionLocal()
    try:
        sent = notification_service.send_weekly_email_if_configured(db, user_id)
        return {"user_id": user_id, "sent": sent}
    except Exception as exc:  # noqa: BLE001
        logger.error("send_weekly_digest failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)
    finally:
        db.close()


@celery_app.task(name="app.tasks.send_streak_alert", bind=True, max_retries=3, default_retry_delay=60)
def send_streak_alert(self, user_id: int = CURRENT_USER_ID) -> dict:
    db = SessionLocal()
    try:
        broken_habits = notification_service.send_streak_notification_if_needed(db, user_id)
        return {"user_id": user_id, "broken_habits": broken_habits}
    except Exception as exc:  # noqa: BLE001
        logger.error("send_streak_alert failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)
    finally:
        db.close()
