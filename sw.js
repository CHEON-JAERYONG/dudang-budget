// 우리 가계부 — 서비스워커
// 앱 파일: 네트워크 우선(항상 최신) → 실패 시 캐시 (오프라인에서도 열림)
// GitHub API·시세 요청은 건드리지 않음
const CACHE = 'dudang-v2.1.3';
const SHELL = [
  './', './index.html', './css/app.css', './js/app.js', './js/core.js', './js/views.js', './js/forms.js', './js/store.js',
  './js/market.js', './js/ui.js', './js/util.js', './js/config.js', './data/symbols.json', './vendor/chart.umd.min.js', './vendor/qrcode.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const font = url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('pretendard');
  if (!sameOrigin && !font) return;

  if (font) {
    // 글꼴: 캐시 우선
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  e.respondWith((async () => {
    try {
      // 항상 서버에 최신 여부 확인 (GitHub Pages의 10분 캐시 우회)
      const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline');
    }
  })());
});
