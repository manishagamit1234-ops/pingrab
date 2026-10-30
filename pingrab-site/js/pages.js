/* ==========================================================================
   PinGrab - shared behaviour for the help / legal pages
   ========================================================================== */
(function () {
  'use strict';
  var THEME_KEY = 'pingrab_theme';

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var sun = document.getElementById('icon-sun');
    var moon = document.getElementById('icon-moon');
    if (sun && moon) {
      sun.hidden = theme === 'dark';
      moon.hidden = theme !== 'dark';
    }
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  var CFG = window.APP_CONFIG || {};

  function initAds() {
    if (typeof CFG.adsConfigured === 'function' && CFG.adsConfigured()) {
      var client = CFG.ads.client;
      if (!document.querySelector('script[src*="adsbygoogle.js"]') && !document.querySelector('script[data-pingrab-ads]')) {
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
        s.crossOrigin = 'anonymous';
        s.setAttribute('data-pingrab-ads', '1');
        document.head.appendChild(s);
      }
      $$('.ad-slot[data-ad]').forEach(function (slot) {
        var key = slot.getAttribute('data-ad');
        var slotId = (CFG.ads.slots && CFG.ads.slots[key]) || '';
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
  }

  function initAdsterra() {
    var cfg = CFG.adsterra || {};
    if (typeof CFG.adsterraConfigured !== 'function' || !CFG.adsterraConfigured()) return;

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

    if (cfg.containerId && !document.getElementById(cfg.containerId)) {
      var box = document.createElement('div');
      box.id = cfg.containerId;
      (document.body || document.documentElement).appendChild(box);
    }

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

  function boot() {
    var stored = '';
    try { stored = localStorage.getItem(THEME_KEY) || ''; } catch (e) { /* ignore */ }
    if (stored === 'light' || stored === 'dark') applyTheme(stored);

    var toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
      });
    }

    var navToggle = document.getElementById('nav-toggle');
    var nav = document.getElementById('site-nav');
    if (navToggle && nav) {
      navToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = nav.classList.toggle('is-open');
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      document.addEventListener('click', function (e) {
        if (!nav.contains(e.target) && !navToggle.contains(e.target)) {
          nav.classList.remove('is-open');
          navToggle.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          nav.classList.remove('is-open');
          navToggle.setAttribute('aria-expanded', 'false');
        }
      });
    }

    var install = document.getElementById('install-btn');
    var deferred = null;
    var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (install) {
      if (isIOS && !standalone) {
        install.hidden = false;
        install.addEventListener('click', function () {
          try { alert('Tap Share, then "Add to Home Screen" to install PinGrab.'); } catch (e) { /* ignore */ }
        });
      }
      window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        deferred = e;
        install.hidden = false;
      });
      install.addEventListener('click', async function () {
        if (!deferred) return;
        deferred.prompt();
        try { await deferred.userChoice; } catch (e) { /* ignore */ }
        deferred = null;
        install.hidden = true;
      });
      window.addEventListener('appinstalled', function () { install.hidden = true; });
    }

    var year = document.getElementById('year');
    if (year) year.textContent = String(new Date().getFullYear());

    initAds();
    initAdsterra();

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
