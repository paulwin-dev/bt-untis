#!/usr/bin/env python3
"""
Better Untis — async proxy server
Run:  python3 proxy.py
Then open: http://localhost:8000

Requirements:
    pip install aiohttp
"""

import asyncio
import os
from yarl import URL

try:
    import aiohttp
    from aiohttp import web
except ImportError:
    print("Missing dependency: run  pip install aiohttp")
    raise

PORT = int(os.environ.get("PORT", 8000))
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

MIME_MAP = {
    ".html": "text/html",
    ".css":  "text/css",
    ".js":   "application/javascript",
    ".json": "application/json",
    ".png":  "image/png",
    ".ico":  "image/x-icon",
    ".webp": "image/webp",
    ".svg":  "image/svg+xml",
}

CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Cookie, X-Untis-Session, Authorization",
}


# ── connection pool ────────────────────────────────────────────────────────────
# One shared ClientSession across all requests — reuses HTTPS connections
# to WebUntis instead of a fresh TLS handshake per request.
_client: aiohttp.ClientSession | None = None

def get_client() -> aiohttp.ClientSession:
    global _client
    if _client is None or _client.closed:
        connector = aiohttp.TCPConnector(
            limit=100,          # max total pooled connections
            limit_per_host=30,  # max connections per WebUntis host
            ttl_dns_cache=300,  # cache DNS lookups for 5 min
            ssl=True,
        )
        _client = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=15),
            cookie_jar=aiohttp.DummyCookieJar(),
        )
    return _client


# ── CORS preflight ─────────────────────────────────────────────────────────────
async def handle_options(request: web.Request) -> web.Response:
    return web.Response(status=204, headers=CORS_HEADERS)


# ── school search ──────────────────────────────────────────────────────────────
async def handle_school_search(request: web.Request) -> web.Response:
    query = request.rel_url.query.get("q", "")
    url   = "https://mobile.webuntis.com/ms/schoolquery2?search=" + aiohttp.helpers.quote(query)

    try:
        async with get_client().get(url, headers={"User-Agent": "BetterUntisProxy/2.0"}) as resp:
            body = await resp.read()
            ct   = resp.headers.get("Content-Type", "application/json")
    except aiohttp.ClientError as e:
        return web.Response(status=502, text=f"Proxy error: {e}", headers=CORS_HEADERS)

    return web.Response(body=body, content_type=ct.split(";")[0], headers=CORS_HEADERS)


# ── proxy ──────────────────────────────────────────────────────────────────────
async def handle_proxy(request: web.Request) -> web.Response:
    tail  = request.match_info["tail"]
    slash = tail.find("/")
    if slash == -1:
        return web.Response(status=400, text="Bad proxy path — missing path after host", headers=CORS_HEADERS)

    host     = tail[:slash]
    api_path = tail[slash:]
    
    # re-attach query string — match_info strips it
    qs = request.rel_url.query_string
    if qs:
        api_path += "?" + qs

    url = URL(f"https://{host}/WebUntis{api_path}", encoded=True)

    # forward relevant headers
    fwd = {
        "User-Agent":    "BetterUntisProxy/2.0",
        "Accept":        request.headers.get("Accept", "application/json, */*"),
        "Authorization": request.headers.get("Authorization", ""),
        "Content-Type":  request.headers.get("Content-Type", "application/json"),
    }

    # inject JSESSIONID from X-Untis-Session since browsers can't set Cookie in fetch
    cookie     = request.headers.get("Cookie", "")
    session_id = request.headers.get("X-Untis-Session", "")
    if session_id:
        cookie = f"JSESSIONID={session_id}; {cookie}".strip("; ")
    if cookie:
        fwd["Cookie"] = cookie

    # drop empty headers
    fwd = {k: v for k, v in fwd.items() if v}

    body = await request.read() if request.method == "POST" else None

    try:
        async with get_client().request(
            request.method,
            url,
            headers=fwd,
            data=body,
            allow_redirects=False,
        ) as resp:
            raw        = await resp.read()
            status     = resp.status
            ct         = resp.headers.get("Content-Type", "application/json")
            set_cookie = resp.headers.get("Set-Cookie", "")

    except aiohttp.ClientError as e:
        return web.Response(status=502, text=f"Proxy error: {e}", headers=CORS_HEADERS)

    headers = dict(CORS_HEADERS)
    if set_cookie:
        headers["Set-Cookie"] = set_cookie

    return web.Response(
        body=raw,
        status=status,
        content_type=ct.split(";")[0],
        headers=headers,
    )


# ── static files ───────────────────────────────────────────────────────────────
async def handle_static(request: web.Request) -> web.Response:
    path = request.match_info.get("path", "") or "index.html"
    if not path:
        path = "index.html"

    file_path = os.path.normpath(os.path.join(STATIC_DIR, path))

    # block path traversal
    if not file_path.startswith(STATIC_DIR):
        return web.Response(status=403, text="Forbidden")

    if not os.path.isfile(file_path):
        return web.Response(status=404, text="Not found")

    ext  = os.path.splitext(file_path)[1].lower()
    mime = MIME_MAP.get(ext, "application/octet-stream")

    with open(file_path, "rb") as f:
        data = f.read()

    return web.Response(body=data, content_type=mime)


# ── shutdown ───────────────────────────────────────────────────────────────────
async def on_shutdown(app: web.Application) -> None:
    if _client and not _client.closed:
        await _client.close()


# ── app ────────────────────────────────────────────────────────────────────────
def make_app() -> web.Application:
    app = web.Application()
    app.on_shutdown.append(on_shutdown)

    app.router.add_route("OPTIONS", "/{path:.*}",   handle_options)
    app.router.add_get(  "/school-search",          handle_school_search)
    app.router.add_route("*", "/proxy/{tail:.+}",   handle_proxy)
    app.router.add_get(  "/",                       handle_static)
    app.router.add_get(  "/{path:.+}",              handle_static)

    return app


if __name__ == "__main__":
    os.chdir(STATIC_DIR)
    print(f"  Better Untis  →  http://localhost:{PORT}")
    print("  Press Ctrl+C to stop.\n")
    web.run_app(make_app(), host="0.0.0.0", port=PORT, print=None)