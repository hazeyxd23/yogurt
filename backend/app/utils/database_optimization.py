"""Query-level performance helpers.

Connection pooling lives on the engine itself (see app/database.py: pool_size,
max_overflow, pool_pre_ping). Composite indexes for the hot query paths are
declared directly on the models via __table_args__ so they're created
automatically by Base.metadata.create_all:
    - guitar_sessions(user_id, created_at)   -> GuitarSession
    - reading_sessions(book_id, session_date) -> ReadingSession
    - leetcode_problems(user_id, solved)      -> LeetcodeProblem
    - tasks(user_id, task_date, priority)     -> Task
    - daily_analytics(user_id, date)          -> DailyAnalytics
"""

from typing import Tuple

from sqlalchemy.orm import Query


def paginate(query: Query, skip: int = 0, limit: int = 100) -> Tuple[list, int]:
    """Apply skip/limit to a query and return (items, total_count).

    total_count reflects the unpaginated result set, so callers can build
    "page X of Y" UI without a second round trip.
    """
    skip = max(skip, 0)
    limit = max(min(limit, 500), 1)
    total = query.order_by(None).count()
    items = query.offset(skip).limit(limit).all()
    return items, total
