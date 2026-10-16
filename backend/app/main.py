from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import models  # noqa: F401  (registers models on Base before create_all)
from app.cache import cache_stats
from app.config import logger
from app.database import Base, SessionLocal, engine
from app.middleware.performance import PerformanceMiddleware
from app.models import User
from app.utils.migrations import ensure_columns
from app.routes import agent, analytics, guitar, integrations, leetcode, notes, notifications, reading, tasks

DEFAULT_USER_ID = 1
DEFAULT_USER_EMAIL = "user@example.com"
DEFAULT_USERNAME = "bhavya"

app = FastAPI(title="Productivity Analytics API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(PerformanceMiddleware)

app.include_router(guitar.router)
app.include_router(reading.router)
app.include_router(leetcode.router)
app.include_router(tasks.router)
app.include_router(analytics.router)
app.include_router(notifications.router)
app.include_router(integrations.router)
app.include_router(notes.router)
app.include_router(agent.router)


def _seed_default_user() -> None:
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.id == DEFAULT_USER_ID).first():
            db.add(User(id=DEFAULT_USER_ID, username=DEFAULT_USERNAME, email=DEFAULT_USER_EMAIL))
            db.commit()
            logger.info("Seeded default user id=%s (%s)", DEFAULT_USER_ID, DEFAULT_USER_EMAIL)
    finally:
        db.close()


@app.on_event("startup")
async def on_startup():
    Base.metadata.create_all(bind=engine)
    ensure_columns(engine)
    _seed_default_user()

    stats = cache_stats()
    if stats["connected"]:
        logger.info("Redis cache is connected - analytics responses will be cached.")
    else:
        logger.warning("Redis is unavailable - app will run without caching (graceful degradation).")


@app.get("/health")
async def health_check():
    return {"status": "ok", "cache": cache_stats()}
