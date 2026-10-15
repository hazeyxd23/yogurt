import time

from app.cache import cache_stats
from app.config import logger
from app.database import query_count_ctx

SLOW_REQUEST_THRESHOLD_MS = 500


class PerformanceMiddleware:
    """Times each request, counts DB queries issued during it, and logs slow requests
    (>500ms) to stdout, plus stamps debug response headers.

    Implemented as plain ASGI (not Starlette's BaseHTTPMiddleware) on purpose:
    BaseHTTPMiddleware runs the downstream app in a separate anyio task, which
    isolates ContextVar writes from the request handler/SQLAlchemy event listener
    from ever being visible back here - the query counter would always read 0.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        query_count_ctx.set(0)
        start = time.perf_counter()
        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                elapsed_ms = (time.perf_counter() - start) * 1000
                stats = cache_stats()
                headers = list(message.get("headers", []))
                headers.append((b"x-process-time-ms", f"{elapsed_ms:.1f}".encode()))
                headers.append((b"x-db-query-count", str(query_count_ctx.get()).encode()))
                headers.append((b"x-cache-hit-rate", f"{stats['hit_rate']:.2f}".encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_wrapper)

        elapsed_ms = (time.perf_counter() - start) * 1000
        query_count = query_count_ctx.get()
        stats = cache_stats()

        log_fn = logger.warning if elapsed_ms > SLOW_REQUEST_THRESHOLD_MS else logger.info
        log_fn(
            "%s %s -> %s in %.1fms (db_queries=%d, cache_hit_rate=%.2f)",
            scope.get("method"),
            scope.get("path"),
            status_code,
            elapsed_ms,
            query_count,
            stats["hit_rate"],
        )
