"""Persistent integer counter stored as JSON on a Railway volume.

Env:
  COUNTER_FILE - path to the JSON file (default /data/counter.json)

If the file/dir is not writable (volume not mounted), it gracefully falls
back to an in-memory counter so the backend never crashes on startup.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

COUNTER_FILE = os.environ.get("COUNTER_FILE", "/data/counter.json")

_lock = asyncio.Lock()
_in_memory: int | None = None


def _resolve_path() -> Path:
    return Path(COUNTER_FILE)


def _is_writable() -> bool:
    p = _resolve_path()
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        if not p.exists():
            p.write_text("0", encoding="utf-8")
        else:
            # verify it actually parses and is writable
            int(p.read_text(encoding="utf-8").strip() or "0")
        # write probe
        with p.open("r+", encoding="utf-8"):
            pass
        return True
    except OSError:
        return False
    except ValueError:
        # corrupt file — reset it
        try:
            p.write_text("0", encoding="utf-8")
            return True
        except OSError:
            return False


def _read_sync() -> int:
    p = _resolve_path()
    try:
        return int(p.read_text(encoding="utf-8").strip() or "0")
    except (OSError, ValueError):
        return 0


def _write_sync(value: int) -> None:
    p = _resolve_path()
    p.write_text(str(value), encoding="utf-8")


async def load() -> int:
    """Return the current count without incrementing."""
    global _in_memory
    if _in_memory is not None and not _is_writable():
        return _in_memory
    async with _lock:
        return await asyncio.to_thread(_read_sync)


async def increment() -> int:
    """Atomically increment and return the new value."""
    global _in_memory
    async with _lock:
        if not _is_writable():
            _in_memory = (_in_memory or 0) + 1
            return _in_memory
        current = _read_sync()
        new_value = current + 1
        await asyncio.to_thread(_write_sync, new_value)
        return new_value


async def set_value(value: int) -> int:
    """Temporarily set the counter to an absolute value."""
    global _in_memory
    async with _lock:
        if not _is_writable():
            _in_memory = value
            return _in_memory
        await asyncio.to_thread(_write_sync, value)
        return value
