const MEDIA_HOST_SUFFIXES = ['pinimg.com', 'pinterest.com', 'pin.it'];

function isAllowedHost(hostname) {
  const h = (hostname || '').toLowerCase();
  return MEDIA_HOST_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('u') || '';
  const name = (url.searchParams.get('name') || '').replace(/[^A-Za-z0-9._ -]+/g, '').trim().slice(0, 90);

  if (!target) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'invalid_url', message: 'Missing media URL.' } }), {
      status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  let parsed;
  try { parsed = new URL(target); } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'invalid_url', message: 'Invalid media URL.' } }), {
      status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  if (!isAllowedHost(parsed.hostname)) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'That media host is not allowed.' } }), {
      status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  const ext = (parsed.pathname.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase() || '.mp4';
  const allowedExt = ['.mp4', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.m4a'];
  const finalExt = allowedExt.includes(ext) ? ext : '.mp4';

  let filename = name;
  if (!filename) filename = 'pingrab-download' + finalExt;
  else if (!filename.toLowerCase().endsWith(finalExt)) filename = filename.replace(/\.[^.]*$/, '') + finalExt;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': 'https://www.pinterest.com/',
    'Accept': '*/*',
    'Accept-Encoding': 'identity'
  };
  const range = context.request.headers.get('Range');
  if (range) headers['Range'] = range;

  let upstream;
  try {
    upstream = await fetch(target, { headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: { code: 'upstream', message: 'Could not reach the Pinterest media server.' } }), {
      status: 504, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  }

  if (!upstream.ok && upstream.status !== 206) {
    const status = (upstream.status === 403 || upstream.status === 404 || upstream.status === 410) ? 404 : 502;
    const code = status === 404 ? 'not_found' : 'upstream';
    const msg = status === 404 ? 'The video file is no longer available on Pinterest.' : 'Pinterest refused the download (HTTP ' + upstream.status + ').';
    return new Response(JSON.stringify({ ok: false, error: { code, message: msg } }), {
      status, headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
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
