// v4: 알림용 서비스워커 (KTX 앱 방식). 페이지가 reg.showNotification()으로 단말 알림창에 띄운다.
// 캐싱은 계속 안 한다(과거 캐시가 옛/새 파일을 뒤섞은 사고) — fetch 핸들러 없음, 항상 네트워크 직행.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) { /* 무시 */ }
    await self.clients.claim();
  })());
});

// 서버(자체 푸시 채널)가 보낸 푸시 → 알림. 앱이 백그라운드거나 완전히 닫혀 있어도 실행된다.
self.addEventListener('push', (event) => {
  let d = {};
  // 페이로드가 비었거나 JSON이 아닐 수도 있다(테스트 발송) — 그래도 알림은 떠야 한다
  try { d = event.data ? event.data.json() : {}; }
  catch (e) { let t = ''; try { t = event.data ? event.data.text() : ''; } catch (e2) { /* 무시 */ } d = { body: t }; }
  if (!d || typeof d !== 'object') d = {};
  const data = (d.data && typeof d.data === 'object') ? d.data : {};
  event.waitUntil(self.registration.showNotification(d.title || '티켓오픈 체커', {
    body: d.body || '',
    icon: 'icon-192.png?v=20260929-icon',
    // 페이지가 띄우는 알림과 tag를 맞춰 둔다 — 같은 tag면 쌓이지 않고 서로 교체된다
    tag: data.tag || d.tag || 'toc-push',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { url: data.url || './' },
  }));
});

// 알림 탭 → 이미 열려 있는 앱 창이 있으면 그 창으로, 없으면 새로 연다
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
