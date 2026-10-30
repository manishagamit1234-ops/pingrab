# PinGrab - Pinterest video downloader

A fast, ad-ready Pinterest video downloader site. Paste a pin link, preview the
video, pick a quality and save the MP4 - no sign-up, no watermark and no files
stored on the server.

The repo contains a static frontend (HTML/CSS/JS, installable PWA) plus a tiny
dependency-free Python backend that does the two things a browser cannot do on
its own: read the public pin page and stream the media file back with a proper
`Content-Disposition` header.

```
pingrab-site/
├─ index.html               landing page + downloader UI
├─ help.html                guides and troubleshooting
├─ privacy.html             privacy policy
├─ terms.html               terms of use
├─ 404.html                 not-found page
├─ css/style.css            design system, light + dark theme
├─ js/config.js             site, API and AdSense settings (edit this)
├─ js/downloader.js         API client, URL validation, history helpers
├─ js/app.js                UI controller, theme, install prompt, ads
├─ js/pages.js              shared behaviour for content pages
├─ server.py                static server + /api endpoints (Python 3.9+)
├─ serve.ps1                one-command local server (Windows)
├─ make-assets.ps1          regenerates icons, favicons, OG image, screenshot
├─ manifest.webmanifest     PWA manifest
├─ sw.js                    service worker (offline app shell)
├─ robots.txt / sitemap.xml / ads.txt
└─ icons/                   generated icons and social images
```

---

## Quick start

Requirements: Python 3.9 or newer. Nothing else - no pip installs, no Node.

**Windows (easiest)**

```powershell
cd pingrab-site
powershell -NoProfile -ExecutionPolicy Bypass -File .\serve.ps1
```

Then open <http://localhost:8787>. Use `-Port 9000` for a different port and
`-NoBrowser` to stop it opening a browser automatically.

**Any OS**

```bash
cd pingrab-site
python server.py
# PORT=9000 python server.py        (custom port)
# HOST=127.0.0.1 python server.py   (localhost only)
```

The server hosts the whole folder and the API on the same origin, so
`js/config.js` needs no changes for local development.

> Do not open `index.html` directly with `file://` - the downloader needs the
> API and service workers only run over HTTP/HTTPS.

---

## How it works

1. `js/downloader.js` validates the pasted link and calls
   `GET /api/resolve?url=...`.
2. `server.py` fetches the public pin page with a desktop browser user-agent,
   follows `pin.it` short links and reads Open Graph tags, the pinner object,
   duration and the media URLs embedded in the page.
3. It picks up to three distinct H.264 MP4 renditions, preferring 1080p/720p
   (`expMp4`, `/720p/`, `/mc/720p/`). AV1/HEVC files are used only as a last
   resort, and the UI shows a compatibility warning when that happens.
4. The result is cached in memory for 30 minutes and returned as JSON.
5. **Download MP4** points at `GET /api/download?u=...&name=...`, which proxies
   the file from `pinimg.com` with `Content-Disposition: attachment`. Range
   requests are forwarded, so resumable downloads work.
6. Cover images are handled the same way for image pins and for the preview.

Only media hosts ending in `pinimg.com`, `pinterest.com` or `pin.it` are
allowed through the download proxy; anything else returns `403`.

---

## Configuration

### Frontend - `js/config.js`

| Key | What to change |
| --- | --- |
| `siteName` | Brand name used in toasts and shares |
| `siteUrl` | Live domain, e.g. `https://pingrab.example.com` |
| `supportEmail` | Address shown on the legal pages |
| `api.base` | `''` for same origin, or the full API URL if hosted separately |
| `api.timeoutMs` | Resolve timeout (30 s default) |
| `api.proxies` | Optional CORS-proxy fallbacks; leave empty in normal use |
| `ads.enabled` | `true` once real AdSense slot IDs are in place |
| `ads.client` / `ads.slots` | Your `ca-pub-...` ID and the three slot IDs |
| `adsterra.*` | Adsterra popunder/social bar script URLs and banner keys |
| `analytics.gaId` | Google Analytics 4 measurement ID (empty disables it) |
| `ui.maxRecent` | How many recent downloads to remember locally (default 8) |

Also update the placeholder domain `https://pingrab.opterik.com` in
`index.html`, `help.html`, `privacy.html`, `terms.html`, `sitemap.xml`,
`robots.txt` and `manifest.webmanifest`.

Analytics: `index.html` loads GA4 property `G-56Z4LHXTWY`. The content pages
load it too - replace the ID (or remove those blocks) before going live.

### Backend - environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` behind a reverse proxy) |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated origins allowed to call the API cross-origin, or `*` |
| `RATE_LIMIT` | `40` | Resolves allowed per IP per window |
| `RATE_WINDOW` | `600` | Window length in seconds |
| `PINGRAB_OPEN` | `1` | `0` disables auto-opening the browser on start |

Resolution results are cached for 30 minutes (`CACHE_TTL` in `server.py`).
Requests from `127.0.0.1`/`::1` are never rate limited, which keeps local
testing painless.

---

## API

All responses are JSON except `/api/download`, which streams the file.

### `GET /api/health`

```json
{ "ok": true, "service": "pingrab", "time": 1761696000 }
```

### `GET /api/resolve?url=<pin url>`

Accepts `pinterest.com/pin/<id>`, regional subdomains, `/video/` links,
`?url=` share links, trailing text and `pin.it/<code>` short links.

