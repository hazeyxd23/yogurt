import json
import time
from typing import Any, Optional

import redis

from app.config import logger, settings

_stats = {"hits": 0, "misses": 0, "errors": 0}

# While Redis is down, only retry the connection this often. Without a cooldown every
# cache call (including the per-request stats lookup in the performance middleware,
# which runs on the event loop) would block for the full connect timeout.
RECONNECT_INTERVAL_SECONDS = 30
_last_connect_attempt = 0.0

try:
    _client: Optional["redis.Redis"] = redis.Redis.from_url(
        settings.redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1
    )
    _client.ping()
    logger.info("Connected to Redis at %s", settings.redis_url)
except Exception as exc:  # noqa: BLE001 - any Redis/connection error means "no cache"
    logger.warning("Redis unavailable (%s) - caching disabled, app will run without it", exc)
    _client = None
_last_connect_attempt = time.monotonic()


def _get_client() -> Optional["redis.Redis"]:
    """Re-check connectivity lazily so Redis coming up later is picked up without a restart."""
    global _client, _last_connect_attempt
    if _client is not None:
        return _client
    now = time.monotonic()
    if now - _last_connect_attempt < RECONNECT_INTERVAL_SECONDS:
        return None
    _last_connect_attempt = now
    try:
        candidate = redis.Redis.from_url(
            settings.redis_url, decode_responses=True, socket_connect_timeout=1, socket_timeout=1
        )
        candidate.ping()
        _client = candidate
        logger.info("Reconnected to Redis at %s", settings.redis_url)
    except Exception:  # noqa: BLE001
        return None
    return _client


def cache_get(key: str) -> Optional[Any]:
    client = _get_client()
    if client is None:
        return None
    try:
        raw = client.get(key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache_get(%s) failed: %s", key, exc)
        _stats["errors"] += 1
        return None
    if raw is None:
        _stats["misses"] += 1
        return None
    _stats["hits"] += 1
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return raw


def cache_set(key: str, value: Any, ttl: int = settings.cache_default_ttl_seconds) -> bool:
    client = _get_client()
    if client is None:
        return False
    try:
        client.set(key, json.dumps(value, default=str), ex=ttl)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache_set(%s) failed: %s", key, exc)
        _stats["errors"] += 1
        return False


def cache_delete(key: str) -> bool:
    client = _get_client()
    if client is None:
        return False
    try:
        client.delete(key)
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache_delete(%s) failed: %s", key, exc)
        _stats["errors"] += 1
        return False


def cache_clear_pattern(pattern: str) -> int:
    """Delete all keys matching a glob-style pattern, e.g. 'analytics:1:*'."""
    client = _get_client()
    if client is None:
        return 0
    try:
        keys = list(client.scan_iter(match=pattern, count=200))
        if not keys:
            return 0
        return client.delete(*keys)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache_clear_pattern(%s) failed: %s", pattern, exc)
        _stats["errors"] += 1
        return 0


def invalidate_analytics_cache(user_id: int) -> int:
    """Call this after any create/update/delete on a domain table so cached
    /analytics/* responses don't serve stale data for the rest of their TTL.
    """
    return cache_clear_pattern(f"analytics:{user_id}:*")


def cache_stats() -> dict:
    total = _stats["hits"] + _stats["misses"]
    hit_rate = (_stats["hits"] / total) if total else 0.0
    return {**_stats, "hit_rate": round(hit_rate, 4), "connected": _client is not None}
