"""FastAPI app: SSE endpoint for Double Counter verification.

Env vars:
  SOLVER_URL   - your turnstile solver base, e.g. http://localhost:6767
  PROXY_URL    - rotating residential proxy, http://user:pass@host:port
  CORS_ORIGINS - comma-separated frontend origins, e.g. http://localhost:5173,https://app.example.com
  MAX_CONCURRENT - how many solves hit the solver at once (default 3)
  SOLVER_NAV_TIMEOUT_MS - solver page-load timeout in ms (default 60000)
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

import counter
from solve import solve_stream, Step


SOLVER_URL = os.environ.get("SOLVER_URL", "http://localhost:6767")
PROXY_URL = os.environ.get("PROXY_URL", "")
CORS_ORIGINS = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()
]
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", "3"))
SOLVER_NAV_TIMEOUT_MS = int(os.environ.get("SOLVER_NAV_TIMEOUT_MS", "60000"))

# Global semaphore so the heavy Playwright solver isn't flooded.
# Created at app-startup so it's shared across all workers in this process.
_SEMAPHORE: asyncio.Semaphore | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _SEMAPHORE
    _SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT)
    yield


app = FastAPI(title="Double Counter Solver API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS or ["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"ok": True, "solver": SOLVER_URL, "max_concurrent": MAX_CONCURRENT}


@app.get("/api/stats")
async def stats():
    count = await counter.load()
    return {"count": count}


def _link_validation(link: str) -> str | None:
    if not link:
        return "missing link"
    code = link.split("/")[-1] if "/" in link else link
    if not code or not all(c.isalnum() or c in "_-" for c in code):
        return "invalid link"
    return None


async def _run(link: str):
    """Acquire the semaphore, stream steps. Emits a queued event while waiting."""
    if _SEMAPHORE is None:
        yield Step("error", "Server not ready").as_sse()
        return

    # If a slot isn't free, tell the client it's queued, then wait.
    if _SEMAPHORE.locked() and _SEMAPHORE._value == 0:
        yield Step("queued", "Queued — solving for another user, please wait...").as_sse()

    async with _SEMAPHORE:
        async for step in solve_stream(
            link,
            solver_url=SOLVER_URL,
            proxy_url=PROXY_URL,
            solver_nav_timeout_ms=SOLVER_NAV_TIMEOUT_MS,
        ):
            yield step.as_sse()


@app.get("/api/solve")
async def solve(link: str = Query(..., description="Double Counter verify URL or code")):
    err = _link_validation(link)
    if err:
        return JSONResponse({"step": "error", "message": err}, status_code=400)

    return StreamingResponse(
        _run(link),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.get("/")
async def root():
    return {"service": "doublecounter-solver-api", "endpoints": ["/api/solve", "/api/health", "/api/stats"]}
