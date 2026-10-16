import logging
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    database_url: str = "postgresql://postgres:postgres@localhost:5432/productivity_analytics"
    db_pool_size: int = 10
    db_max_overflow: int = 20

    # Redis
    redis_url: str = "redis://localhost:6379/0"
    cache_default_ttl_seconds: int = 3600

    # Celery
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://localhost:6379/1"

    # Email (SendGrid)
    sendgrid_api_key: str | None = None
    sendgrid_from_email: str = "noreply@productivity-analytics.app"

    # GitHub / Goodreads integrations
    github_api_base_url: str = "https://api.github.com"
    goodreads_api_base_url: str = "https://www.goodreads.com"

    # LLM text-to-SQL agent ("Ask")
    llm_provider: Literal["ollama", "openai"] = "ollama"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3.5:4b"
    llm_timeout_seconds: float = 120.0
    # Connection the agent runs its SQL on; point it at a SELECT-only role
    # (scripts/create_agent_role.py). Falls back to DATABASE_URL.
    agent_database_url: str | None = None
    agent_max_attempts: int = 3
    agent_row_limit: int = 200
    agent_statement_timeout_ms: int = 5000

    # Logging
    log_level: str = "INFO"


settings = Settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)

logger = logging.getLogger("app")
