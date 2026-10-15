"""HTML email generation + SendGrid delivery.

If SENDGRID_API_KEY isn't configured, send_email() logs and returns False
instead of raising, so the rest of the app (and Celery tasks) can degrade
gracefully when email isn't set up yet.
"""

import requests

from app.config import logger, settings
from app.models import User

_BASE_STYLE = """
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
         background:#f4f5f7; margin:0; padding:0; color:#1f2430; }
  .container { max-width:560px; margin:0 auto; padding:24px; }
  .card { background:#ffffff; border-radius:10px; padding:24px; box-shadow:0 1px 3px rgba(0,0,0,0.08); }
  h1 { font-size:20px; margin:0 0 12px; }
  h2 { font-size:15px; margin:20px 0 8px; color:#4b5563; }
  .stat-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #eef0f3; }
  .stat-label { color:#6b7280; font-size:14px; }
  .stat-value { font-weight:600; font-size:14px; }
  .insight { background:#f0f4ff; border-left:3px solid #4f6df5; padding:8px 12px; margin:8px 0;
             font-size:13px; border-radius:4px; }
  .footer { font-size:11px; color:#9ca3af; margin-top:20px; text-align:center; }
</style>
"""


def _shell(title: str, body_html: str) -> str:
    return f"""<!doctype html>
<html>
<head><meta charset="utf-8">{_BASE_STYLE}</head>
<body>
  <div class="container">
    <div class="card">
      <h1>{title}</h1>
      {body_html}
    </div>
    <div class="footer">
      You're receiving this because email notifications are enabled in your
      Productivity Analytics preferences. Update them anytime via
      PUT /notifications/preferences.
    </div>
  </div>
</body>
</html>"""


def _stat_row(label: str, value) -> str:
    return f'<div class="stat-row"><span class="stat-label">{label}</span><span class="stat-value">{value}</span></div>'


def generate_daily_digest_email(user: User, summary: dict) -> str:
    body = "<h2>Today</h2>"
    body += _stat_row("Guitar practice", f"{summary.get('guitar_minutes', 0)} min")
    body += _stat_row("Reading", f"{summary.get('reading_minutes', 0)} min")
    body += _stat_row("LeetCode solved", summary.get("leetcode_count", 0))
    body += _stat_row("Tasks completed", summary.get("tasks_completed", 0))

    insights = summary.get("insights") or []
    if insights:
        body += "<h2>Insights</h2>"
        for insight in insights:
            body += f'<div class="insight">{insight}</div>'

    return _shell(f"Daily Digest for {user.username}", body)


def generate_weekly_digest_email(user: User, summary: dict) -> str:
    body = "<h2>This week vs. last week</h2>"
    for trend in summary.get("trends", []):
        arrow = "▲" if trend["pct_change"] > 0 else "▼" if trend["pct_change"] < 0 else "▬"
        body += _stat_row(trend["label"], f"{trend['current_total']} ({arrow} {abs(trend['pct_change']):.0f}%)")

    body += "<h2>Streaks</h2>"
    for streak in summary.get("streaks", []):
        body += _stat_row(streak["label"], f"{streak['current_count']} day streak (best {streak['best_count']})")

    insights = summary.get("insights") or []
    if insights:
        body += "<h2>Insights</h2>"
        for insight in insights:
            body += f'<div class="insight">{insight}</div>'

    return _shell(f"Weekly Summary for {user.username}", body)


def generate_streak_alert_email(user: User, habit_label: str, streak: dict) -> str:
    body = f"""
    <p>Your <strong>{habit_label}</strong> streak was broken.</p>
    {_stat_row("Last streak length", f"{streak.get('previous_count', streak.get('current_count', 0))} days")}
    {_stat_row("Best streak", f"{streak.get('best_count', 0)} days")}
    <p>Log a session today to start a new one.</p>
    """
    return _shell(f"Streak Alert: {habit_label}", body)


def send_email(to: str, subject: str, html_content: str) -> bool:
    if not settings.sendgrid_api_key:
        logger.warning("SENDGRID_API_KEY not configured - skipping email to %s (%s)", to, subject)
        return False

    payload = {
        "personalizations": [{"to": [{"email": to}]}],
        "from": {"email": settings.sendgrid_from_email},
        "subject": subject,
        "content": [{"type": "text/html", "value": html_content}],
    }
    headers = {
        "Authorization": f"Bearer {settings.sendgrid_api_key}",
        "Content-Type": "application/json",
    }
    try:
        response = requests.post(
            "https://api.sendgrid.com/v3/mail/send", json=payload, headers=headers, timeout=10
        )
        if response.status_code >= 400:
            logger.error("SendGrid error %s: %s", response.status_code, response.text)
            return False
        return True
    except requests.RequestException as exc:
        logger.error("SendGrid request failed: %s", exc)
        return False
