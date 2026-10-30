/* ==========================================================================
   PinGrab - site configuration
   --------------------------------------------------------------------------
   Change these values before you deploy:
     1. siteUrl     -> your live domain (with https://)
     2. supportEmail
     3. ads.client  -> your AdSense publisher ID (ca-pub-...)
     4. ads.slots   -> the 10-digit slot IDs of your ad units

   The downloader talks to the small API in server.py. If you host the
   static files somewhere else, set api.base to the full URL of that API
   (for example 'https://api.yourdomain.com') and add the site origin to
   ALLOWED_ORIGINS in server.py.
   ========================================================================== */
window.APP_CONFIG = {
  siteName: 'PinGrab',
  siteUrl: 'https://pingrab.opterik.com',      // TODO: your domain (with https://)
  supportEmail: 'hello@opterik.com',           // TODO: your email

  /* ---------------- downloader API ---------------- */
  api: {
    base: 'https://pingrab.onrender.com',                 // Render backend (live). '' = same origin.
    timeoutMs: 30000,         // give Pinterest time to answer
    /* Optional: if you cannot run server.py, you can point the browser at a
       CORS proxy. {url} is replaced with the encoded Pinterest pin URL.
       Example: ['https://your-proxy.example.com/?url={url}']
       Leave empty to always use the API above. */
    proxies: []
  },

  /* ---------------- Google AdSense ---------------- */
  ads: {
    enabled: false,           // Manual ad units off until real slot IDs are added
    client: 'ca-pub-9399495098326825',         // TODO: your publisher ID
    slots: {
      top: '0000000000',                       // TODO: slot ID of the top banner
      mid: '0000000000',                       // TODO: the one in the middle of the content
      bottom: '0000000000'                     // TODO: the one above the footer
    }
  },

  /* ---------------- Adsterra ---------------- */
  /* Adsterra is a second ad network that runs alongside AdSense.
     Values below are real Adsterra units. globalScripts are site-wide
     (popunder / social bar). banners render into #adsterra-banners. */
  adsterra: {
    enabled: true,
    globalScripts: [
      { src: 'https://bauval.org/21/bb4118fe8ad3afcaf250d6c98615e68f', async: true, cfasync: false }
    ],
    containerId: 'container-bb4118fe8ad3afcaf250d6c98615e68f',
    banners: [
      { key: '9fea96f16f1d312f1041f2eb2b6ebad8', width: 468, height: 60,  src: 'https://bauval.org/22/9fea96f16f1d312f1041f2eb2b6ebad8', placement: 'top' },
      { key: 'e98104bcbe4206def1871d30f3ce7394', width: 160, height: 300, src: 'https://bauval.org/22/e98104bcbe4206def1871d30f3ce7394', placement: 'bottom' },
      { key: 'cc16fff6856346e17c7c21f9e9f285dd', width: 320, height: 50,  src: 'https://bauval.org/22/cc16fff6856346e17c7c21f9e9f285dd', placement: 'mid' },
      { key: 'cb53b96b1cd42f9dfb328cf75f065433', width: 728, height: 90,  src: 'https://bauval.org/22/cb53b96b1cd42f9dfb328cf75f065433', placement: 'bottom' },
      { key: '24ebd25f07a4b70ce07e9d0fd266deb1', width: 160, height: 600, src: 'https://bauval.org/22/24ebd25f07a4b70ce07e9d0fd266deb1', placement: 'bottom' },
      { key: '1a907b26ea5d6f7665914fd6825a100c', width: 300, height: 250, src: 'https://bauval.org/22/1a907b26ea5d6f7665914fd6825a100c', placement: 'mid' }
    ]
  },

  /* ---------------- Analytics ---------------- */
  analytics: {
    gaId: 'G-56Z4LHXTWY'   // Google Analytics 4 measurement ID (set '' to disable)
  },

  ui: {
    maxRecent: 8,             // how many recent downloads to remember locally
    showRecent: true
  }
};

/* True only when a real AdSense setup is present (no placeholder IDs) */
window.APP_CONFIG.adsConfigured = function () {
  var a = window.APP_CONFIG.ads;
  return !!(a && a.enabled && /^ca-pub-\d{16}$/.test(a.client) && a.client.indexOf('0000000000000000') === -1);
};

/* True when at least one Adsterra unit is configured */
window.APP_CONFIG.adsterraConfigured = function () {
  var a = window.APP_CONFIG.adsterra;
  if (!a || !a.enabled) return false;
  if (Array.isArray(a.globalScripts) && a.globalScripts.length) return true;
  if (Array.isArray(a.banners) && a.banners.length) return true;
  return false;
};

/* True when a GA4 measurement ID is present */
window.APP_CONFIG.analyticsConfigured = function () {
  var a = window.APP_CONFIG.analytics;
  return !!(a && a.gaId && /^G-[A-Z0-9]+$/.test(a.gaId));
};
