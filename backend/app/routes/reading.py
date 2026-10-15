from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.cache import invalidate_analytics_cache
from app.database import get_db
from app.models import Book, ReadingSession
from app.schemas import (
    BookCreate,
    BookResponse,
    BookUpdate,
    ReadingSessionCreate,
    ReadingSessionResponse,
    ReadingStatsResponse,
)
from app.utils.database_optimization import paginate

router = APIRouter(tags=["reading"])

CURRENT_USER_ID = 1


@router.post("/books", response_model=BookResponse)
def create_book(book: BookCreate, db: Session = Depends(get_db)):
    db_book = Book(user_id=CURRENT_USER_ID, **book.model_dump())
    db.add(db_book)
    db.commit()
    db.refresh(db_book)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_book


@router.get("/books", response_model=List[BookResponse])
def list_books(status: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(Book).filter(Book.user_id == CURRENT_USER_ID)
    if status:
        query = query.filter(Book.status == status)
    return query.all()


@router.patch("/books/{book_id}", response_model=BookResponse)
def update_book(book_id: int, book_update: BookUpdate, db: Session = Depends(get_db)):
    db_book = db.query(Book).filter(Book.id == book_id, Book.user_id == CURRENT_USER_ID).first()
    if not db_book:
        raise HTTPException(status_code=404, detail="Book not found")
    for field, value in book_update.model_dump(exclude_unset=True).items():
        setattr(db_book, field, value)
    db.commit()
    db.refresh(db_book)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_book


@router.post("/reading/sessions", response_model=ReadingSessionResponse)
def create_reading_session(session: ReadingSessionCreate, db: Session = Depends(get_db)):
    book = db.query(Book).filter(Book.id == session.book_id, Book.user_id == CURRENT_USER_ID).first()
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    data = session.model_dump()
    if data.get("session_date") is None:
        data["session_date"] = date.today()

    db_session = ReadingSession(**data)
    db.add(db_session)

    if session.end_page is not None:
        # The reader's page counter is the source of truth (they may have jumped around).
        page = max(0, session.end_page)
        book.current_page = min(page, book.total_pages) if book.total_pages else page
    else:
        advanced = book.current_page + session.pages_read
        book.current_page = min(advanced, book.total_pages) if book.total_pages else advanced
    if book.total_pages and book.current_page >= book.total_pages:
        book.status = "completed"
    db.commit()
    db.refresh(db_session)
    invalidate_analytics_cache(CURRENT_USER_ID)
    return db_session


@router.get("/reading/sessions", response_model=List[ReadingSessionResponse])
def list_reading_sessions(
    response: Response,
    book_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(ReadingSession).join(Book).filter(Book.user_id == CURRENT_USER_ID)
    if book_id:
        query = query.filter(ReadingSession.book_id == book_id)
    query = query.order_by(ReadingSession.session_date.desc(), ReadingSession.created_at.desc())
    items, total = paginate(query, skip=skip, limit=limit)
    response.headers["X-Total-Count"] = str(total)
    return items


@router.get("/reading/stats", response_model=ReadingStatsResponse)
def reading_stats(db: Session = Depends(get_db)):
    total_pages = (
        db.query(func.sum(ReadingSession.pages_read))
        .join(Book)
        .filter(Book.user_id == CURRENT_USER_ID)
        .scalar()
        or 0
    )
    books_completed = (
        db.query(Book)
        .filter(Book.user_id == CURRENT_USER_ID, Book.status == "completed")
        .count()
    )
    distinct_days = (
        db.query(func.count(func.distinct(ReadingSession.session_date)))
        .join(Book)
        .filter(Book.user_id == CURRENT_USER_ID)
        .scalar()
        or 0
    )
    avg_pages_per_day = (total_pages / distinct_days) if distinct_days else 0.0
    return ReadingStatsResponse(
        total_pages=total_pages,
        books_completed=books_completed,
        avg_pages_per_day=avg_pages_per_day,
    )
