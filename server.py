#!/usr/bin/env python3
# ==========================================================================
#  PinGrab - website + downloader API
#  --------------------------------------------------------------------------
#  A tiny server with no dependencies (Python 3.9+). It serves the static
#  site from this folder and exposes three API endpoints:
#
#     GET /api/health                     -> {"ok": true, ...}
#     GET /api/resolve?url=<pin url>      -> metadata + download options
#     GET /api/download?u=<media url>     -> streams the file as an attachment
#
#  Why a server? Pinterest does not send CORS headers, so a browser cannot
#  read a pin page directly. The server fetches the public pin page once,
#  extracts the video URL and caches the result in memory.
#
#  Run:  python server.py            (then open http://localhost:8787)
#  Env:  PORT, HOST, ALLOWED_ORIGINS, RATE_LIMIT, RATE_WINDOW
# ==========================================================================

from __future__ import annotations

import gzip
import html as html_mod
import json
import os
import re
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# --------------------------------------------------------------------------
#  Settings
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8787"))
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
RATE_LIMIT = int(os.environ.get("RATE_LIMIT", "40"))          # resolves per window / IP
RATE_WINDOW = int(os.environ.get("RATE_WINDOW", "600"))       # seconds
CACHE_TTL = 30 * 60                                           # 30 minutes
MAX_HTML_BYTES = 6 * 1024 * 1024
FETCH_TIMEOUT = 20

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

MEDIA_HOST_SUFFIXES = ("pinimg.com", "pinterest.com", "pin.it")
MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".webm": "video/webm",
    ".wasm": "application/wasm",
    ".map": "application/json",
}

# --------------------------------------------------------------------------
#  Small helpers
# --------------------------------------------------------------------------
class ApiError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def fetch_url(url: str, *, head: bool = False, timeout: int = FETCH_TIMEOUT,
              extra_headers: dict | None = None):
    """GET/HEAD a URL with a browser user-agent. Returns (final_url, status, headers, body)."""
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Referer": "https://www.pinterest.com/",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, headers=headers, method="HEAD" if head else "GET")
    ctx = ssl.create_default_context()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
        final = resp.geturl()
        status = resp.status
        hdrs = dict(resp.headers.items())
        body = b"" if head else resp.read(MAX_HTML_BYTES + 1)
    if len(body) > MAX_HTML_BYTES:
        raise ApiError("upstream", "The page is too large to read.", 502)
    enc = (hdrs.get("Content-Encoding") or "").lower()
    if enc == "gzip":
        body = gzip.decompress(body)
    elif enc == "deflate":
        body = zlib.decompress(body)
    return final, status, hdrs, body


