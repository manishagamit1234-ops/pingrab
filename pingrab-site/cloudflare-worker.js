// Cloudflare Worker: PinGrab downloader API
// Paste this entire file into a Cloudflare Worker (Dashboard -> Workers -> Create -> paste code).
// Deploy, then set api.base in js/config.js to your worker URL (e.g. https://pingrab-api.<you>.workers.dev).

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MEDIA_HOST_SUFFIXES = ['pinimg.com', 'pinterest.com', 'pin.it'];

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...extra }
  });
}
function err(code, message, status = 400) {
  return json({ ok: false, error: { code, message } }, status);
}
function isAllowedHost(h) {
  h = (h || '').toLowerCase();
  return MEDIA_HOST_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
}
function isPinterestHost(h) {
  h = (h || '').toLowerCase();
  return h === 'pinterest.com' || h.endsWith('.pinterest.com') || h === 'pin.it' || h.endsWith('.pin.it');
}

async function handleHealth() {
  return json({ ok: true, service: 'pingrab', time: Math.floor(Date.now() / 1000) });
}

async function handleResolve(request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('url') || '';
  let raw2 = raw.trim();
  if (!raw2) return err('invalid_url', 'Paste a Pinterest pin link first.', 422);
  if (raw2.length > 2000) return err('invalid_url', 'That link is too long.', 422);
  if (!/^https?:\/\//i.test(raw2)) raw2 = 'https://' + raw2;
  let parts;
  try { parts = new URL(raw2); } catch (e) { return err('invalid_url', 'That does not look like a valid link.', 422); }
  const host = parts.hostname.toLowerCase();
  if (!isPinterestHost(host)) return err('invalid_url', 'Only Pinterest links are supported (pinterest.com or pin.it).', 422);

  let pinId, pinUrl;
  if (host.endsWith('pin.it')) {
    try {
      const res = await fetch(raw2, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      const m = res.url.match(/\/pin\/(\d{6,25})/i) || res.url.match(/(\d{6,25})/);
      if (!m) throw new Error('no id');
      pinId = m[1];
      pinUrl = 'https://www.pinterest.com/pin/' + pinId + '/';
    } catch (e) {
      return err('not_found', 'That pin.it link could not be resolved.', 404);
    }
  } else {
    const m = (parts.pathname + '/').match(/\/pin\/(\d{6,25})/i) || parts.pathname.match(/(\d{6,25})/);
    if (!m) return err('invalid_url', 'That link does not contain a pin ID. Open the pin on Pinterest and copy the full link.', 422);
    pinId = m[1];
    pinUrl = 'https://www.pinterest.com/pin/' + pinId + '/';
  }

  let doc;
  try {
    const res = await fetch(pinUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.pinterest.com/'
      },
      redirect: 'follow'
    });
    if (!res.ok) {
      if (res.status === 404) return err('not_found', 'This pin does not exist (HTTP 404). Check the link and try again.', 404);
      return err('upstream', 'Pinterest returned an error (HTTP ' + res.status + ').', 502);
    }
    doc = await res.text();
    if (!doc || doc.length < 100) return err('upstream', 'Pinterest returned an empty page. Please try again.', 502);
  } catch (e) {
    return err('upstream', 'Could not reach Pinterest. Check your connection and try again.', 504);
  }

  function unescapeJson(s){ if(!s)return ''; try{return JSON.parse('"'+s.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"');}catch(e){return s.replace(/\\u002F/gi,'/').replace(/\\\//g,'/');} }
  function metaContent(doc,name){ const re=new RegExp('<meta[^>]+(?:property|name)="'+name+'"[^>]+content="([^"]*)"', 'i'); const m=doc.match(re); if(m)return m[1]; const re2=new RegExp('<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="'+name+'"', 'i'); const m2=doc.match(re2); return m2?m2[1]:''; }
  function cleanTitle(t){ if(!t)return ''; return t.replace(/\s+/g,' ').replace(/\s*[-|]\s*Pinterest\s*$/i,'').trim().slice(0,180); }
  function codecOf(u){ const l=u.toLowerCase(); if(l.includes('av1'))return 'av1'; if(l.includes('h265')||l.includes('hevc'))return 'hevc'; return 'h264'; }
  function widthOf(u){ let m=u.match(/_(\d{2,4})w(?:[_./]|$)/i); if(m)return parseInt(m[1],10); m=u.match(/\/(\d{3,4})p\//i); if(m)return parseInt(m[1],10); return 0; }
  function extractMedia(doc){
    let text=doc.replace(/\\\//g,'/').replace(/\\u002F/gi,'/');
    text=text.replace(/&amp;/g,'&');
    const re=/https:\/\/[a-z0-9.-]*pinimg\.com\/videos\/[^"'<>\\s\\]+?\.(?:mp4|m3u8)(?:\?[^"'<>\\s\\]*)?/gi;
    const found=text.match(re)||[];
    const mp4s=[], hls=[], seen=new Set();
    for(const u of found){ if(seen.has(u))continue; seen.add(u); if(/\.m3u8/i.test(u))hls.push(u); else if(/\.mp4$/i.test(u.split('?')[0]))mp4s.push(u); }
    const qualities=mp4s.map(u=>({url:u,codec:codecOf(u),width:widthOf(u),label:(widthOf(u)?widthOf(u)+'p':'MP4'),size:null}));
    qualities.sort((a,b)=>{const rank={h264:0,av1:1,hevc:2};const ca=rank[a.codec]??3,cb=rank[b.codec]??3; if(ca!==cb)return ca-cb; if(a.width!==b.width)return b.width-a.width; return (a.url.includes('expMp4')?0:1)-(b.url.includes('expMp4')?0:1);});
    const best=[]; const used=new Set();
    for(const q of qualities){ if(best.length && q.codec!==best[0].codec)continue; const key=q.codec+'|'+q.width; if(used.has(key))continue; used.add(key); best.push(q); if(best.length>=3)break; }
    return {qualities:best,hls};
  }
  function findThumbnail(doc, ogImage){
    const m=doc.match(/https:\/\/i\.pinimg\.com\/videos\/thumbnails\/originals\/[^"'<>\\s\\]+?\.jpg/i);
    if(m)return m[0];
    let img=ogImage||'';
    img=img.replace(/(i\.pinimg\.com)\/\d+x\d*\//i,'$1/originals/');
    return img;
  }
  function findAuthor(doc){
    const re=/"pinner"\s*:\s*\{/g; let m;
    while((m=re.exec(doc))!==null){
      const block=doc.slice(m.index+m[0].length, m.index+m[0].length+1800);
      const name=block.match(/"fullName"\s*:\s*"([^"]+)"/);
      const user=block.match(/"username"\s*:\s*"([^"]+)"/);
      if(!name||!user)continue;
      const avatar=block.match(/"(?:imageMediumUrl|imageSmallUrl|imageLargeUrl)"\s*:\s*"([^"]+)"/);
      let avatarUrl=avatar?avatar[1].replace(/\\\//g,'/'):'';
      if(avatarUrl && !avatarUrl.startsWith('https://')) avatarUrl='';
      return {name:unescapeJson(name[1]).trim(), username:unescapeJson(user[1]).trim(), avatar:avatarUrl};
    }
    return null;
  }
  function findDuration(doc){
    const matches=[...doc.matchAll(/"duration"\s*:\s*(\d{3,8})/g)].map(m=>parseInt(m[1],10)).filter(v=>v>=500&&v<=3600000);
    if(!matches.length) return null;
    const counts={}; for(const v of matches) counts[v]=(counts[v]||0)+1;
    let best=matches[0], bestCount=0;
    for(const [v,c] of Object.entries(counts)){ if(c>bestCount||(c===bestCount&&parseInt(v,10)>best)){bestCount=c;best=parseInt(v,10);} }
    let seconds=best; if(seconds>10000) seconds=seconds/1000.0;
    return Math.round(seconds*10)/10;
  }
  function slugify(t){ return (t||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'pin'; }

  const title = cleanTitle(metaContent(doc,'og:title')) || 'Pinterest video';
  const description = (metaContent(doc,'og:description')||'').replace(/\s+/g,' ').trim().slice(0,600);
  const ogImage = metaContent(doc,'og:image').trim();
  const thumbnail = findThumbnail(doc, ogImage);
  const author = findAuthor(doc);
  const duration = findDuration(doc);
  const { qualities, hls } = extractMedia(doc);

  if (!qualities.length) {
    if (!thumbnail) return err('no_media', 'Could not find a video on this pin. It may be private or removed.', 422);
    return json({ ok: true, data: { id: pinId, pinUrl, kind: 'image', title, description, author, thumbnail, duration: null, size: null, qualities: [], hls: hls[0] || null } });
  }

  try {
    const hr = await fetch(qualities[0].url, { method: 'HEAD', headers: { 'User-Agent': UA, 'Referer': 'https://www.pinterest.com/' } });
    const cl = hr.headers.get('Content-Length');
    if (cl && /^\d+$/.test(cl) && parseInt(cl,10) > 0) qualities[0].size = parseInt(cl,10);
  } catch (e) {}

  const primary = qualities[0];
  const filename = 'pingrab-' + slugify(title) + '.mp4';

  return json({ ok: true, data: { id: pinId, pinUrl, kind: 'video', title, description, author, thumbnail, duration, width: primary.width || null, size: primary.size, filename, qualities, hls: hls[0] || null, codecWarning: primary.codec !== 'h264' } });
}

async function handleDownload(request) {
  const url = new URL(request.url);
  const target = url.searchParams.get('u') || '';
  const name = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._ -]+/g, '').trim().slice(0, 90);

  if (!target) return err('invalid_url', 'Missing media URL.', 400);
  let parsed;
  try { parsed = new URL(target); } catch (e) { return err('invalid_url', 'Invalid media URL.', 400); }
  if (!isAllowedHost(parsed.hostname)) return err('forbidden', 'That media host is not allowed.', 403);

  const extMatch = parsed.pathname.match(/\.[a-z0-9]+$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '.mp4';
  const allowedExt = ['.mp4', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.m4a'];
  const finalExt = allowedExt.includes(ext) ? ext : '.mp4';

  let filename = name;
  if (!filename) filename = 'pingrab-download' + finalExt;
  else if (!filename.toLowerCase().endsWith(finalExt)) filename = filename.replace(/\.[^.]*$/, '') + finalExt;

  const headers = {
    'User-Agent': UA,
    'Referer': 'https://www.pinterest.com/',
    'Accept': '*/*',
    'Accept-Encoding': 'identity'
  };
  const range = request.headers.get('Range');
  if (range) headers['Range'] = range;

  let upstream;
  try { upstream = await fetch(target, { headers }); } catch (e) {
    return err('upstream', 'Could not reach the Pinterest media server.', 504);
  }

  if (!upstream.ok && upstream.status !== 206) {
    const status = (upstream.status === 403 || upstream.status === 404 || upstream.status === 410) ? 404 : 502;
    const code = status === 404 ? 'not_found' : 'upstream';
    const msg = status === 404 ? 'The video file is no longer available on Pinterest.' : 'Pinterest refused the download (HTTP ' + upstream.status + ').';
    return err(code, msg, status);
  }

  const contentType = upstream.headers.get('Content-Type') || (finalExt === '.mp4' ? 'video/mp4' : 'image/jpeg');
  const respHeaders = {
    'Content-Type': contentType,
    'Content-Disposition': 'attachment; filename="' + filename + '"',
    'Cache-Control': 'public, max-age=3600'
  };
  const cl = upstream.headers.get('Content-Length');
  if (cl) respHeaders['Content-Length'] = cl;
  const cr = upstream.headers.get('Content-Range');
  if (cr) respHeaders['Content-Range'] = cr;
  const ar = upstream.headers.get('Accept-Ranges');
  if (ar) respHeaders['Accept-Ranges'] = ar;

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/api/health') return handleHealth();
    if (path === '/api/resolve') return handleResolve(request);
    if (path === '/api/download') return handleDownload(request);
    if (path.startsWith('/api/')) return err('not_found', 'Unknown API endpoint.', 404);
    return new Response('Not found', { status: 404 });
  }
};
