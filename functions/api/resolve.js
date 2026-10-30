const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function err(code, message, status = 400) {
  return json({ ok: false, error: { code, message } }, status);
}

function isPinterestHost(host) {
  const h = (host || '').toLowerCase();
  return h === 'pinterest.com' || h.endsWith('.pinterest.com') || h === 'pin.it' || h.endsWith('.pin.it');
}

function parsePinUrl(raw) {
  raw = (raw || '').trim();
  if (!raw) throw { code: 'invalid_url', message: 'Paste a Pinterest pin link first.', status: 422 };
  if (raw.length > 2000) throw { code: 'invalid_url', message: 'That link is too long.', status: 422 };
  if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
  let parts;
  try { parts = new URL(raw); } catch (e) {
    throw { code: 'invalid_url', message: 'That does not look like a valid link.', status: 422 };
  }
  const host = parts.hostname.toLowerCase();
  if (!isPinterestHost(host)) throw { code: 'invalid_url', message: 'Only Pinterest links are supported (pinterest.com or pin.it).', status: 422 };

  if (host.endsWith('pin.it')) return { short: true, raw };

  const m = (parts.pathname + '/').match(/\/pin\/(\d{6,25})/i) || parts.pathname.match(/(\d{6,25})/);
  if (!m) throw { code: 'invalid_url', message: 'That link does not contain a pin ID. Open the pin on Pinterest and copy the full link.', status: 422 };
  const pinId = m[1];
  return { pinId, canonical: 'https://www.pinterest.com/pin/' + pinId + '/' };
}

