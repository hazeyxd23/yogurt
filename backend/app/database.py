from contextvars import ContextVar

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(
    settings.database_url,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_pre_ping=True,
    pool_recycle=1800,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Per-request DB query counter, read by app/middleware/performance.py
query_count_ctx: ContextVar[int] = ContextVar("query_count_ctx", default=0)


@event.listens_for(engine, "after_cursor_execute")
def _count_query(conn, cursor, statement, parameters, context, executemany):
    try:
        query_count_ctx.set(query_count_ctx.get() + 1)
    except LookupError:
        pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
