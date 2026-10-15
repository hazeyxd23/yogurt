import uuid
from datetime import date, timedelta
from typing import List, Literal, Optional

from dateutil.relativedelta import relativedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.cache import invalidate_analytics_cache
from app.database import get_db
from app.models import Task
from app.schemas import TaskCreate, TaskResponse, TaskUpdate

router = APIRouter(prefix="/tasks", tags=["tasks"])

CURRENT_USER_ID = 1

# How far ahead repeating events are generated (each occurrence is its own row so it
# can carry its own note and completion state).
OCCURRENCE_LIMITS = {"daily": 60, "weekdays": 60, "weekly": 26, "monthly": 12}

Scope = Literal["this", "following", "all"]


def _occurrence_offsets(rule: str, first: date) -> List[relativedelta]:
    """Offsets (from the first occurrence) of every *later* occurrence of a rule."""
    limit = OCCURRENCE_LIMITS.get(rule, 0)
    if rule == "daily":
        return [relativedelta(days=i) for i in range(1, limit)]
    if rule == "weekly":
        return [relativedelta(weeks=i) for i in range(1, limit)]
    if rule == "monthly":
        return [relativedelta(months=i) for i in range(1, limit)]
    if rule == "weekdays":
        offsets = []
        for i in range(1, limit):
            if (first + timedelta(days=i)).weekday() < 5:
                offsets.append(relativedelta(days=i))
        return offsets
    return []


def _materialize(db: Session, base: Task, rule: str) -> None:
    """Create the later occurrences of a repeating event, copying `base`."""
    base.recurrence = rule
    base.series_id = base.series_id or uuid.uuid4().hex
    for offset in _occurrence_offsets(rule, base.task_date):
        db.add(
            Task(
                user_id=base.user_id,
                title=base.title,
                description=base.description,
                priority=base.priority,
                completed=False,
                task_date=base.task_date + offset,
                scheduled_time=base.scheduled_time + offset if base.scheduled_time else None,
                end_time=base.end_time + offset if base.end_time else None,
                all_day=base.all_day,
                color=base.color,
                recurrence=rule,
                series_id=base.series_id,
            )
        )


def _series(db: Session, task: Task, scope: Scope) -> List[Task]:
    if scope == "this" or not task.series_id:
        return [task]
    query = db.query(Task).filter(Task.user_id == CURRENT_USER_ID, Task.series_id == task.series_id)
    if scope == "following":
        query = query.filter(Task.task_date >= task.task_date)
    return query.order_by(Task.task_date.asc()).all()


def _get_task(db: Session, task_id: int) -> Task:
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == CURRENT_USER_ID).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("", response_model=TaskResponse)
def create_task(task: TaskCreate, db: Session = Depends(get_db)):
    data = task.model_dump()
    rule = data.pop("recurrence") or "none"
    if data.get("task_date") is None:
        data["task_date"] = data["scheduled_time"].date() if data.get("scheduled_time") else date.today()
    db_task = Task(user_id=CURRENT_USER_ID, **data)
    db.add(db_task)
    if rule != "none":
        _materialize(db, db_task, rule)
    db.commit()
    db.refresh(db_task)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_task


@router.get("", response_model=List[TaskResponse])
def list_tasks(
    start: Optional[date] = None,
    end: Optional[date] = None,
    date_filter: Optional[date] = None,
    db: Session = Depends(get_db),
):
    """A date range for the calendar (?start=&end=, inclusive), otherwise one day (today by default)."""
    query = db.query(Task).filter(Task.user_id == CURRENT_USER_ID)
    if start and end:
        query = query.filter(Task.task_date >= start, Task.task_date <= end)
    else:
        query = query.filter(Task.task_date == (date_filter or date.today()))
    return query.order_by(Task.task_date.asc(), Task.scheduled_time.asc(), Task.priority.asc()).all()


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, task_update: TaskUpdate, scope: Scope = "this", db: Session = Depends(get_db)):
    db_task = _get_task(db, task_id)
    changes = task_update.model_dump(exclude_unset=True)
    if changes.get("scheduled_time") is not None and "task_date" not in changes:
        changes["task_date"] = changes["scheduled_time"].date()

    new_rule = changes.pop("recurrence", None)
    targets = _series(db, db_task, scope)

    if len(targets) == 1:
        for field, value in changes.items():
            setattr(db_task, field, value)
    else:
        # Time moves apply as a shift to every occurrence; everything else is copied.
        shift = None
        if changes.get("scheduled_time") is not None and db_task.scheduled_time:
            shift = changes["scheduled_time"] - db_task.scheduled_time
        end_shift = None
        if changes.get("end_time") is not None and db_task.end_time:
            end_shift = changes["end_time"] - db_task.end_time
        shared = {k: v for k, v in changes.items() if k not in ("scheduled_time", "end_time", "task_date", "completed")}
        for t in targets:
            for field, value in shared.items():
                setattr(t, field, value)
            if shift is not None and t.scheduled_time:
                t.scheduled_time = t.scheduled_time + shift
                t.task_date = t.scheduled_time.date()
            if end_shift is not None and t.end_time:
                t.end_time = t.end_time + end_shift
            elif "end_time" in changes and changes["end_time"] is None:
                t.end_time = None
        if "completed" in changes:
            db_task.completed = changes["completed"]

    # Changing the repeat rule rebuilds the occurrences after this one.
    if new_rule is not None and new_rule != (db_task.recurrence or "none"):
        if db_task.series_id:
            (
                db.query(Task)
                .filter(Task.series_id == db_task.series_id, Task.task_date > db_task.task_date, Task.id != db_task.id)
                .delete(synchronize_session=False)
            )
        if new_rule == "none":
            db_task.recurrence = None
            db_task.series_id = None
        else:
            db_task.series_id = uuid.uuid4().hex
            _materialize(db, db_task, new_rule)

    db.commit()
    db.refresh(db_task)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_task


@router.delete("/{task_id}")
def delete_task(task_id: int, scope: Scope = "this", db: Session = Depends(get_db)):
    db_task = _get_task(db, task_id)
    targets = _series(db, db_task, scope)
    for t in targets:
        db.delete(t)
    db.commit()
    invalidate_analytics_cache(CURRENT_USER_ID)
    return {"detail": "Task deleted", "deleted": len(targets)}
