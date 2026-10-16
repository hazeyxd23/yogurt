from datetime import date, datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------- Guitar ----------

class GuitarSessionCreate(BaseModel):
    duration_minutes: int
    bpm: Optional[int] = None
    notes: Optional[str] = None


class GuitarSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    duration_minutes: int
    bpm: Optional[int] = None
    notes: Optional[str] = None
    created_at: datetime


class GuitarStatsResponse(BaseModel):
    total_minutes: int
    sessions_count: int
    avg_duration: float


# ---------- Books / Reading ----------

class BookCreate(BaseModel):
    title: str
    author: Optional[str] = None
    total_pages: Optional[int] = None
    current_page: int = 0
    status: str = "reading"


class BookUpdate(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    total_pages: Optional[int] = None
    current_page: Optional[int] = None
    status: Optional[str] = None


class BookResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str
    author: Optional[str] = None
    total_pages: Optional[int] = None
    current_page: int
    status: str


class ReadingSessionCreate(BaseModel):
    book_id: int
    duration_minutes: int
    pages_read: int = 0
    key_note: Optional[str] = None
    end_page: Optional[int] = None
    session_date: Optional[date] = None


class ReadingSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    book_id: int
    duration_minutes: int
    pages_read: int
    key_note: Optional[str] = None
    end_page: Optional[int] = None
    session_date: date
    created_at: Optional[datetime] = None


class ReadingStatsResponse(BaseModel):
    total_pages: int
    books_completed: int
    avg_pages_per_day: float


# ---------- Leetcode ----------

class LeetcodeProblemCreate(BaseModel):
    question_name: str
    key_note: Optional[str] = None
    solved: bool = False
    difficulty: Optional[str] = None
    solved_date: Optional[date] = None


class LeetcodeProblemUpdate(BaseModel):
    question_name: Optional[str] = None
    key_note: Optional[str] = None
    solved: Optional[bool] = None
    difficulty: Optional[str] = None
    solved_date: Optional[date] = None


class LeetcodeProblemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    question_name: str
    key_note: Optional[str] = None
    solved: bool
    difficulty: Optional[str] = None
    solved_date: Optional[date] = None


class LeetcodeStatsResponse(BaseModel):
    total_problems: int
    solved_count: int
    unsolved_count: int


# ---------- Tasks ----------

Recurrence = Literal["none", "daily", "weekdays", "weekly", "monthly"]


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    scheduled_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    all_day: bool = False
    color: Optional[str] = None
    recurrence: Recurrence = "none"
    priority: int = 2
    task_date: Optional[date] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scheduled_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    all_day: Optional[bool] = None
    color: Optional[str] = None
    recurrence: Optional[Recurrence] = None
    priority: Optional[int] = None
    completed: Optional[bool] = None
    task_date: Optional[date] = None


class TaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    title: str
    description: Optional[str] = None
    scheduled_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    all_day: Optional[bool] = False
    color: Optional[str] = None
    recurrence: Optional[str] = None
    series_id: Optional[str] = None
    priority: int
    completed: bool
    task_date: date


# ---------- Analytics ----------

class AnalyticsResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    date: date
    guitar_minutes: int
    reading_minutes: int
    leetcode_count: int
    tasks_completed: int


# ---------- Phase 2: advanced analytics ----------

class StreakResponse(BaseModel):
    habit_type: str
    label: str
    current_count: int
    best_count: int
    last_activity_date: Optional[date] = None


class TrendResponse(BaseModel):
    habit_type: str
    label: str
    period: str
    current_total: float
    previous_total: float
    pct_change: float
    velocity_per_week: float


class AnomalyResponse(BaseModel):
    habit_type: str
    label: str
    pct_change: float
    current_total: float
    previous_total: float
    message: str


class PredictionResponse(BaseModel):
    habit_type: str
    label: str
    date: date
    probability: float
    will_likely_practice: bool


class PeakHourEntry(BaseModel):
    hour: int
    count: int


class PeakHoursResponse(BaseModel):
    habit_type: str
    peak_hours: List[PeakHourEntry]
    note: Optional[str] = None


class AnalyticsSummaryResponse(BaseModel):
    streaks: List[StreakResponse]
    trends: List[TrendResponse]
    anomalies: List[AnomalyResponse]
    insights: List[str]


class HeatmapDay(BaseModel):
    date: date
    guitar_minutes: int
    reading_minutes: int
    leetcode_count: int
    tasks_completed: int
    total_activity: int


# ---------- Phase 2: notifications ----------

class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    type: str
    title: str
    message: str
    read: bool
    created_at: datetime


class EmailPreferencesUpdate(BaseModel):
    daily_digest: Optional[bool] = None
    streak_alerts: Optional[bool] = None
    weekly_report: Optional[bool] = None


class EmailPreferencesResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    daily_digest: bool
    streak_alerts: bool
    weekly_report: bool


# ---------- Phase 2: integrations ----------

class IntegrationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    provider: str
    external_ref: Optional[str] = None
    last_synced_at: Optional[datetime] = None
    last_sync_summary: Optional[str] = None


# ---------- Notes ----------

class NoteCreate(BaseModel):
    title: str = Field(default="Untitled", max_length=200)
    kind: Literal["text", "graph"] = "text"
    content: str = ""
    graph: Optional[Dict[str, Any]] = None
    floating: bool = False
    floating_page: Optional[str] = None
    pinned: bool = False
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    content: Optional[str] = None
    graph: Optional[Dict[str, Any]] = None
    floating: Optional[bool] = None
    floating_page: Optional[str] = None
    pinned: Optional[bool] = None
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None


class NoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    kind: str
    content: str
    graph: Optional[Dict[str, Any]] = None
    is_dashboard: bool
    system_key: Optional[str] = None
    floating: bool
    floating_page: Optional[str] = None
    pinned: bool
    pos_x: Optional[int] = None
    pos_y: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    created_at: datetime
    updated_at: datetime


# ---------- Ask (LLM text-to-SQL agent) ----------

class AgentQuestion(BaseModel):
    question: str = Field(min_length=3, max_length=500)


class AgentAttempt(BaseModel):
    sql: Optional[str] = None
    error: Optional[str] = None  # None for the attempt that ran


class AgentAnswerResponse(BaseModel):
    question: str
    answer: str
    answered: bool
    sql: Optional[str] = None
    columns: List[str]
    rows: List[List[Any]]
    truncated: bool
    attempts: List[AgentAttempt]
    provider: str
    model: str
    elapsed_ms: int


class AgentStatusResponse(BaseModel):
    provider: str
    model: str
    available: bool
    readonly_role: bool
    tables: List[str]
