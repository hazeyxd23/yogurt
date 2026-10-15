from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False)
    email = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    guitar_sessions = relationship("GuitarSession", back_populates="user")
    books = relationship("Book", back_populates="user")
    leetcode_problems = relationship("LeetcodeProblem", back_populates="user")
    tasks = relationship("Task", back_populates="user")
    daily_analytics = relationship("DailyAnalytics", back_populates="user")
    streaks = relationship("Streak", back_populates="user")
    notifications = relationship("Notification", back_populates="user")
    email_preferences = relationship("EmailPreferences", back_populates="user", uselist=False)
    integrations = relationship("Integration", back_populates="user")


class GuitarSession(Base):
    __tablename__ = "guitar_sessions"
    __table_args__ = (Index("ix_guitar_sessions_user_created", "user_id", "created_at"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    bpm = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="guitar_sessions")


class Book(Base):
    __tablename__ = "books"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    author = Column(String, nullable=True)
    total_pages = Column(Integer, nullable=True)
    current_page = Column(Integer, default=0)
    status = Column(String, default="reading")  # reading, completed, on_hold, dropped

    user = relationship("User", back_populates="books")
    reading_sessions = relationship("ReadingSession", back_populates="book")


class ReadingSession(Base):
    __tablename__ = "reading_sessions"
    __table_args__ = (Index("ix_reading_sessions_book_date", "book_id", "session_date"),)

    id = Column(Integer, primary_key=True, index=True)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    duration_minutes = Column(Integer, nullable=False)
    pages_read = Column(Integer, default=0)
    key_note = Column(Text, nullable=True)  # the "where I left off" note
    end_page = Column(Integer, nullable=True)  # page the reader stopped on
    session_date = Column(Date, default=date.today)
    # Added in Phase 2 to support get_peak_hours() time-of-day analysis.
    created_at = Column(DateTime, default=datetime.utcnow)

    book = relationship("Book", back_populates="reading_sessions")


class LeetcodeProblem(Base):
    __tablename__ = "leetcode_problems"
    __table_args__ = (Index("ix_leetcode_problems_user_solved", "user_id", "solved"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    question_name = Column(String, nullable=False)
    key_note = Column(Text, nullable=True)
    solved = Column(Boolean, default=False)
    difficulty = Column(String, nullable=True)  # Easy, Medium, Hard
    solved_date = Column(Date, nullable=True)
    # Added in Phase 2 to support get_peak_hours() time-of-day analysis.
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="leetcode_problems")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_user_date_priority", "user_id", "task_date", "priority"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    scheduled_time = Column(DateTime, nullable=True)
    priority = Column(Integer, default=2)  # 1=high, 2=medium, 3=low
    completed = Column(Boolean, default=False)
    task_date = Column(Date, default=date.today)
    # Calendar fields: scheduled_time is the start. Repeating events are stored as one
    # row per occurrence sharing a series_id, so each occurrence keeps its own note
    # (description) and completion.
    end_time = Column(DateTime, nullable=True)
    all_day = Column(Boolean, default=False)
    color = Column(String, nullable=True)
    recurrence = Column(String, nullable=True)  # daily, weekdays, weekly, monthly
    series_id = Column(String, nullable=True, index=True)

    user = relationship("User", back_populates="tasks")


class DailyAnalytics(Base):
    __tablename__ = "daily_analytics"
    __table_args__ = (Index("ix_daily_analytics_user_date", "user_id", "date"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, default=date.today, nullable=False)
    guitar_minutes = Column(Integer, default=0)
    reading_minutes = Column(Integer, default=0)
    leetcode_count = Column(Integer, default=0)
    tasks_completed = Column(Integer, default=0)

    user = relationship("User", back_populates="daily_analytics")


# ---------- Phase 2 additions ----------

HABIT_TYPES = ("guitar", "reading", "leetcode", "tasks")


class Streak(Base):
    __tablename__ = "streaks"
    __table_args__ = (Index("ix_streaks_user_habit", "user_id", "habit_type", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    habit_type = Column(String, nullable=False)  # one of HABIT_TYPES
    current_count = Column(Integer, default=0)
    best_count = Column(Integer, default=0)
    last_activity_date = Column(Date, nullable=True)

    user = relationship("User", back_populates="streaks")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_read", "user_id", "read"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    type = Column(String, nullable=False)  # streak_broken, anomaly, digest, system
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="notifications")


class EmailPreferences(Base):
    __tablename__ = "email_preferences"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    daily_digest = Column(Boolean, default=False)
    streak_alerts = Column(Boolean, default=True)
    weekly_report = Column(Boolean, default=True)

    user = relationship("User", back_populates="email_preferences")


class Integration(Base):
    """Stores third-party integration tokens and last-sync metadata (GitHub, Goodreads, ...)."""

    __tablename__ = "integrations"
    __table_args__ = (Index("ix_integrations_user_provider", "user_id", "provider", unique=True),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    provider = Column(String, nullable=False)  # "github" | "goodreads"
    access_token = Column(String, nullable=False)
    external_ref = Column(String, nullable=True)  # e.g. GitHub "owner/repo"
    last_synced_at = Column(DateTime, nullable=True)
    last_sync_summary = Column(Text, nullable=True)

    user = relationship("User", back_populates="integrations")


class Note(Base):
    """Obsidian-style note. `kind` is "text" (markdown-ish `content` with [[links]] and
    - [ ] tick markers) or "graph" (node/edge/group diagram stored in `graph`).
    A note can also float over a page (`floating_page`) - or over every page when pinned.
    """

    __tablename__ = "notes"
    __table_args__ = (Index("ix_notes_user_updated", "user_id", "updated_at"),)

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(200), nullable=False, default="Untitled")
    kind = Column(String(10), nullable=False, default="text")  # text, graph
    content = Column(Text, nullable=False, default="")
    graph = Column(JSON, nullable=True)
    is_dashboard = Column(Boolean, nullable=False, default=False)
    system_key = Column(String, nullable=True)  # app-owned notes, e.g. "leetcode"

    floating = Column(Boolean, nullable=False, default=False)
    floating_page = Column(String, nullable=True)  # route path, e.g. "/guitar"
    pinned = Column(Boolean, nullable=False, default=False)
    pos_x = Column(Integer, nullable=True)
    pos_y = Column(Integer, nullable=True)
    width = Column(Integer, nullable=True)
    height = Column(Integer, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
