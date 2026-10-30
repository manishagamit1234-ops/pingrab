/* ==========================================================================
   PinGrab - UI controller
   Theme, navigation, downloader form, result rendering, PWA and ads.
   ========================================================================== */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var PG = window.PinGrab;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var state = {
    busy: false,
    current: null,
    quality: null,
    lastResultAt: 0
  };

  var els = {};

  /* ---------------------------------------------------------------- theme */
  var THEME_KEY = 'pingrab_theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var sun = $('#icon-sun');
    var moon = $('#icon-moon');
    if (sun && moon) {
      sun.hidden = theme === 'dark';
      moon.hidden = theme !== 'dark';
    }
    var btn = $('#theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  }

  function initTheme() {
    var stored = '';
    try { stored = localStorage.getItem(THEME_KEY) || ''; } catch (e) { /* ignore */ }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(stored === 'dark' || stored === 'light' ? stored : (prefersDark ? 'dark' : 'light'));

    var btn = $('#theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
  }

  /* ------------------------------------------------------------ navigation */
  function initNav() {
    var toggle = $('#nav-toggle');
    var nav = $('#site-nav');
    if (!toggle || !nav) return;

    function close() {
      nav.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target) && !toggle.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* ---------------------------------------------------------------- toast */
  var toastTimer = null;
  function toast(message) {
    var el = els.toast;
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, 2600);
  }

  /* --------------------------------------------------------------- status */
  var ICONS = {
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>'
  };

  function showStatus(tone, message, extra) {
    var el = els.status;
    if (!el) return;
    el.innerHTML = '';
    var icon = document.createElement('span');
    icon.innerHTML = ICONS[tone] || ICONS.info;
    el.appendChild(icon.firstChild);
    var body = document.createElement('div');
    var p = document.createElement('p');
    p.style.margin = '0';
    p.textContent = message;
    body.appendChild(p);
    if (extra) {
      var hint = document.createElement('p');
      hint.style.margin = '4px 0 0';
      hint.style.fontSize = '.82em';
      hint.innerHTML = extra;
      body.appendChild(hint);
    }
    el.appendChild(body);
    el.dataset.tone = tone;
    el.hidden = false;
  }

  function hideStatus() {
    if (els.status) els.status.hidden = true;
  }

  function hideResult() {
    if (els.result) els.result.hidden = true;
    if (els.skeleton) els.skeleton.hidden = true;
  }

  /* --------------------------------------------------------------- render */
  function initials(name) {
    var parts = String(name || '').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || 'P';
  }

  function buildChips(data) {
    var wrap = els.resChips;
    wrap.innerHTML = '';
    if (data.kind === 'video' && state.quality) {
      var hd = document.createElement('li');
      hd.className = 'hd';
      hd.textContent = state.quality.label + (state.quality.codec === 'h264' ? ' HD' : ' · ' + state.quality.codec.toUpperCase());
      wrap.appendChild(hd);
    }
    var format = document.createElement('li');
    format.textContent = data.kind === 'video' ? 'MP4' : 'JPG';
    wrap.appendChild(format);
    if (state.quality && state.quality.sizeText) {
      var size = document.createElement('li');
      size.textContent = state.quality.sizeText;
      wrap.appendChild(size);
    }
    if (data.durationText) {
      var dur = document.createElement('li');
      dur.textContent = data.durationText;
      wrap.appendChild(dur);
    }
    if (data.kind === 'image') {
      var img = document.createElement('li');
      img.textContent = 'Still image';
      wrap.appendChild(img);
    }
  }

  function selectedQuality() {
    if (!state.current || !state.current.qualities.length) return null;
    var index = els.resQuality ? parseInt(els.resQuality.value, 10) || 0 : 0;
    return state.current.qualities[index] || state.current.qualities[0];
  }

  function updatePrimaryLink(data) {
    state.quality = selectedQuality();
    var link = els.resDownload;
    if (!link) return;
    if (data.kind === 'image') {
      link.href = data.cover ? data.cover.downloadUrl : data.thumbnail;
      link.textContent = 'Download image';
      if (data.direct) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.removeAttribute('download');
      } else {
        link.setAttribute('download', 'pingrab-' + (data.id || 'pin') + '.jpg');
        link.removeAttribute('target');
      }
    } else if (state.quality) {
      link.href = state.quality.downloadUrl;
      link.innerHTML = '';
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '19'); svg.setAttribute('height', '19');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.1');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      var p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p1.setAttribute('d', 'M12 3v12M7 10l5 5 5-5M5 21h14');
      svg.appendChild(p1);
      link.appendChild(svg);
      link.appendChild(document.createTextNode(' Download MP4'));
      if (data.direct) {
        link.removeAttribute('download');
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      } else {
        link.setAttribute('download', data.filename || 'pingrab-video.mp4');
        link.removeAttribute('target');
      }
    }
  }

  function renderResult(data) {
    state.current = data;
    hideStatus();

    var thumb = els.resThumb;
    if (data.thumbnail) {
      thumb.src = data.thumbnail;
      thumb.alt = data.title ? 'Preview of ' + data.title : 'Pin preview';
      thumb.hidden = false;
    } else {
      thumb.removeAttribute('src');
      thumb.hidden = true;
    }

    els.resKicker.textContent = data.kind === 'video' ? 'Video found' : 'Image pin';
    els.resDuration.hidden = !data.durationText;
    els.resDuration.textContent = data.durationText;
    els.resTitle.textContent = data.title;

    if (data.description) {
      els.resDesc.textContent = data.description;
      els.resDesc.hidden = false;
    } else {
      els.resDesc.hidden = true;
    }

    var authorWrap = els.resAuthor;
    authorWrap.innerHTML = '';
    if (data.author && (data.author.name || data.author.username)) {
      if (data.author.avatar) {
        var img = document.createElement('img');
        img.src = data.author.avatar;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        authorWrap.appendChild(img);
      } else {
        var fb = document.createElement('span');
        fb.className = 'avatar-fallback';
        fb.textContent = initials(data.author.name);
        authorWrap.appendChild(fb);
      }
      var name = document.createElement('span');
      name.textContent = data.author.name || data.author.username;
      authorWrap.appendChild(name);
      if (data.author.username && data.author.name) {
        var handle = document.createElement('span');
        handle.className = 'muted';
        handle.textContent = ' @' + data.author.username;
        authorWrap.appendChild(handle);
      }
      authorWrap.hidden = false;
    } else {
      authorWrap.hidden = true;
    }

    var play = els.resPlay;
    var videoQuality = data.qualities[0];
    if (data.kind === 'video' && videoQuality) {
      play.hidden = false;
      play.setAttribute('aria-label', 'Preview video');
    } else {
      play.hidden = true;
    }

    if (data.qualities.length > 1) {
      els.resQualityWrap.hidden = false;
      els.resQuality.innerHTML = '';
      data.qualities.forEach(function (q, i) {
        var opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = q.label + (q.codec !== 'h264' ? ' · ' + q.codec.toUpperCase() : '') + (q.sizeText ? ' · ' + q.sizeText : '');
        els.resQuality.appendChild(opt);
      });
      els.resQuality.value = '0';
    } else {
      els.resQualityWrap.hidden = true;
      els.resQuality.innerHTML = '';
    }

    updatePrimaryLink(data);
    buildChips(data);

    if (data.cover && data.kind === 'video') {
      els.resCover.hidden = false;
      els.resCover.href = data.cover.downloadUrl;
      els.resCover.textContent = 'Cover JPG';
      if (data.direct) {
        els.resCover.removeAttribute('download');
        els.resCover.target = '_blank';
        els.resCover.rel = 'noopener noreferrer';
      } else {
        els.resCover.setAttribute('download', 'pingrab-cover-' + (data.id || 'pin') + '.jpg');
        els.resCover.removeAttribute('target');
      }
    } else {
      els.resCover.hidden = true;
    }

    els.resOpen.href = data.url;
    els.resFilename.textContent = data.kind === 'image'
      ? 'pingrab-' + (data.id || 'pin') + '.jpg'
      : (data.filename || 'pingrab-video.mp4');

    els.result.hidden = false;
    els.skeleton.hidden = true;
    state.lastResultAt = Date.now();

    var box = els.result.getBoundingClientRect();
    if (box.top > window.innerHeight - 120 || box.top < 0) {
      requestAnimationFrame(function () {
        els.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
  }

  /* --------------------------------------------------------------- loading */
  function setBusy(busy) {
    state.busy = busy;
    if (!els.submitBtn) return;
    els.submitBtn.disabled = busy;
    els.submitBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
    var label = els.submitBtn.querySelector('.btn-label');
    var spinner = els.submitBtn.querySelector('.spinner');
    var arrow = els.submitBtn.querySelector('.btn-arrow');
    if (label) label.textContent = busy ? 'Reading pin…' : 'Get video';
    if (spinner) spinner.hidden = !busy;
    if (arrow) arrow.hidden = busy;
    if (els.downloader) els.downloader.classList.toggle('is-busy', busy);
  }

  function errorHint(err) {
    if (err.code === 'api') {
      return 'Tip: the API is included in <code>server.py</code>. Start it with <code>python server.py</code>, or see <a href="help.html#hosting">hosting help</a>.';
    }
    if (err.code === 'rate_limited') {
      return 'Wait a minute and try again.';
    }
    if (err.code === 'invalid_url' || err.code === 'not_found' || err.code === 'no_media') {
      return 'Copy the link again from Pinterest: open the pin → ••• → <b>Copy link</b>.';
    }
    return '';
  }

  async function start(rawValue) {
    if (state.busy) return;
    var input = els.pinUrl;
    var raw = String(rawValue != null ? rawValue : input.value || '').trim();
    if (!raw) {
      input.classList.add('is-invalid');
      input.focus();
      showStatus('error', 'Paste a Pinterest link first.');
      return;
    }

    var url = PG.extractUrl(raw);
    if (!url || !PG.isPinterestUrl(url)) {
      input.classList.add('is-invalid');
      input.focus();
      showStatus('error', 'That link is not from Pinterest. It should look like pinterest.com/pin/123456789/ or pin.it/abc123.');
      return;
    }

    input.value = url;
    input.classList.remove('is-invalid');
    hideResult();
    hideStatus();
    setBusy(true);
    if (els.skeleton) els.skeleton.hidden = false;

    try {
      var data = await PG.resolve(url);
      renderResult(data);
      setBusy(false);
      showStatus(
        data.codecWarning ? 'warn' : (data.kind === 'image' ? 'info' : 'success'),
        data.codecWarning
          ? 'This pin only offers HEVC/AV1 video. The download works, but the file may not play in every app.'
          : (data.kind === 'video'
            ? 'Video ready. Pick a quality and download it.'
            : 'This pin is an image. You can save the full-size JPG.')
      );
      try {
        var share = new URL(location.href);
        share.searchParams.set('url', url);
        history.replaceState(null, '', share.pathname + share.search + share.hash);
      } catch (e) { /* ignore */ }
    } catch (err) {
      setBusy(false);
      state.current = null;
      hideResult();
      showStatus('error', err && err.message ? err.message : 'Something went wrong. Please try again.', errorHint(err || {}));
    }
  }

  /* --------------------------------------------------------------- history */
  function renderHistory() {
    if (!els.recent) return;
    var list = (CFG.ui && CFG.ui.showRecent === false) ? [] : PG.readHistory();
    if (!list.length) {
      els.recent.hidden = true;
      els.recentList.innerHTML = '';
      return;
    }
    els.recent.hidden = false;
    els.recentList.innerHTML = '';
    list.forEach(function (item) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'recent-item';
      btn.title = item.title;

      var img = document.createElement('img');
      img.className = 'recent-thumb';
      img.src = item.thumbnail || 'icons/favicon-32.png';
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = function () { img.src = 'icons/favicon-32.png'; };
      btn.appendChild(img);

      var meta = document.createElement('span');
      meta.className = 'recent-meta';
      var title = document.createElement('span');
      title.className = 'recent-title';
      title.textContent = item.title || 'Pinterest pin';
      var sub = document.createElement('span');
      sub.className = 'recent-sub';
      sub.textContent = (item.label ? item.label + ' · ' : '') + PG.timeAgo(item.ts || Date.now());
      meta.appendChild(title);
      meta.appendChild(sub);
      btn.appendChild(meta);

      btn.addEventListener('click', function () {
        els.pinUrl.value = item.url;
        start(item.url);
        els.downloader.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      els.recentList.appendChild(btn);
    });
  }

  /* ---------------------------------------------------------------- events */
  function initDownloader() {
    if (!els.form) return;

    els.form.addEventListener('submit', function (e) {
      e.preventDefault();
      start();
    });

    els.pinUrl.addEventListener('input', function () {
      els.pinUrl.classList.remove('is-invalid');
    });

    if (els.pasteBtn) {
      els.pasteBtn.addEventListener('click', async function () {
        try {
          var text = await navigator.clipboard.readText();
          if (!text) throw new Error('empty');
          els.pinUrl.value = text.trim();
          els.pinUrl.focus();
          if (PG.isPinterestUrl(PG.extractUrl(text))) start(text);
        } catch (e) {
          els.pinUrl.focus();
          showStatus('info', 'Press and hold the box, then choose Paste (clipboard access is blocked in this browser).');
        }
      });
    }

    if (els.resQuality) {
      els.resQuality.addEventListener('change', function () {
        if (!state.current) return;
        updatePrimaryLink(state.current);
        buildChips(state.current);
      });
    }

    if (els.resDownload) {
      els.resDownload.addEventListener('click', function () {
        if (!state.current) return;
        PG.saveHistory({
          id: state.current.id,
          url: state.current.url,
          title: state.current.title,
          thumbnail: state.current.thumbnail,
          kind: state.current.kind,
          label: state.quality ? state.quality.label : 'JPG'
        });
        renderHistory();
        toast(state.current.kind === 'video' ? 'Download started — check your downloads' : 'Image download started');
      });
    }

    if (els.resCover) {
      els.resCover.addEventListener('click', function () {
        if (!state.current) return;
        PG.saveHistory(state.current);
        renderHistory();
        toast('Cover image download started');
      });
    }

    if (els.resCopy) {
      els.resCopy.addEventListener('click', async function () {
        var url = state.quality ? state.quality.url : (state.current && state.current.thumbnail);
        if (!url) return;
        try {
          await navigator.clipboard.writeText(url);
          toast('Direct video link copied');
        } catch (e) {
          var ta = document.createElement('textarea');
          ta.value = url;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); toast('Direct video link copied'); }
          catch (err) { toast('Could not copy the link'); }
          document.body.removeChild(ta);
        }
      });
    }

    if (els.resShare) {
      els.resShare.addEventListener('click', async function () {
        if (!state.current) return;
        var shareUrl = location.origin + location.pathname + '?url=' + encodeURIComponent(state.current.url);
        if (navigator.share) {
          try {
            await navigator.share({ title: 'PinGrab', text: state.current.title, url: shareUrl });
            return;
          } catch (e) { /* cancelled */ }
        }
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast('Page link copied');
        } catch (e) {
          toast('Could not copy the link');
        }
      });
    }

    if (els.resPlay && els.previewDialog) {
      els.resPlay.addEventListener('click', function () {
        var q = state.quality || (state.current && state.current.qualities[0]);
        if (!q) return;
        if (typeof els.previewDialog.showModal === 'function') {
          els.previewVideo.src = q.url;
          els.previewDialog.showModal();
          var playPromise = els.previewVideo.play();
          if (playPromise && playPromise.catch) playPromise.catch(function () { /* autoplay blocked is fine */ });
        } else {
          window.open(q.url, '_blank', 'noopener');
        }
      });
      els.previewDialog.addEventListener('click', function (e) {
        if (e.target === els.previewDialog) els.previewDialog.close();
      });
      if (els.previewClose) {
        els.previewClose.addEventListener('click', function () { els.previewDialog.close(); });
      }
      els.previewDialog.addEventListener('close', function () {
        els.previewVideo.pause();
        els.previewVideo.removeAttribute('src');
        els.previewVideo.load();
      });
    }

    if (els.recentClear) {
      els.recentClear.addEventListener('click', function () {
        PG.clearHistory();
        renderHistory();
        toast('Recent downloads cleared');
      });
    }

    renderHistory();
  }

  /* ---------------------------------------------------------------- install */
  function initInstall() {
    var btn = els.installBtn;
    if (!btn) return;
    var deferred = null;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;

    if (isIOS && !standalone) {
      btn.hidden = false;
      btn.addEventListener('click', function () {
        toast('Tap Share, then “Add to Home Screen”');
      });
      return;
    }

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });
    btn.addEventListener('click', async function () {
      if (!deferred) return;
      deferred.prompt();
      try { await deferred.userChoice; } catch (e) { /* ignore */ }
      deferred = null;
      btn.hidden = true;
    });
    window.addEventListener('appinstalled', function () {
      btn.hidden = true;
      toast('PinGrab installed');
    });
  }

  /* -------------------------------------------------------------------- ads */
  function initAds() {
    if (!CFG.adsConfigured || !CFG.adsConfigured()) {
      $$('.ad-slot').forEach(function (slot) {
        slot.setAttribute('aria-label', 'Advertisement space');
      });
      return;
    }
    var client = CFG.ads.client;
    if (!document.querySelector('script[src*="adsbygoogle.js"]')) {
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
      s.crossOrigin = 'anonymous';
      s.setAttribute('data-pingrab-ads', '1');
      document.head.appendChild(s);
    }
    $$('.ad-slot[data-ad]').forEach(function (slot) {
      var key = slot.getAttribute('data-ad');
      var slotId = CFG.ads.slots[key];
      if (!slotId || slotId === '0000000000') return;
      var ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', client);
      ins.setAttribute('data-ad-slot', slotId);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      slot.innerHTML = '';
      slot.appendChild(ins);
      slot.classList.add('is-filled');
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* ignore */ }
    });
  }

  /* -------------------------------------------------------------- adsterra */
  function injectScriptOnce(src, dataAttr) {
    if (!src || document.querySelector('script[' + dataAttr + ']')) return null;
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    s.setAttribute(dataAttr, '1');
    document.head.appendChild(s);
    return s;
  }

  function initAdsterra() {
    var cfg = (CFG.adsterra || {});
    if (!CFG.adsterraConfigured || !CFG.adsterraConfigured()) return;

    // Site-wide scripts (popunder, social bar, etc.)
    var scripts = cfg.globalScripts || [];
    scripts.forEach(function (entry) {
      var src = (typeof entry === 'string') ? entry : (entry && entry.src);
      if (!src) return;
      var attr = 'data-pingrab-adsterra-src';
      if (document.querySelector('script[' + attr + '="' + src.replace(/"/g, '\\"') + '"]')) return;
      var s = document.createElement('script');
      if (entry && entry.async) s.async = true;
      if (entry && entry.cfasync === false) s.setAttribute('data-cfasync', 'false');
      s.src = src;
      s.setAttribute(attr, src);
      document.head.appendChild(s);
    });

    // Container required by some units (e.g. native/push).
    if (cfg.containerId && !document.getElementById(cfg.containerId)) {
      var box = document.createElement('div');
      box.id = cfg.containerId;
      (document.body || document.documentElement).appendChild(box);
    }

    // Banner units are split by placement: top (small, after header), mid (in-content), bottom (before footer).
    var banners = cfg.banners || [];
    if (!banners.length) return;

    function ensureContainer(id, insertFn) {
      var c = document.getElementById(id);
      if (c) return c;
      c = document.createElement('div');
      c.id = id;
      c.style.cssText = 'margin:18px auto;max-width:970px;text-align:center;';
      insertFn(c);
      return c;
    }

    var topContainer = ensureContainer('adsterra-banners-top', function (c) {
      var header = document.querySelector('.site-header');
      if (header && header.parentNode) header.parentNode.insertBefore(c, header.nextSibling);
      else if (document.body) document.body.insertBefore(c, document.body.firstChild);
    });
    var midContainer = ensureContainer('adsterra-banners-mid', function (c) {
      var anchor = document.querySelector('#faq, #how, .section-soft, main > section');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(c, anchor);
      else {
        var footer = document.querySelector('.site-footer');
        if (footer && footer.parentNode) footer.parentNode.insertBefore(c, footer);
        else if (document.body) document.body.appendChild(c);
      }
    });
    var bottomContainer = ensureContainer('adsterra-banners', function (c) {
      var footer = document.querySelector('.site-footer');
      if (footer && footer.parentNode) footer.parentNode.insertBefore(c, footer);
      else if (document.body) document.body.appendChild(c);
    });

    banners.forEach(function (b) {
      if (!b || !b.src) return;
      var container = bottomContainer;
      if (b.placement === 'top') container = topContainer;
      else if (b.placement === 'mid') container = midContainer;
      var wrap = document.createElement('div');
      wrap.style.cssText = 'margin:12px auto;';
      var opts = document.createElement('script');
      opts.textContent = 'window.atOptions = ' + JSON.stringify({
        key: b.key || '',
        format: 'iframe',
        height: b.height || 90,
        width: b.width || 728,
        params: {}
      }) + ';';
      wrap.appendChild(opts);
      var s = document.createElement('script');
      s.async = true;
      s.src = b.src;
      wrap.appendChild(s);
      container.appendChild(wrap);
    });
  }

  /* ------------------------------------------------------------------- pwa */
  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
    });
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    els = {
      form: $('#pin-form'),
      pinUrl: $('#pin-url'),
      pasteBtn: $('#paste-btn'),
      submitBtn: $('#submit-btn'),
      downloader: $('#downloader'),
      status: $('#status'),
      skeleton: $('#skeleton'),
      result: $('#result'),
      resThumb: $('#res-thumb'),
      resPlay: $('#res-play'),
      resDuration: $('#res-duration'),
      resKicker: $('#res-kicker'),
      resTitle: $('#res-title'),
      resDesc: $('#res-desc'),
      resAuthor: $('#res-author'),
      resChips: $('#res-chips'),
      resQualityWrap: $('#res-quality-wrap'),
      resQuality: $('#res-quality'),
      resDownload: $('#res-download'),
      resCover: $('#res-cover'),
      resCopy: $('#res-copy'),
      resShare: $('#res-share'),
      resOpen: $('#res-open'),
      resFilename: $('#res-filename'),
      recent: $('#recent'),
      recentList: $('#recent-list'),
      recentClear: $('#recent-clear'),
      previewDialog: $('#preview-dialog'),
      previewVideo: $('#preview-video'),
      previewClose: $('#preview-close'),
      installBtn: $('#install-btn'),
      toast: $('#toast')
    };

    initTheme();
    initNav();
    initDownloader();
    initInstall();
    initAds();
    initAdsterra();
    initServiceWorker();

    if (els.toast) {
      els.toast.setAttribute('role', 'status');
      els.toast.setAttribute('aria-live', 'polite');
    }

    var year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    var prefill = new URLSearchParams(location.search).get('url');
    if (prefill && els.pinUrl) {
      els.pinUrl.value = prefill;
      if (PG.isPinterestUrl(PG.extractUrl(prefill))) {
        setTimeout(function () { start(prefill); }, 250);
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
