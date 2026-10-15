from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.cache import invalidate_analytics_cache
from app.database import get_db
from app.models import GuitarSession
from app.schemas import GuitarSessionCreate, GuitarSessionResponse, GuitarStatsResponse
from app.utils.database_optimization import paginate

router = APIRouter(prefix="/guitar", tags=["guitar"])

CURRENT_USER_ID = 1


@router.post("/sessions", response_model=GuitarSessionResponse)
def create_guitar_session(session: GuitarSessionCreate, db: Session = Depends(get_db)):
    db_session = GuitarSession(user_id=CURRENT_USER_ID, **session.model_dump())
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_session


@router.get("/sessions", response_model=List[GuitarSessionResponse])
def list_guitar_sessions(
    response: Response,
    date_filter: Optional[date] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(GuitarSession).filter(GuitarSession.user_id == CURRENT_USER_ID)
    if date_filter:
        query = query.filter(func.date(GuitarSession.created_at) == date_filter)
    query = query.order_by(GuitarSession.created_at.desc())
    items, total = paginate(query, skip=skip, limit=limit)
    response.headers["X-Total-Count"] = str(total)
    return items


@router.get("/stats", response_model=GuitarStatsResponse)
def guitar_stats(db: Session = Depends(get_db)):
    query = db.query(GuitarSession).filter(GuitarSession.user_id == CURRENT_USER_ID)
    sessions_count = query.count()
    total_minutes = query.with_entities(func.sum(GuitarSession.duration_minutes)).scalar() or 0
    avg_duration = (total_minutes / sessions_count) if sessions_count else 0.0
    return GuitarStatsResponse(
        total_minutes=total_minutes,
        sessions_count=sessions_count,
        avg_duration=avg_duration,
    )


@router.delete("/sessions/{session_id}")
def delete_guitar_session(session_id: int, db: Session = Depends(get_db)):
    db_session = (
        db.query(GuitarSession)
        .filter(GuitarSession.id == session_id, GuitarSession.user_id == CURRENT_USER_ID)
        .first()
    )
    if not db_session:
        raise HTTPException(status_code=404, detail="Guitar session not found")
    db.delete(db_session)
    db.commit()
    invalidate_analytics_cache(CURRENT_USER_ID)
    return {"detail": "Guitar session deleted"}
