/* QRQC 웹앱 오프라인 캐시: 화면 파일만 보관합니다. 데이터(Microsoft 365)와 로그인 요청은 캐시하지 않습니다.
 * 화면 파일은 네트워크를 먼저 쓰고, 연결이 없을 때만 보관본을 씁니다(새 버전이 바로 반영되도록). */
const CACHE = 'qrqc-shell-v1';
const SHELL = ['./', 'index.html', 'config.js', 'graph.js', 'lib/msal-browser.min.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // Graph · 로그인 · 첨부 주소는 건드리지 않음
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
