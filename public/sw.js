// 티켓 오픈 캘린더 — 설치형 PWA용 서비스워커.
// 아이콘 등 정적 이미지는 캐시 우선, 나머지(HTML/CSS/JS/data.json)는 네트워크 우선(신선도)으로 처리한다.
const CACHE = 'toc-v1';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  const isStaticImage = /\.(png|ico|svg|webmanifest)$/.test(url.pathname);
  if (isStaticImage) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // HTML/CSS/JS/data.json 등: 네트워크 우선, 실패 시 캐시(오프라인 대비).
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('index.html')))
  );
});
