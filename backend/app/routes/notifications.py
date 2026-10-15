from datetime import date
from typing import List, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Notification, User
from app.schemas import EmailPreferencesResponse, EmailPreferencesUpdate, NotificationResponse
from app.services.email_service import generate_daily_digest_email, generate_weekly_digest_email, send_email
from app.services.notification_service import get_or_create_email_preferences
from app.utils.analytics_engine import calculate_streaks, calculate_trends, compute_daily_analytics, generate_insights

router = APIRouter(prefix="/notifications", tags=["notifications"])

CURRENT_USER_ID = 1


@router.get("", response_model=List[NotificationResponse])
def list_notifications(db: Session = Depends(get_db)):
    return (
        db.query(Notification)
        .filter(Notification.user_id == CURRENT_USER_ID, Notification.read == False)  # noqa: E712
        .order_by(Notification.created_at.desc())
        .all()
    )


@router.post("/{notification_id}/read", response_model=NotificationResponse)
def mark_notification_read(notification_id: int, db: Session = Depends(get_db)):
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.user_id == CURRENT_USER_ID)
        .first()
    )
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.read = True
    db.commit()
    db.refresh(notification)
    return notification


@router.put("/preferences", response_model=EmailPreferencesResponse)
def update_preferences(update: EmailPreferencesUpdate, db: Session = Depends(get_db)):
    prefs = get_or_create_email_preferences(db, CURRENT_USER_ID)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(prefs, field, value)
    db.commit()
    db.refresh(prefs)
    return prefs


@router.post("/test")
def send_test_email(db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == CURRENT_USER_ID).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    html = f"<p>This is a test email from Productivity Analytics for <strong>{user.username}</strong>.</p>"
    sent = send_email(user.email, "Productivity Analytics - Test Email", html)
    if not sent:
        raise HTTPException(
            status_code=502,
            detail="Email not sent - SENDGRID_API_KEY is missing or SendGrid rejected the request. Check server logs.",
        )
    return {"detail": f"Test email sent to {user.email}"}


@router.get("/digest", response_class=HTMLResponse)
def preview_digest(type: Literal["daily", "weekly"] = "daily", db: Session = Depends(get_db)):
    """Renders the digest HTML for preview in a browser - does not send anything."""
    user = db.query(User).filter(User.id == CURRENT_USER_ID).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    today = date.today()
    if type == "daily":
        analytics = compute_daily_analytics(db, CURRENT_USER_ID, today)
        summary = {
            "guitar_minutes": analytics.guitar_minutes,
            "reading_minutes": analytics.reading_minutes,
            "leetcode_count": analytics.leetcode_count,
            "tasks_completed": analytics.tasks_completed,
            "insights": generate_insights(db, CURRENT_USER_ID, today=today),
        }
        return generate_daily_digest_email(user, summary)

    trends = calculate_trends(db, CURRENT_USER_ID, period="week", today=today)
    streaks = calculate_streaks(db, CURRENT_USER_ID, today=today)
    summary = {
        "trends": trends,
        "streaks": streaks,
        "insights": generate_insights(db, CURRENT_USER_ID, today=today, trends=trends, streaks=streaks),
    }
    return generate_weekly_digest_email(user, summary)