def decode_html(body: bytes) -> str:
    if not body:
        return ""
    charset = "utf-8"
    m = re.search(br'charset=["\']?([a-zA-Z0-9_-]+)', body[:4096])
    if m:
        charset = m.group(1).decode("ascii", "ignore")
    try:
        return body.decode(charset, "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def is_pinterest_host(host: str) -> bool:
    host = (host or "").lower().split(":")[0]
    if host == "pin.it" or host == "pinterest.com":
        return True
    return bool(re.fullmatch(r"(?:[a-z0-9-]+\.)*pinterest\.[a-z.]{2,10}", host))


def is_allowed_media_url(url: str) -> bool:
    try:
        p = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    if p.scheme != "https":
        return False
    host = (p.hostname or "").lower()
    if not any(host == s or host.endswith("." + s) for s in MEDIA_HOST_SUFFIXES):
        return False
    return bool(re.search(r"\.(?:mp4|jpg|jpeg|png|webp|gif|m4a)$", p.path, re.I))


def json_unescape(value: str) -> str:
    try:
        return json.loads('"' + value.replace('"', '\\"') + '"')
    except Exception:
        return value


def meta_content(doc: str, prop: str) -> str:
    for tag in re.findall(r"<meta\b[^>]*>", doc, re.I):
        low = tag.lower()
        if ('property="%s"' % prop.lower()) in low or ('name="%s"' % prop.lower()) in low:
            m = re.search(r"""content\s*=\s*(?:"([^"]*)"|'([^']*)')""", tag, re.I | re.S)
            if m:
                return html_mod.unescape(m.group(1) if m.group(1) is not None else m.group(2) or "")
    return ""


def clean_title(raw: str) -> str:
    title = html_mod.unescape(raw or "").strip()
    title = re.sub(r"\s+", " ", title)
    if " | " in title:
        title = title.split(" | ", 1)[0].strip()
    title = re.sub(r"\s*\[video\]\s*$", "", title, flags=re.I)
    title = re.sub(r"(?:\s*(?:\.\.\.|…))+$", "", title)
    return title.strip()[:300]


def slugify(text: str, max_len: int = 60) -> str:
    text = (text or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return (text[:max_len].rstrip("-") or "pinterest-video")


def human_duration(ms: int) -> float:
    return round(ms / 1000.0, 1)


# --------------------------------------------------------------------------
#  Pinterest link parsing
# --------------------------------------------------------------------------
PIN_ID_RE = re.compile(r"/pin/(?:[^/?#]+?-)?(\d{6,25})(?:[/?#]|$)")


def parse_pin_url(raw: str):
    """Return (pin_id, canonical_url, is_short_link). Raises ApiError."""
    raw = (raw or "").strip()
    if not raw:
        raise ApiError("invalid_url", "Paste a Pinterest pin link first.")
    if len(raw) > 2000:
        raise ApiError("invalid_url", "That link is too long.")
    if not re.match(r"^https?://", raw, re.I):
        raw = "https://" + raw
    try:
        parts = urllib.parse.urlsplit(raw)
    except ValueError:
        raise ApiError("invalid_url", "That does not look like a valid link.")
    host = (parts.hostname or "").lower()
    if not is_pinterest_host(host):
        raise ApiError("invalid_url", "Only Pinterest links are supported (pinterest.com or pin.it).", 422)

    if host.endswith("pin.it"):
        return None, raw, True

    m = PIN_ID_RE.search(parts.path + "/")
    if not m:
        m = re.search(r"(\d{6,25})", parts.path)
    if not m:
        raise ApiError("invalid_url", "That link does not contain a pin ID. Open the pin on Pinterest and copy the full link.", 422)
    pin_id = m.group(1)
    return pin_id, "https://www.pinterest.com/pin/%s/" % pin_id, False


# --------------------------------------------------------------------------
#  Pin page parsing
# --------------------------------------------------------------------------
MP4_RE = re.compile(r"https://[a-z0-9.-]*pinimg\.com/videos/[^\"'<>\s\\]+?\.(?:mp4|m3u8)(?:\?[^\"'<>\s\\]*)?", re.I)


def codec_of(url: str) -> str:
    low = url.lower()
    if "av1" in low:
        return "av1"
    if "h265" in low or "hevc" in low:
        return "hevc"
    return "h264"


def width_of(url: str) -> int:
    m = re.search(r"_(\d{2,4})w(?:[_./]|$)", url, re.I)
    if m:
        return int(m.group(1))
    m = re.search(r"/(\d{3,4})p/", url)
    if m:
        return int(m.group(1))
    return 0


def extract_media(doc: str):
    """Return (qualities, hls_urls) where qualities is a list of dicts."""
    text = doc.replace("\\/", "/").replace("\\u002F", "/").replace("\\u002f", "/")
    text = html_mod.unescape(text)
    found = MP4_RE.findall(text)
    mp4s, hls = [], []
    seen = set()
    for url in found:
        url = url.replace("&amp;", "&").strip()
        if url in seen:
            continue
        seen.add(url)
        if ".m3u8" in url.lower():
            hls.append(url)
        elif url.lower().split("?")[0].endswith(".mp4"):
            mp4s.append(url)

    qualities = []
    for url in mp4s:
        w = width_of(url)
        qualities.append({
            "url": url,
            "codec": codec_of(url),
            "width": w,
            "label": ("%dp" % w) if w else "MP4",
            "size": None,
            "ext": "mp4",
        })

    def rank(q):
        codec_rank = {"h264": 0, "av1": 1, "hevc": 2}.get(q["codec"], 3)
        return (codec_rank, -q["width"], 0 if "expMp4" in q["url"] else 1)

    qualities.sort(key=rank)

    # Keep the best 3 distinct widths, never mixing codecs (players are picky).
    best = []
    used_widths = set()
    for q in qualities:
        if best and q["codec"] != best[0]["codec"]:
            continue
        key = (q["codec"], q["width"])
        if key in used_widths:
            continue
        used_widths.add(key)
        best.append(q)
        if len(best) >= 3:
            break
    return best, hls


def find_thumbnail(doc: str, og_image: str) -> str:
    m = re.search(r"https://i\.pinimg\.com/videos/thumbnails/originals/[^\"'<>\s\\]+?\.jpg", doc)
    if m:
        return m.group(0)
    img = og_image
    if img and re.search(r"i\.pinimg\.com/\d+x\d*/", img):
        img = re.sub(r"(i\.pinimg\.com)/\d+x\d*/", r"\1/originals/", img)
    return img


def find_author(doc: str):
    """Find the first complete 'pinner' object (some pins include stub objects)."""
    for m in re.finditer(r'"pinner"\s*:\s*\{', doc):
        block = doc[m.end():m.end() + 1800]
        name = re.search(r'"fullName"\s*:\s*"([^"]+)"', block)
        user = re.search(r'"username"\s*:\s*"([^"]+)"', block)
        if not (name and user):
            continue
        avatar = re.search(r'"(?:imageMediumUrl|imageSmallUrl|imageLargeUrl)"\s*:\s*"([^"]+)"', block)
        avatar_url = json_unescape(avatar.group(1)) if avatar else ""
        return {
            "name": json_unescape(name.group(1)).strip(),
            "username": json_unescape(user.group(1)).strip(),
            "avatar": avatar_url if avatar_url.startswith("https://") else "",
        }
    return None


def find_duration(doc: str) -> float | None:
    values = []
    for m in re.finditer(r'"duration"\s*:\s*(\d{3,8})', doc):
        v = int(m.group(1))
        if 500 <= v <= 3_600_000:
            values.append(v)
        if len(values) >= 24:
            break
    if not values:
        return None
    counts = defaultdict(int)
    for v in values:
        counts[v] += 1
    best = max(counts.items(), key=lambda kv: (kv[1], kv[0]))[0]
    return human_duration(best)


def remote_size(url: str) -> int | None:
    try:
        _, status, headers, _ = fetch_url(url, head=True, timeout=8)
        length = headers.get("Content-Length")
        if length and length.isdigit() and int(length) > 0:
            return int(length)
    except Exception:
        pass
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Referer": "https://www.pinterest.com/",
            "Range": "bytes=0-0",
        })
        with urllib.request.urlopen(req, timeout=8, context=ssl.create_default_context()) as resp:
            cr = resp.headers.get("Content-Range") or ""
            m = re.search(r"/(\d+)$", cr)
            if m:
                return int(m.group(1))
            cl = resp.headers.get("Content-Length")
            if cl and cl.isdigit():
                return int(cl)
    except Exception:
        pass
    return None


