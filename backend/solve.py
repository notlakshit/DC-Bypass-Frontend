"""Async Double Counter verification engine (ported from verify_solver.py).

Streamed step events so the API layer can push them to the browser over SSE.
Per-request rotating proxy, fresh client each call -> concurrent-safe.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, asdict
from typing import AsyncIterator, Optional
from urllib.parse import urlparse, quote

import httpx

import counter

logger = logging.getLogger("solve")


FALLBACK_SITEKEY = "0x4AAAAAADW3lFh0T4M341uS"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"
)

CONNECT_TIMEOUT = 15.0
READ_TIMEOUT = 45.0
SOLVER_READ_TIMEOUT = 60.0

MAX_PROXY_RETRIES = 3
PROXY_RETRY_BACKOFF = 2.0

DEAD_MARKERS = (
    "timed out", "expired", "already", "no longer",
    "used", "failed", "not found", "invalid",
)


@dataclass
class Step:
    step: str
    message: str = ""
    success: Optional[bool] = None
    userid: Optional[str] = None
    title: Optional[str] = None
    count: Optional[int] = None
    code: Optional[str] = None

    def as_sse(self) -> str:
        import json
        payload = {k: v for k, v in asdict(self).items() if v is not None}
        if "success" not in payload:
            payload.pop("success", None)
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def normalize_link(raw: str) -> tuple[str, str, str]:
    """Return (base, full_url, path)."""
    link = raw.strip()
    p = urlparse(link)
    if not p.scheme:
        p = urlparse("https://" + link)
    scheme = p.scheme or "https"
    netloc = p.netloc
    path = p.path or "/"
    base = f"{scheme}://{netloc}"
    full = base + path
    if p.query:
        full += "?" + p.query
    return base, full, path


def extract_sitekey(html: str) -> Optional[str]:
    m = re.search(r'data-sitekey\s*=\s*["\']([0-9A-Za-zx_]+)["\']', html, re.I)
    if m:
        return m.group(1)
    m = re.search(r"(0x[0-9A-Za-z_]{10,})", html)
    if m:
        return m.group(1)
    return None


def extract_cdata(html: str) -> Optional[str]:
    m = re.search(r'data-cdata\s*=\s*["\']([^"\']+)["\']', html, re.I)
    return m.group(1) if m else None


def get_headers(base: str) -> dict[str, str]:
    return {
        "Host": urlparse(base).netloc,
        "Sec-Ch-Ua": '"Not;A=Brand";v="8", "Chromium";v="150"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent": UA,
        "Accept": (
            "text/html,application/xhtml+xml,application/xml;q=0.9,"
            "image/avif,image/webp,image/apng,*/*;q=0.8,"
            "application/signed-exchange;v=b3;q=0.7"
        ),
        "Sec-Fetch-User": "?1",
        "Accept-Encoding": "gzip, deflate",
        "Priority": "u=0, i",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
    }


def post_headers(base: str, full: str) -> dict[str, str]:
    h = get_headers(base)
    h.update({
        "Origin": base,
        "Referer": full,
        "Content-Type": "application/x-www-form-urlencoded",
        "Cache-Control": "max-age=0",
        "Sec-Fetch-Site": "same-origin",
    })
    return h


def parse_userid_cookie(set_cookie_header: str) -> Optional[str]:
    """Parse the userid value out of a Set-Cookie header."""
    if not set_cookie_header:
        return None
    m = re.search(r"userid=([^;]+)", set_cookie_header)
    return m.group(1) if m else None


def normalize_solver_url(solver_url: str) -> str:
    """Ensure the solver URL points at /solve (the API), not the HTML UI root."""
    u = solver_url.rstrip("/")
    if not u.endswith("/solve"):
        u = u + "/solve"
    return u


async def call_solver(
    solver_url: str,
    page_url: str,
    sitekey: str,
    cdata: Optional[str],
    proxy_url: str,
    nav_timeout_ms: int,
    client: httpx.AsyncClient,
) -> dict:
    params = {
        "url": page_url,
        "sitekey": sitekey,
        "timeout": str(nav_timeout_ms),
        "proxy": proxy_url,
    }
    if cdata:
        params["cdata"] = cdata

    endpoint = normalize_solver_url(solver_url)
    timeout = httpx.Timeout(CONNECT_TIMEOUT, read=SOLVER_READ_TIMEOUT)
    r = await client.get(endpoint, params=params, timeout=timeout)
    try:
        return r.json()
    except ValueError:
        snippet = r.text[:200].replace("\n", " ").strip() or "(empty body)"
        ct = r.headers.get("content-type", "?")
        return {"success": False, "err": f"solver non-JSON (HTTP {r.status_code}, ct={ct}): {snippet}"}


async def solve_stream(
    link: str,
    *,
    solver_url: str,
    proxy_url: str,
    solver_nav_timeout_ms: int = 60000,
    max_solver_attempts: int = 3,
    solver_backoff: float = 2.0,
) -> AsyncIterator[Step]:
    """Yield Step events for the full verification flow."""
    try:
        base, full, path = normalize_link(link)
    except Exception as e:
        logger.info("link=%s result=error reason=invalid_link", link)
        yield Step("error", f"Invalid link: {e}")
        return

    proxy = proxy_url or None
    timeout = httpx.Timeout(CONNECT_TIMEOUT, read=READ_TIMEOUT)

    async with httpx.AsyncClient(proxy=proxy, follow_redirects=True, timeout=timeout) as client:
        # ---- Step 1: GET verify page (with proxy retry) ----
        yield Step("loading", "Loading verify page...")
        r_get = None
        for proxy_attempt in range(1, MAX_PROXY_RETRIES + 1):
            try:
                r_get = await client.get(full, headers=get_headers(base))
                break
            except httpx.ProxyError as e:
                if proxy_attempt < MAX_PROXY_RETRIES:
                    logger.info("link=%s proxy_error retry=%d/%d phase=GET", link, proxy_attempt, MAX_PROXY_RETRIES)
                    await asyncio.sleep(PROXY_RETRY_BACKOFF)
                else:
                    logger.info("link=%s result=error reason=proxy_error phase=GET", link)
                    yield Step("error", "Proxy error. Please try again.", code="proxy_error")
                    return
            except (httpx.ConnectTimeout, httpx.ReadTimeout):
                logger.info("link=%s result=error reason=timeout phase=GET", link)
                yield Step("error", "Request timed out via proxy.", code="timed_out")
                return
            except httpx.HTTPError as e:
                logger.info("link=%s result=error reason=connection_error phase=GET", link)
                yield Step("error", f"Connection error: {e}")
                return

        if r_get.status_code != 200:
            logger.info("link=%s result=error reason=dead_link status=%d phase=GET", link, r_get.status_code)
            yield Step("error", f"Verify page returned HTTP {r_get.status_code}. Link may be dead.", code="dead_link")
            return

        page = r_get.text
        title_match = re.search(r"<title>(.*?)</title>", page, re.I | re.S)
        title = title_match.group(1).strip() if title_match else ""

        if any(m in title.lower() for m in DEAD_MARKERS):
            logger.info("link=%s result=error reason=dead_link title=%r phase=GET", link, title)
            yield Step("error", f"Link is dead: {title!r}. Generate a fresh link.", code="dead_link")
            return

        if "cf-turnstile" not in page.lower() and "data-sitekey" not in page.lower():
            logger.info("link=%s result=error reason=no_turnstile phase=GET", link)
            yield Step("error", "Page has no Turnstile widget. Link may be invalid.")
            return

        sitekey = extract_sitekey(page) or FALLBACK_SITEKEY
        cdata = extract_cdata(page)
        if not cdata:
            m = re.match(r"/v/([^/?#]+)", path)
            if m:
                cdata = m.group(1)

        # ---- Step 2: solve turnstile ----
        yield Step("solving", "Solving Turnstile...")
        token = None
        for attempt in range(1, max_solver_attempts + 1):
            try:
                data = await call_solver(
                    solver_url, full, sitekey, cdata, proxy_url,
                    solver_nav_timeout_ms, client,
                )
            except httpx.ReadTimeout:
                if attempt < max_solver_attempts:
                    logger.info("link=%s solver_timeout retry=%d/%d", link, attempt, max_solver_attempts)
                    yield Step("solving", f"Solve attempt {attempt} timed out. Retrying...")
                    await asyncio.sleep(solver_backoff * attempt)
                    continue
                logger.info("link=%s result=error reason=solver_timeout", link)
                yield Step("error", "Solver timed out. Please try again.", code="timed_out")
                return
            except httpx.HTTPError as e:
                if attempt < max_solver_attempts:
                    logger.info("link=%s solver_http_error retry=%d/%d err=%s", link, attempt, max_solver_attempts, e)
                    yield Step("solving", f"Solve attempt {attempt} failed: {e}. Retrying...")
                    await asyncio.sleep(solver_backoff * attempt)
                    continue
                logger.info("link=%s result=error reason=solver_failed", link)
                yield Step("error", f"Solver failed after {max_solver_attempts} attempts: {e}")
                return

            if data.get("success") and data.get("token"):
                token = data["token"]
                break
            err = data.get("err") or data.get("message") or "unknown"
            if attempt < max_solver_attempts:
                yield Step("solving", f"Solve attempt {attempt} failed: {err}. Retrying...")
                await asyncio.sleep(solver_backoff * attempt)
            else:
                logger.info("link=%s result=error reason=solver_failed attempts=%d", link, max_solver_attempts)
                yield Step("error", f"Solver failed after {max_solver_attempts} attempts: {err}")
                return

        # ---- Step 3: POST the token (with proxy retry) ----
        yield Step("verifying", "Verifying...")
        body = f"cf-turnstile-response={quote(token, safe='')}"
        r_post = None
        for proxy_attempt in range(1, MAX_PROXY_RETRIES + 1):
            try:
                r_post = await client.post(full, content=body, headers=post_headers(base, full))
                break
            except httpx.ProxyError as e:
                if proxy_attempt < MAX_PROXY_RETRIES:
                    logger.info("link=%s proxy_error retry=%d/%d phase=POST", link, proxy_attempt, MAX_PROXY_RETRIES)
                    await asyncio.sleep(PROXY_RETRY_BACKOFF)
                else:
                    logger.info("link=%s result=error reason=proxy_error phase=POST", link)
                    yield Step("error", "Proxy error. Please try again.", code="proxy_error")
                    return
            except httpx.HTTPError as e:
                logger.info("link=%s result=error reason=post_failed phase=POST", link)
                yield Step("error", f"POST failed: {e}")
                return

        userid = parse_userid_cookie(r_post.headers.get("set-cookie", ""))
        post_title = ""
        m = re.search(r"<title>(.*?)</title>", r_post.text, re.I | re.S)
        if m:
            post_title = m.group(1).strip()

        success = (r_post.status_code == 200 and userid is not None and "Success!" in r_post.text)

        if success:
            new_count = await counter.increment()
            logger.info("link=%s result=success userid=%s count=%d", link, userid, new_count)
            yield Step("done", "VERIFIED", success=True, userid=userid, title=post_title, count=new_count)
        else:
            if userid and "Success!" in r_post.text:
                msg = f"Partial success (userid {userid}) but verification incomplete."
            else:
                msg = f"Verification failed: {post_title or 'Access denied'}"
            fail_code = "timed_out" if post_title and "timed out" in post_title.lower() else "verification_failed"
            set_cookie = r_post.headers.get("set-cookie", "")
            body_snippet = r_post.text[:2000].replace("\n", " ").strip()
            all_headers = dict(r_post.headers)
            logger.info(
                "link=%s result=fail reason=%s userid=%s title=%r status=%d set_cookie=%r headers=%r body=%r",
                link, "partial" if userid else "denied", userid, post_title,
                r_post.status_code, set_cookie[:200], all_headers, body_snippet,
            )
            yield Step("done", msg, success=False, userid=userid, title=post_title, code=fail_code)