function unescapeJson(s) {
  if (!s) return '';
  try {
    return JSON.parse('"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
  } catch (e) {
    return s.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  }
}

function metaContent(doc, name) {
  const re = new RegExp('<meta[^>]+(?:property|name)="' + name + '"[^>]+content="([^"]*)"', 'i');
  const m = doc.match(re);
  if (m) return m[1];
  const re2 = new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="' + name + '"', 'i');
  const m2 = doc.match(re2);
  return m2 ? m2[1] : '';
}

function cleanTitle(t) {
  if (!t) return '';
  return t.replace(/\s+/g, ' ').replace(/\s*[-|]\s*Pinterest\s*$/i, '').trim().slice(0, 180);
}

function codecOf(url) {
  const low = url.toLowerCase();
  if (low.includes('av1')) return 'av1';
  if (low.includes('h265') || low.includes('hevc')) return 'hevc';
  return 'h264';
}

function widthOf(url) {
  let m = url.match(/_(\d{2,4})w(?:[_./]|$)/i);
  if (m) return parseInt(m[1], 10);
  m = url.match(/\/(\d{3,4})p\//i);
  if (m) return parseInt(m[1], 10);
  return 0;
}

function extractMedia(doc) {
  let text = doc.replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
  text = text.replace(/&amp;/g, '&');
  const re = /https:\/\/[a-z0-9.-]*pinimg\.com\/videos\/[^"'<>\\s\\]+?\.(?:mp4|m3u8)(?:\?[^"'<>\\s\\]*)?/gi;
  const found = text.match(re) || [];
  const mp4s = [], hls = [], seen = new Set();
  for (const url of found) {
    if (seen.has(url)) continue;
    seen.add(url);
    if (/\.m3u8/i.test(url)) hls.push(url);
    else if (/\.mp4$/i.test(url.split('?')[0])) mp4s.push(url);
  }

  const qualities = mp4s.map(url => ({
    url,
    codec: codecOf(url),
    width: widthOf(url),
    label: (widthOf(url) ? widthOf(url) + 'p' : 'MP4'),
    size: null
  }));

  qualities.sort((a, b) => {
    const rank = { h264: 0, av1: 1, hevc: 2 };
    const ca = rank[a.codec] ?? 3;
    const cb = rank[b.codec] ?? 3;
    if (ca !== cb) return ca - cb;
    if (a.width !== b.width) return b.width - a.width;
    return (a.url.includes('expMp4') ? 0 : 1) - (b.url.includes('expMp4') ? 0 : 1);
  });

  const best = [];
  const used = new Set();
  for (const q of qualities) {
    if (best.length && q.codec !== best[0].codec) continue;
    const key = q.codec + '|' + q.width;
    if (used.has(key)) continue;
    used.add(key);
    best.push(q);
    if (best.length >= 3) break;
  }
  return { qualities: best, hls };
}

function findThumbnail(doc, ogImage) {
  const m = doc.match(/https:\/\/i\.pinimg\.com\/videos\/thumbnails\/originals\/[^"'<>\\s\\]+?\.jpg/i);
  if (m) return m[0];
  let img = ogImage || '';
  img = img.replace(/(i\.pinimg\.com)\/\d+x\d*\//i, '$1/originals/');
  return img;
}

function findAuthor(doc) {
  const re = /"pinner"\s*:\s*\{/g;
  let m;
  while ((m = re.exec(doc)) !== null) {
    const block = doc.slice(m.index + m[0].length, m.index + m[0].length + 1800);
    const name = block.match(/"fullName"\s*:\s*"([^"]+)"/);
    const user = block.match(/"username"\s*:\s*"([^"]+)"/);
    if (!name || !user) continue;
    const avatar = block.match(/"(?:imageMediumUrl|imageSmallUrl|imageLargeUrl)"\s*:\s*"([^"]+)"/);
    let avatarUrl = avatar ? avatar[1].replace(/\\\//g, '/') : '';
    if (avatarUrl && !avatarUrl.startsWith('https://')) avatarUrl = '';
    return {
      name: unescapeJson(name[1]).trim(),
      username: unescapeJson(user[1]).trim(),
      avatar: avatarUrl
    };
  }
  return null;
}

function findDuration(doc) {
  const matches = [...doc.matchAll(/"duration"\s*:\s*(\d{3,8})/g)].map(m => parseInt(m[1], 10)).filter(v => v >= 500 && v <= 3600000);
  if (!matches.length) return null;
  const counts = {};
  for (const v of matches) counts[v] = (counts[v] || 0) + 1;
  let best = matches[0], bestCount = 0;
  for (const [v, c] of Object.entries(counts)) {
    if (c > bestCount || (c === bestCount && parseInt(v,10) > best)) { bestCount = c; best = parseInt(v,10); }
  }
  // Pinterest durations are often in ms
  let seconds = best;
  if (seconds > 10000) seconds = seconds / 1000.0;
  return Math.round(seconds * 10) / 10;
}

function slugify(t) {
  return (t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'pin';
}

async function fetchPinPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.pinterest.com/'
    },
    redirect: 'follow'
  });
  if (!res.ok) {
    if (res.status === 404) throw { code: 'not_found', message: 'This pin does not exist (HTTP 404). Check the link and try again.', status: 404 };
    throw { code: 'upstream', message: 'Pinterest returned an error (HTTP ' + res.status + ').', status: 502 };
  }
  const text = await res.text();
  if (!text || text.length < 100) throw { code: 'upstream', message: 'Pinterest returned an empty page. Please try again.', status: 502 };
  return { text, finalUrl: res.url };
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const raw = url.searchParams.get('url') || '';
  let info;
  try { info = parsePinUrl(raw); } catch (e) {
    return err(e.code, e.message, e.status || 422);
  }

  let pinId, pinUrl;
  if (info.short) {
    // resolve pin.it redirect
    try {
      const res = await fetch(info.raw, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      const finalUrl = res.url;
      const m = finalUrl.match(/\/pin\/(\d{6,25})/i) || finalUrl.match(/(\d{6,25})/);
      if (!m) throw new Error('no id');
      pinId = m[1];
      pinUrl = 'https://www.pinterest.com/pin/' + pinId + '/';
    } catch (e) {
      return err('not_found', 'That pin.it link could not be resolved.', 404);
    }
  } else {
    pinId = info.pinId;
    pinUrl = info.canonical;
  }

  let doc, finalUrl;
  try {
    const r = await fetchPinPage(pinUrl);
    doc = r.text;
    finalUrl = r.finalUrl;
  } catch (e) {
    if (e.code) return err(e.code, e.message, e.status);
    return err('upstream', 'Could not reach Pinterest. Check your connection and try again.', 504);
  }

  const title = cleanTitle(metaContent(doc, 'og:title')) || 'Pinterest video';
  const description = (metaContent(doc, 'og:description') || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const ogImage = metaContent(doc, 'og:image').trim();
  const thumbnail = findThumbnail(doc, ogImage);
  const author = findAuthor(doc);
  const duration = findDuration(doc);
  const { qualities, hls } = extractMedia(doc);

  if (!qualities.length) {
    if (!thumbnail) return err('no_media', 'Could not find a video on this pin. It may be private or removed.', 422);
    return json({ ok: true, data: {
      id: pinId, pinUrl, kind: 'image', title, description, author, thumbnail,
      duration: null, size: null, qualities: [], hls: hls[0] || null
    } });
  }

  // size lookup for first quality
  try {
    const hr = await fetch(qualities[0].url, { method: 'HEAD', headers: { 'User-Agent': UA, 'Referer': 'https://www.pinterest.com/' } });
    const cl = hr.headers.get('Content-Length');
    if (cl && /^\d+$/.test(cl) && parseInt(cl, 10) > 0) qualities[0].size = parseInt(cl, 10);
  } catch (e) {}

  const primary = qualities[0];
  const filename = 'pingrab-' + slugify(title) + '.mp4';

  return json({ ok: true, data: {
    id: pinId, pinUrl, kind: 'video', title, description, author, thumbnail,
    duration, width: primary.width || null, size: primary.size, filename, qualities,
    hls: hls[0] || null, codecWarning: primary.codec !== 'h264'
  } });
}