def parse_pin_html(doc: str, pin_id: str, pin_url: str):
    title = clean_title(meta_content(doc, "og:title"))
    if not title:
        m = re.search(r"<title[^>]*>(.*?)</title>", doc, re.I | re.S)
        title = clean_title(html_mod.unescape(m.group(1))) if m else ""
    if not title:
        title = "Pinterest video"

    description = meta_content(doc, "og:description").strip()
    description = re.sub(r"\s+", " ", description)[:600]

    og_image = meta_content(doc, "og:image").strip()
    thumbnail = find_thumbnail(doc, og_image)
    qualities, hls = extract_media(doc)

    if not qualities:
        # Image pin: offer the still image instead of failing entirely.
        if not thumbnail:
            raise ApiError("no_media", "Could not find a video on this pin. It may be private or removed.", 422)
        return {
            "id": pin_id,
            "pinUrl": pin_url,
            "kind": "image",
            "title": title,
            "description": description,
            "author": find_author(doc),
            "thumbnail": thumbnail,
            "duration": None,
            "size": None,
            "qualities": [],
            "hls": hls[0] if hls else None,
        }

    # One size lookup keeps the response fast; other options fill in on use.
    if qualities:
        qualities[0]["size"] = remote_size(qualities[0]["url"])

    primary = qualities[0]
    filename = "pingrab-%s.mp4" % slugify(title)

    return {
        "id": pin_id,
        "pinUrl": pin_url,
        "kind": "video",
        "title": title,
        "description": description,
        "author": find_author(doc),
        "thumbnail": thumbnail,
        "duration": find_duration(doc),
        "width": primary["width"] or None,
        "size": primary["size"],
        "filename": filename,
        "qualities": qualities,
        "hls": hls[0] if hls else None,
        "codecWarning": primary["codec"] != "h264",
    }