```json
{
  "ok": true,
  "data": {
    "id": "361554676351203398",
    "pinUrl": "https://www.pinterest.com/pin/361554676351203398/",
    "kind": "video",
    "title": "Sunset timelapse",
    "description": "Golden hour over the hills...",
    "author": { "name": "Studio Name", "avatar": "https://i.pinimg.com/..." },
    "thumbnail": "https://i.pinimg.com/videos/...jpg",
    "duration": 21.7,
    "width": 720,
    "size": 3670000,
    "filename": "pingrab-sunset-timelapse.mp4",
    "qualities": [
      { "label": "720p", "width": 720, "height": 1280, "url": "https://v1.pinimg.com/videos/...mp4", "size": 3670000, "codec": "h264" }
    ],
    "hls": null,
    "codecWarning": false
  }
}
```

Image pins return `"kind": "image"`, `"qualities": []` and a downloadable
`thumbnail`. `duration` is in seconds; `size` may be `null` if Pinterest does
not send a `Content-Length`.

### `GET /api/download?u=<media url>&name=<optional filename>`

Streams the media as an attachment. Supports `Range` requests. `u` must point
at an allowed Pinterest host and end in `.mp4`, `.jpg`, `.jpeg`, `.png`,
`.webp`, `.gif` or `.m4a` (anything else is saved as `.mp4`).

### Errors

Errors use a stable shape:

```json
{ "ok": false, "error": { "code": "no_media", "message": "Could not find a video on this pin." } }
```

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_url` | Missing or malformed link/parameter |
| 403 | `forbidden` | Download host is not a Pinterest media host |
| 404 | `not_found` | Pin removed, private, or short link expired |
| 422 | `invalid_url` / `no_media` | Not a pin link, or no video on the pin |
| 429 | `rate_limited` | Too many resolves from this IP |
| 500 | `server` | Unexpected extraction failure |
| 502 | `upstream` | Pinterest blocked/errored the request |
| 504 | `upstream` | Pinterest timed out |

---

## Deploying

### One service (recommended)

Deploy the whole folder to any host that runs Python 3, for example Render,
Railway, Fly.io, a VPS with systemd, or cPanel's "Setup Python App". Start
command:

```bash
python server.py
```

Set `PORT` if the platform provides one (most do). Put HTTPS in front of it -
Caddy, nginx, Cloudflare, or the platform's built-in TLS. A minimal nginx
config:

```nginx
server {
    listen 443 ssl;
    server_name pingrab.example.com;
    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # important for /api/download
        proxy_read_timeout 300s;
    }
}
```

`proxy_buffering off` keeps video downloads streaming instead of buffering the
whole file in nginx.

### Static frontend + separate API

The frontend is plain static files, so it can live on Netlify, Cloudflare
Pages, GitHub Pages or S3. Run `server.py` on a small VPS/app host for the API,
then:

1. Set `api.base` in `js/config.js` to the API origin.
2. Set `ALLOWED_ORIGINS=https://your-site.example` on the API server.
3. Add `_headers`/`netlify.toml` rules if you want long cache lifetimes for
   `css/`, `js/` and `icons/` (the service worker handles versioning).

Cross-origin downloads still work because the API sets
`Access-Control-Allow-Origin` and the file is fetched with
`Content-Disposition: attachment`.

### Checklist after deploying

- [ ] Replace `pingrab.opterik.com` everywhere (HTML, sitemap, robots, manifest).
- [ ] Set the real support email and review the legal pages.
- [ ] Submit `sitemap.xml` in Google Search Console and Bing Webmaster Tools.
- [ ] Add your AdSense publisher ID and slot IDs, then flip `ads.enabled: true`.
      `ads.txt` already contains the publisher line - update it if the ID changes.
- [ ] Replace the GA4 measurement ID or remove the analytics snippets.
- [ ] Bump `CACHE_VERSION` in `sw.js` whenever you ship new static files.
- [ ] Test one video and one image pin on a phone before announcing the site.

---

## PWA and assets

The site is installable: `manifest.webmanifest` + `sw.js` cache the app shell,
so the downloader UI opens offline (resolving and downloading still need the
network, and `/api/` requests are never cached).

To regenerate icons after changing the logo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\make-assets.ps1
```

This writes `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
`apple-touch-icon.png`, `favicon-16/32.png`, `favicon.ico`, `og-image.png`
(1200x630) and `screenshot-wide.png` (1280x720) into `icons/`. Everything is
drawn with `System.Drawing`, so no design tools or downloads are required.

---

## Notes, limits and legal

- Pinterest changes its markup regularly. Extraction lives in
  `extract_media()` in `server.py`; if a pin suddenly returns `no_media`, start
  there. The code already handles both `expMp4` and legacy `iht`/`mc` paths.
- Pinterest sometimes serves AV1 or HEVC. Those files are smaller but may not
  play in older browsers; PinGrab prefers H.264 and warns when it cannot.
- Only **public** pins can be downloaded. Private, board-only and deleted pins
  return a clear error.
- The in-app browsers inside the Pinterest, Instagram and Facebook apps often
  block downloads. The help page tells users to open the link in Chrome/Safari.
- PinGrab is not affiliated with Pinterest, Inc. Download only content you own
  or have permission to use, and respect Pinterest's terms and local copyright
  law. The bundled privacy policy and terms are starting points, not legal
  advice - have them reviewed for your jurisdiction.
- No media is stored on the server: `/api/download` proxies the stream straight
  from Pinterest's CDN.

## License

The site code is yours to use and modify. Brand assets in `icons/` are
generated from the included script. Pinterest and the Pinterest logo are
trademarks of Pinterest, Inc.
