/* ==========================================================================
   PinGrab - downloader client
   Talks to the API in server.py, normalises the response and keeps a small
   local history. If the API is not reachable and a CORS proxy is configured
   in config.js, it falls back to parsing the pin page in the browser.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var API = (CFG.api && CFG.api.base ? CFG.api.base : '').replace(/\/+$/, '');
  var TIMEOUT = (CFG.api && CFG.api.timeoutMs) || 30000;
  var PROXIES = (CFG.api && Array.isArray(CFG.api.proxies)) ? CFG.api.proxies : [];
  var HISTORY_KEY = 'pingrab_history_v1';

  function PGError(code, message) {
    this.name = 'PGError';
    this.code = code;
    this.message = message;
  }
  PGError.prototype = Object.create(Error.prototype);

  var URL_RE = /(https?:\/\/[^\s<>"']+|(?:[a-z0-9-]+\.)*pinterest\.[a-z.]{2,10}\/[^\s<>"']+|pin\.it\/[^\s<>"']+)/i;

  function extractUrl(text) {
    var value = String(text || '').trim();
    if (!value) return '';
    var match = value.match(URL_RE);
    if (!match) return '';
    var url = match[1].replace(/[),.;!?]+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  function isPinterestUrl(url) {
    try {
      var host = new URL(url).hostname.toLowerCase();
      return host === 'pin.it' || host === 'pinterest.com' ||
        /(^|\.)pinterest\.[a-z.]{2,10}$/.test(host);
    } catch (e) {
      return false;
    }
  }

  function apiUrl(path, params) {
    var qs = new URLSearchParams(params || {}).toString();
    return (API + path) + (qs ? '?' + qs : '');
  }

  function downloadUrl(mediaUrl, filename, direct) {
    if (direct) return mediaUrl;
    return apiUrl('/api/download', { u: mediaUrl, name: filename || '' });
  }

  function withTimeout(promise, ms) {
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        reject(new PGError('timeout', 'Pinterest is taking too long. Please try again.'));
      }, ms);
    });
    return Promise.race([promise, timeout]).finally(function () { clearTimeout(timer); });
  }

  function badgeSize(bytes) {
    if (!bytes || bytes < 1) return '';
    var mb = bytes / (1024 * 1024);
    if (mb < 1) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (mb >= 10 ? Math.round(mb) : mb.toFixed(1)) + ' MB';
  }

  function durationText(seconds) {
    if (!seconds || !isFinite(seconds)) return '';
    var s = Math.round(seconds);
    var m = Math.floor(s / 60);
    var rest = s % 60;
    return m + ':' + (rest < 10 ? '0' : '') + rest;
  }

  function timeAgo(ts) {
    var diff = Math.max(0, Date.now() - ts) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
    var d = Math.floor(diff / 86400);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  /* ---------------- API ---------------- */
  async function resolveViaApi(pinUrl) {
    var controller = new AbortController();
    var req = fetch(apiUrl('/api/resolve', { url: pinUrl }), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      credentials: 'same-origin'
    });

    var response;
    try {
      response = await withTimeout(req, TIMEOUT);
    } catch (err) {
      if (err instanceof PGError) throw err;
      throw new PGError('api', 'Could not reach the downloader service. Start it locally with "python server.py", or deploy cloudflare-worker.js and set api.base in js/config.js.');
    }

    var text = await response.text();
    var data = null;
    try { data = JSON.parse(text); } catch (e) { data = null; }

    if (!data) {
      if (response.status === 404 || /<!doctype html/i.test(text)) {
        throw new PGError('api', 'The downloader API is not available on this server. Free options: (1) run locally: python server.py; (2) deploy server.py to Render/Railway/Fly (free) and set api.base; (3) deploy cloudflare-worker.js to Cloudflare Workers (free) and set api.base in js/config.js.');
      }
      throw new PGError('api', 'The server sent an unexpected response. Please try again.');
    }
    if (!response.ok || !data.ok) {
      var e = (data && data.error) || {};
      throw new PGError(e.code || 'error', e.message || 'Could not read that pin. Please try again.');
    }
    return normalise(data.data, pinUrl, false);
  }

  function normalise(raw, pinUrl, direct) {
    var qualities = (raw.qualities || []).map(function (q) {
      return {
        label: q.label || (q.width ? q.width + 'p' : 'MP4'),
        url: q.url,
        codec: q.codec || 'h264',
        width: q.width || 0,
        size: q.size || 0,
        sizeText: badgeSize(q.size),
        downloadUrl: downloadUrl(q.url, raw.filename, direct)
      };
    });
    var primary = qualities[0] || null;
    var isVideo = raw.kind !== 'image' && !!primary;
    var coverFilename = 'pingrab-cover-' + (raw.id || 'pin') + '.jpg';
    return {
      id: raw.id || '',
      url: raw.pinUrl || pinUrl,
      kind: isVideo ? 'video' : 'image',
      title: raw.title || 'Pinterest pin',
      description: raw.description || '',
      author: raw.author || null,
      thumbnail: raw.thumbnail || '',
      duration: raw.duration || 0,
      durationText: durationText(raw.duration),
      size: primary ? primary.size : 0,
      sizeText: primary ? primary.sizeText : '',
      filename: raw.filename || '',
      qualities: qualities,
      hls: raw.hls || '',
      codecWarning: !!raw.codecWarning,
      cover: raw.thumbnail ? {
        url: raw.thumbnail,
        downloadUrl: downloadUrl(raw.thumbnail, coverFilename, direct)
      } : null,
      direct: direct
    };
  }

  /* ---------------- optional in-browser fallback ---------------- */
  function meta(doc, prop) {
    var nodes = doc.querySelectorAll('meta[property="' + prop + '"], meta[name="' + prop + '"]');
    return nodes.length ? (nodes[0].getAttribute('content') || '') : '';
  }

  function parsePinHtml(html, pinUrl) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var text = html.replace(/\\\//g, '/');
    var title = (meta(doc, 'og:title') || '').split(' | ')[0].replace(/\s*\[video\]\s*$/i, '').trim();
    var thumbnail = meta(doc, 'og:image') || '';
    var idMatch = pinUrl.match(/\/pin\/(?:[^/?#]+?-)?(\d{6,25})/);
    var image = thumbnail;
    if (/i\.pinimg\.com\/\d+x\d*\//.test(image)) {
      image = image.replace(/(i\.pinimg\.com)\/\d+x\d*\//, '$1/originals/');
    }

    var seen = {};
    var qualities = [];
    var re = /https:\/\/[a-z0-9.-]*pinimg\.com\/videos\/[^"'<>\s\\]+?\.mp4/gi;
    var m;
    while ((m = re.exec(text))) {
      var u = m[0];
      if (seen[u]) continue;
      seen[u] = 1;
      if (/av1|h265|hevc/i.test(u)) continue;
      var wm = u.match(/_(\d{2,4})w/) || u.match(/\/(\d{3,4})p\//);
      var width = wm ? parseInt(wm[1], 10) : 0;
      qualities.push({ label: width ? width + 'p' : 'MP4', url: u, codec: 'h264', width: width, size: 0 });
    }
    qualities.sort(function (a, b) { return b.width - a.width; });

    var author = null;
    var auth = doc.querySelector('meta[name="pinterestapp:pinner"]');
    if (auth) author = { name: auth.getAttribute('content') || '', username: '' };

    var dur = text.match(/"duration"\s*:\s*(\d{4,8})/);

    return {
      id: idMatch ? idMatch[1] : '',
      pinUrl: pinUrl,
      kind: qualities.length ? 'video' : 'image',
      title: title || 'Pinterest pin',
      description: (meta(doc, 'og:description') || '').slice(0, 600),
      author: author,
      thumbnail: image,
      duration: dur ? parseInt(dur[1], 10) / 1000 : 0,
      filename: 'pingrab-' + (idMatch ? idMatch[1] : 'video') + '.mp4',
      qualities: qualities.slice(0, 3),
      codecWarning: false
    };
  }

  async function resolveViaProxy(pinUrl) {
    for (var i = 0; i < PROXIES.length; i++) {
      var proxy = PROXIES[i].replace('{url}', encodeURIComponent(pinUrl));
      try {
        var res = await withTimeout(fetch(proxy, { headers: { Accept: 'text/html' } }), TIMEOUT);
        if (!res.ok) continue;
        var html = await res.text();
        if (!html || html.length < 500) continue;
        var raw = parsePinHtml(html, pinUrl);
        if (!raw.qualities.length && !raw.thumbnail) continue;
        return normalise(raw, pinUrl, true);
      } catch (e) {
        /* try the next proxy */
      }
    }
    throw new PGError('api', 'The downloader API is not available and no fallback proxy worked.');
  }

  async function resolve(input) {
    var pinUrl = extractUrl(input);
    if (!pinUrl) {
      throw new PGError('invalid_url', 'Paste a Pinterest link, for example https://www.pinterest.com/pin/123456789/');
    }
    if (!isPinterestUrl(pinUrl)) {
      throw new PGError('invalid_url', 'That is not a Pinterest link. Use a pinterest.com, in.pinterest.com or pin.it URL.');
    }
    var retried = false;
    try {
      return await resolveViaApi(pinUrl);
    } catch (err) {
      if (PROXIES.length && (err.code === 'api' || err.code === 'timeout')) {
        return resolveViaProxy(pinUrl);
      }
      // Retry once for cold starts / transient 404s on free hosts
      if (err.code === 'api' && !retried) {
        retried = true;
        await new Promise(function (r) { setTimeout(r, 2000); });
        try { return await resolveViaApi(pinUrl); } catch (e2) { /* fall through */ }
      }
      throw err;
    }
  }

  /* ---------------- history ---------------- */
  function readHistory() {
    try {
      var list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (x) { return x && x.url; }) : [];
    } catch (e) {
      return [];
    }
  }

  function saveHistory(entry) {
    if (!entry || !entry.url) return [];
    var list = readHistory().filter(function (x) { return x.id !== entry.id || !entry.id; });
    list.unshift({
      id: entry.id || '',
      url: entry.url,
      title: entry.title || 'Pinterest pin',
      thumbnail: entry.thumbnail || '',
      kind: entry.kind || 'video',
      label: entry.label || '',
      ts: Date.now()
    });
    var max = (CFG.ui && CFG.ui.maxRecent) || 8;
    list = list.slice(0, max);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) { /* ignore quota */ }
    return list;
  }

  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch (e) { /* ignore */ }
    return [];
  }

  window.PinGrab = {
    resolve: resolve,
    extractUrl: extractUrl,
    isPinterestUrl: isPinterestUrl,
    downloadUrl: downloadUrl,
    badgeSize: badgeSize,
    durationText: durationText,
    timeAgo: timeAgo,
    readHistory: readHistory,
    saveHistory: saveHistory,
    clearHistory: clearHistory,
    PGError: PGError
  };
})();