# --------------------------------------------------------------------------
#  Resolve + cache + rate limiting
# --------------------------------------------------------------------------
_cache: dict[str, tuple[float, dict]] = {}
_cache_lock = threading.Lock()
_hits: dict[str, deque] = defaultdict(deque)
_hits_lock = threading.Lock()


def rate_limited(ip: str) -> bool:
    now = time.time()
    with _hits_lock:
        q = _hits[ip]
        while q and now - q[0] > RATE_WINDOW:
            q.popleft()
        if len(q) >= RATE_LIMIT:
            return True
        q.append(now)
        return False


def resolve(raw_url: str) -> dict:
    pin_id, target, short = parse_pin_url(raw_url)

    if pin_id:
        with _cache_lock:
            hit = _cache.get(pin_id)
        if hit and hit[0] > time.time():
            return hit[1]

    doc = ""
    if short:
        try:
            final_url, _, _, body = fetch_url(target)
            doc = decode_html(body)
            m = PIN_ID_RE.search(urllib.parse.urlsplit(final_url).path + "/") or PIN_ID_RE.search(doc)
            if not m:
                raise ApiError("not_found", "That pin.it link could not be resolved.", 404)
            pin_id = m.group(1)
            target = "https://www.pinterest.com/pin/%s/" % pin_id
        except urllib.error.HTTPError as exc:
            raise ApiError("not_found", "That pin.it link is invalid or has expired (HTTP %s)." % exc.code, 404)
        except ApiError:
            raise
        except (urllib.error.URLError, socket.timeout, TimeoutError):
            raise ApiError("upstream", "Pinterest took too long to answer. Please try again.", 504)

    if not doc:
        try:
            final_url, _, _, body = fetch_url(target)
            doc = decode_html(body)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise ApiError("not_found", "This pin does not exist (HTTP 404). Check the link and try again.", 404)
            if exc.code in (403, 429):
                raise ApiError("upstream", "Pinterest is blocking requests right now. Please try again in a minute.", 502)
            raise ApiError("upstream", "Pinterest returned an error (HTTP %s)." % exc.code, 502)
        except (urllib.error.URLError, socket.timeout, TimeoutError):
            raise ApiError("upstream", "Could not reach Pinterest. Check your connection and try again.", 504)

    if not doc.strip():
        raise ApiError("upstream", "Pinterest returned an empty page. Please try again.", 502)

    pin_url = "https://www.pinterest.com/pin/%s/" % pin_id if pin_id else target
    data = parse_pin_html(doc, pin_id or "", pin_url)

    if pin_id:
        with _cache_lock:
            _cache[pin_id] = (time.time() + CACHE_TTL, data)
            if len(_cache) > 500:
                oldest = sorted(_cache.items(), key=lambda kv: kv[1][0])[:100]
                for key, _ in oldest:
                    _cache.pop(key, None)
    return data


# --------------------------------------------------------------------------
#  HTTP handler
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    server_version = "PinGrab/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- plumbing ----------
    def log_message(self, fmt, *args):
        sys.stdout.write("  %s  %s\n" % (time.strftime("%H:%M:%S"), fmt % args))
        sys.stdout.flush()

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin and (origin in ALLOWED_ORIGINS or "*" in ALLOWED_ORIGINS):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _security(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "SAMEORIGIN")

    def _json(self, payload, status=200, cache="no-store"):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self._security()
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, err: ApiError):
        self._json({"ok": False, "error": {"code": err.code, "message": err.message}}, err.status)

    def _client_ip(self):
        fwd = self.headers.get("CF-Connecting-IP") or self.headers.get("X-Forwarded-For") or ""
        return (fwd.split(",")[0].strip() or self.client_address[0])

    # ---------- routes ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._security()
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_HEAD(self):
        self._route()

    def do_GET(self):
        self._route()

    def _route(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        if path == "/api/health":
            return self._json({"ok": True, "service": "pingrab", "time": int(time.time())})
        if path == "/api/resolve":
            return self._api_resolve(parsed.query)
        if path == "/api/download":
            return self._api_download(parsed.query)
        if path.startswith("/api/"):
            return self._error(ApiError("not_found", "Unknown API endpoint.", 404))
        return self._static(path)

    def _api_resolve(self, query):
        if not self._check_rate():
            return self._error(ApiError("rate_limited", "Too many requests. Please wait a few minutes.", 429))
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        raw = (params.get("url") or [""])[0]
        try:
            data = resolve(raw)
        except ApiError as err:
            return self._error(err)
        except Exception as exc:  # never leak a traceback to the browser
            self.log_message("resolve failed: %r", exc)
            return self._error(ApiError("server", "Something went wrong while reading that pin. Please try again.", 500))
        self._json({"ok": True, "data": data}, cache="public, max-age=300")

    def _check_rate(self):
        ip = self._client_ip()
        if ip in ("127.0.0.1", "::1"):
            return True
        return not rate_limited(ip)

    def _api_download(self, query):
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        target = (params.get("u") or [""])[0]
        name = (params.get("name") or [""])[0]
        if not target:
            return self._error(ApiError("invalid_url", "Missing media URL.", 400))
        if not is_allowed_media_url(target):
            return self._error(ApiError("forbidden", "That media host is not allowed.", 403))

        name = re.sub(r"[^A-Za-z0-9._ -]+", "", name).strip()[:90]
        ext = Path(urllib.parse.urlsplit(target).path).suffix.lower()
        if ext not in (".mp4", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".m4a"):
            ext = ".mp4"
        if not name:
            name = "pingrab-download" + ext
        elif not name.lower().endswith(ext):
            name = Path(name).stem[:80] + ext

        headers = {
            "User-Agent": UA,
            "Referer": "https://www.pinterest.com/",
            "Accept": "*/*",
            "Accept-Encoding": "identity",
        }
        rng = self.headers.get("Range")
        if rng:
            headers["Range"] = rng
        req = urllib.request.Request(target, headers=headers)

        try:
            upstream = urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context())
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404, 410):
                return self._error(ApiError("not_found", "The video file is no longer available on Pinterest.", 404))
            return self._error(ApiError("upstream", "Pinterest refused the download (HTTP %s)." % exc.code, 502))
        except (urllib.error.URLError, socket.timeout, TimeoutError):
            return self._error(ApiError("upstream", "Could not reach the Pinterest media server.", 504))

        with upstream:
            ctype = upstream.headers.get("Content-Type") or ("video/mp4" if ext == ".mp4" else "image/jpeg")
            length = upstream.headers.get("Content-Length")
            self.send_response(upstream.status)
            self.send_header("Content-Type", ctype)
            if length:
                self.send_header("Content-Length", length)
            self.send_header("Cache-Control", "public, max-age=3600")
            self.send_header("Accept-Ranges", upstream.headers.get("Accept-Ranges", "bytes"))
            cr = upstream.headers.get("Content-Range")
            if cr:
                self.send_header("Content-Range", cr)
            quoted = urllib.parse.quote(name)
            ascii_name = name.encode("ascii", "ignore").decode() or "download"
            self.send_header(
                "Content-Disposition",
                "attachment; filename=\"%s\"; filename*=UTF-8''%s" % (ascii_name, quoted),
            )
            self._security()
            self.end_headers()
            if self.command == "HEAD":
                return
            try:
                while True:
                    chunk = upstream.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _static(self, path):
        if path in ("", "/"):
            path = "/index.html"
        if path.endswith("/"):
            path += "index.html"
        rel = path.lstrip("/")
        full = (ROOT / rel).resolve()
        try:
            full.relative_to(ROOT)
        except ValueError:
            return self._not_found()
        if not full.is_file():
            if not Path(rel).suffix:
                alt = ROOT / (rel + ".html")
                if alt.is_file():
                    full = alt
                else:
                    return self._not_found()
            else:
                return self._not_found()

        data = full.read_bytes()
        ext = full.suffix.lower()
        cache = "no-cache" if ext in (".html", ".webmanifest") else "public, max-age=86400"
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self._security()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _not_found(self):
        page = ROOT / "404.html"
        if page.is_file():
            data = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(data)
            return
        self._json({"ok": False, "error": {"code": "not_found", "message": "Not found."}}, 404)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    server = Server((HOST, PORT), Handler)
    print("")
    print("  PinGrab is running")
    print("  --------------------------------------------------")
    print("  Local : http://localhost:%d" % PORT)
    print("  API   : http://localhost:%d/api/resolve?url=..." % PORT)
    print("  Folder: %s" % ROOT)
    print("  Stop  : Ctrl + C")
    print("")
    if os.environ.get("PINGRAB_OPEN", "1") == "1":
        try:
            import webbrowser
            threading.Timer(0.6, lambda: webbrowser.open("http://localhost:%d" % PORT)).start()
        except Exception:
            pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Bye.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
